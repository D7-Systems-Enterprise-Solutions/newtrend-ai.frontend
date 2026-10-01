import {
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { Resource } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span as SdkSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { beginLookup, captureStack, finishLookup, pinComponent, preloadSourceMaps, type SourceLookup } from './source-location';

export interface AINewtrendOptions {
  appName: string;
  /** OTLP HTTP base address. /v1/traces is appended when missing. */
  endpoint?: string;
  /** URLs that receive the W3C traceparent header. Defaults to every URL. */
  propagateTo?: RegExp | RegExp[];
}

export interface UserActionDetails {
  functionName?: string;
  filePath?: string;
  line?: number;
}

const tracerName = '@ai-newtrend/angular';
const actionSelector =
  'button, a, select, [role="button"], [role="combobox"], [role="option"], input[type="submit"], input[type="button"], input[type="image"]';
const submitSelector = 'button[type="submit"], input[type="submit"], button:not([type])';
const xhrLookups = new WeakMap<XMLHttpRequest, SourceLookup>();
const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const fetchLookups: SourceLookup[] = [];
let callerPatched = false;

const settleMs = 2000;
const quietMs = 700;
const maxActionMs = 12000;
let currentAction: Span | undefined;
let actionStarted = 0;
let requestsInFlight = 0;
let closeTimer: number | undefined;

export function initAINewtrend(options: AINewtrendOptions): void {
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 80);
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4318';
  const url = endpoint.endsWith('/v1/traces')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/v1/traces`;
  const propagateTo = options.propagateTo ?? /.*/;
  const ignoreUrls = [/\/v1\/traces(?:$|\?)/, /\.map(?:$|\?)/, /\.(?:js|css|woff2?)(?:$|\?)/];

  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const exporter = new OTLPTraceExporter({
    url,
    headers: { 'X-AI-Newtrend': '1' },
  });
  const provider = new WebTracerProvider({
    resource: new Resource({
      'service.name': options.appName,
    }),
    spanProcessors: [new DropMarkedSpans(new BatchSpanProcessor(exporter, { scheduledDelayMillis: 200 }))],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new UserInteractionInstrumentation({
        eventNames: ['click', 'submit'],
        shouldPreventSpanCreation: (eventName, element, span) => {
          const label = describeInteraction(eventName, element);
          if (!label) {
            span.setAttribute('ai.newtrend.drop', true);
            span.end();
            return true;
          }

          span.setAttribute('ai.newtrend.layer', 'frontend');
          span.setAttribute('ai.newtrend.user_action', label);
          holdAction(span);
          const owner = findAppComponent(controlElement(element) ?? element);
          if (owner) {
            pinComponent(span, { file: owner.file, name: owner.name, line: owner.line });
            wrapMethods(Object.getPrototypeOf(owner.component) as object);
          }
          return false;
        },
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: propagateTo,
        ignoreUrls,
        applyCustomAttributesOnSpan: (span, xhr) => {
          span.setAttribute('ai.newtrend.layer', 'http');
          finishLookup(span, xhrLookups.get(xhr));
        },
      }),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateTo,
        ignoreUrls,
        applyCustomAttributesOnSpan: (span) => {
          span.setAttribute('ai.newtrend.layer', 'http');
          finishLookup(span, fetchLookups.shift());
        },
      }),
    ],
  });

  installCallerCapture();
  preloadSourceMaps();
}

export function traceUserAction<T>(
  actionName: string,
  action: () => Promise<T> | T,
  details?: UserActionDetails,
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  const attributes: Attributes = {
    'ai.newtrend.layer': 'frontend',
    'ai.newtrend.user_action': actionName,
  };

  if (details?.functionName) {
    attributes['code.function.name'] = details.functionName;
  }
  if (details?.filePath) {
    attributes['code.file.path'] = details.filePath;
  }
  if (details?.line) {
    attributes['code.line.number'] = details.line;
  }

  const span = tracer.startSpan(actionName, { attributes });
  const active = trace.setSpan(context.active(), span);

  return context.with(active, () =>
    Promise.resolve()
      .then(() => action())
      .then((result) => {
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(error instanceof Error ? error : new Error(message));
        throw error;
      })
      .finally(() => {
        span.end();
      }),
  );
}

export function activeTraceId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

const instrumented = new WeakSet<object>();

interface NgDebug {
  className?: string;
  filePath?: string;
  lineNumber?: number;
}

interface NgGlobal {
  getComponent?: (node: Element) => object | null;
  getOwningComponent?: (node: Element) => object | null;
  getHostElement?: (component: object) => Element | null;
}

function findAppComponent(start: HTMLElement): { component: object; file: string; name?: string; line?: number } | null {
  const ng = (window as unknown as { ng?: NgGlobal }).ng;
  if (!ng?.getComponent && !ng?.getOwningComponent) {
    return null;
  }

  const owner = owningAppComponent(ng, start) ?? owningAppComponent(ng, overlayTrigger(start));
  return owner;
}

function owningAppComponent(
  ng: NgGlobal,
  start: HTMLElement | null,
): { component: object; file: string; name?: string; line?: number } | null {
  const seen = new Set<EventTarget>();
  let node: HTMLElement | null = start;
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.tagName.includes('-')) {
      const hosted = componentAt(ng, node);
      const debug = hosted ? readDebug(hosted) : null;
      if (hosted && debug) {
        return { component: hosted, ...debug };
      }
    }

    node = parentElement(node);
  }

  return null;
}

function componentAt(ng: NgGlobal, node: Element): object | null {
  try {
    return ng.getComponent?.(node) ?? null;
  } catch {
    return null;
  }
}

function parentElement(node: Element): HTMLElement | null {
  if (node.parentElement) {
    return node.parentElement;
  }

  const root = node.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement) {
    return root.host;
  }

  return null;
}

function overlayTrigger(start: HTMLElement | null): HTMLElement | null {
  let node: Element | null = start;
  const seen = new Set<EventTarget>();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.id) {
      const trigger = document.querySelector(`[aria-controls="${cssEscape(node.id)}"], [aria-owns="${cssEscape(node.id)}"]`);
      if (trigger instanceof HTMLElement && !node.contains(trigger)) {
        return trigger;
      }
    }

    node = parentElement(node);
  }

  return null;
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/"/g, '\\"');
}

function controlElement(element: HTMLElement): HTMLElement | null {
  if (element.matches(actionSelector)) {
    return element;
  }

  return closestControl(element);
}

function closestControl(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element;
  while (node) {
    if (node.matches(actionSelector)) {
      return node;
    }

    node = parentElement(node);
  }

  return null;
}

function readDebug(component: object): { file: string; name?: string; line?: number } | null {
  const info = (component.constructor as { ɵcmp?: { debugInfo?: NgDebug } }).ɵcmp?.debugInfo;
  if (!info?.filePath || /node_modules|primeng|@angular/i.test(info.filePath)) {
    return null;
  }

  return {
    file: info.filePath.replace(/\\/g, '/'),
    name: info.className,
    line: info.lineNumber,
  };
}

function wrapMethods(target: object): void {
  if (!target || instrumented.has(target)) {
    return;
  }

  instrumented.add(target);
  for (const key of Object.getOwnPropertyNames(target)) {
    if (key === 'constructor' || key.startsWith('ng') || key.startsWith('ɵ')) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) {
      continue;
    }

    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(target, key, {
      ...descriptor,
      value(this: unknown, ...args: unknown[]) {
        const active = trace.getSpan(context.active());
        if (active?.isRecording()) {
          beginLookup(captureStack(), active);
        }

        return original.apply(this, args);
      },
    });
  }
}

function installCallerCapture(): void {
  if (callerPatched || typeof XMLHttpRequest === 'undefined') {
    return;
  }

  callerPatched = true;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const action = currentAction;
    const url = xhrUrls.get(this) ?? '';
    noteRequestStart(url);
    this.addEventListener('loadend', () => noteRequestEnd(url), { once: true });
    if (action?.isRecording()) {
      return context.with(trace.setSpan(context.active(), action), () => originalSend.call(this, body));
    }

    return originalSend.call(this, body);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const href = String(url);
    xhrUrls.set(this, href);
    if (!isInternal(href)) {
      xhrLookups.set(this, beginLookup(captureStack(), trace.getSpan(context.active())));
    }

    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const action = currentAction;
    if (!isInternal(url)) {
      fetchLookups.push(beginLookup(captureStack(), action ?? trace.getSpan(context.active())));
    }

    noteRequestStart(url);
    const send = () => originalFetch(input, init).finally(() => noteRequestEnd(url));
    if (action?.isRecording() && !isInternal(url)) {
      return context.with(trace.setSpan(context.active(), action), send);
    }

    return send();
  };
}

function holdAction(span: Span): void {
  finishAction();
  currentAction = span;
  actionStarted = Date.now();
  requestsInFlight = 0;
  const original = span.end.bind(span);
  let requested = false;
  let endTime: Parameters<Span['end']>[0];
  span.end = (time) => {
    requested = true;
    endTime = time;
    armClose(settleMs);
  };

  const finish = () => {
    if (currentAction !== span) {
      return;
    }

    currentAction = undefined;
    window.clearTimeout(closeTimer);
    span.end = original;
    if (requested) {
      original(endTime);
    }
  };

  (span as Span & { __finish?: () => void }).__finish = finish;
}

function finishAction(): void {
  const span = currentAction as (Span & { __finish?: () => void }) | undefined;
  span?.__finish?.();
}

function armClose(delay: number): void {
  window.clearTimeout(closeTimer);
  const remaining = maxActionMs - (Date.now() - actionStarted);
  if (remaining <= 0) {
    finishAction();
    return;
  }

  closeTimer = window.setTimeout(finishAction, Math.min(delay, remaining));
}

function noteRequestStart(url: string): void {
  if (!currentAction?.isRecording() || isInternal(url) || isAsset(url)) {
    return;
  }

  requestsInFlight += 1;
  window.clearTimeout(closeTimer);
}

function noteRequestEnd(url: string): void {
  if (!currentAction || isInternal(url) || isAsset(url)) {
    return;
  }

  requestsInFlight = Math.max(0, requestsInFlight - 1);
  if (requestsInFlight === 0) {
    armClose(quietMs);
  }
}

function isInternal(url: string): boolean {
  return /\/v1\/traces(?:$|\?)/.test(url) || /\.map(?:$|\?)/.test(url);
}

function isAsset(url: string): boolean {
  return /\.(?:js|css|woff2?)(?:$|\?)/.test(url);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function describeInteraction(eventName: string, element: HTMLElement): string | null {
  if (eventName === 'submit') {
    const form = element.tagName === 'FORM' ? element : element.closest('form');
    if (!(form instanceof HTMLElement)) {
      return null;
    }

    const submitter = form.querySelector(submitSelector);
    const named = submitter instanceof HTMLElement ? submitter : form;
    return `Submit "${controlText(named)}"`;
  }

  const control = controlElement(element);
  if (!control) {
    return null;
  }

  const verb = control instanceof HTMLInputElement && control.type === 'submit' ? 'Submit' : 'Click';
  return `${verb} "${controlText(control)}"`;
}

function controlText(element: HTMLElement): string {
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) {
    return clip(aria);
  }

  if (element instanceof HTMLInputElement && element.value.trim()) {
    return clip(element.value.trim());
  }

  const text = element.innerText?.replace(/\s+/g, ' ').trim();
  if (text) {
    return clip(text);
  }

  if (element.id.trim()) {
    return clip(element.id.trim());
  }

  return element.tagName.toLowerCase();
}

function clip(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

class DropMarkedSpans implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: SdkSpan, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (span.attributes['ai.newtrend.drop'] === true) {
      return;
    }

    this.next.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }
}
