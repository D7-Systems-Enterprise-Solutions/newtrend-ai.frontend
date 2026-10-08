import {
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { TraceState, W3CTraceContextPropagator } from '@opentelemetry/core';
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

export interface NewtrendAiOptions {
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

const tracerName = '@Newtrend-ai/angular';
const actionSelector =
  'button, a, select, [role="button"], [role="combobox"], [role="option"], input[type="submit"], input[type="button"], input[type="image"]';
const submitSelector = 'button[type="submit"], input[type="submit"], button:not([type])';
type HttpCapture = { url: string; headers: string[]; body?: string };

const xhrLookups = new WeakMap<XMLHttpRequest, SourceLookup>();
const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const xhrCaptures = new WeakMap<XMLHttpRequest, HttpCapture>();
const fetchCaptures = new WeakMap<object, HttpCapture>();
const fetchLookups: SourceLookup[] = [];
const maxHttpBody = 64 * 1024;
let callerPatched = false;

const burstQuietMs = 8000;
const burstHeader = 'X-Newtrend-AI-Burst';
let burstSpan: Span | undefined;
let burstId: string | undefined;
let requestsInFlight = 0;
let closeTimer: number | undefined;

export function initNewtrendAi(options: NewtrendAiOptions): void {
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
    headers: { 'X-Newtrend-AI': '1' },
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
            span.setAttribute('newtrend.ai.drop', true);
            span.end();
            return true;
          }

          span.setAttribute('newtrend.ai.layer', 'frontend');
          span.setAttribute('newtrend.ai.user_action', label);
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
          span.setAttribute('newtrend.ai.layer', 'http');
          if (burstId) {
            span.setAttribute('newtrend.ai.burst', burstId);
          }
          writeHttp(span, xhrCaptures.get(xhr));
          finishLookup(span, xhrLookups.get(xhr));
        },
      }),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateTo,
        ignoreUrls,
        applyCustomAttributesOnSpan: (span, request) => {
          span.setAttribute('newtrend.ai.layer', 'http');
          if (burstId) {
            span.setAttribute('newtrend.ai.burst', burstId);
          }
          writeHttp(span, fetchCaptures.get(request));
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
    'newtrend.ai.layer': 'frontend',
    'newtrend.ai.user_action': actionName,
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
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    if (burstId && name.toLowerCase() === 'tracestate' && !value.includes('Newtrend-AI=')) {
      value = `Newtrend-AI=${burstId}${value ? `,${value}` : ''}`;
    }

    const capture = xhrCaptures.get(this);
    if (capture) {
      rememberHeader(capture.headers, name, value);
    }

    return originalSetHeader.call(this, name, value);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const action = burstSpan;
    const url = xhrUrls.get(this) ?? '';
    const capture = xhrCaptures.get(this);
    if (capture) {
      capture.body = textBody(body);
    }
    noteRequestStart(url);
    this.addEventListener('loadend', () => noteRequestEnd(url, action), { once: true });
    if (action && burstId && !isInternal(url) && !isAsset(url)) {
      try {
        this.setRequestHeader(burstHeader, burstId);
        this.setRequestHeader('tracestate', `Newtrend-AI=${burstId}`);
      } catch {
        // open() was not called, or the header was already sent.
      }

      return context.with(burstContext(action), () => originalSend.call(this, body));
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
    xhrCaptures.set(this, { url: absoluteUrl(href), headers: [] });
    if (!isInternal(href)) {
      xhrLookups.set(this, beginLookup(captureStack(), trace.getSpan(context.active())));
    }

    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const action = burstSpan;
    if (!isInternal(url)) {
      fetchLookups.push(beginLookup(captureStack(), action ?? trace.getSpan(context.active())));
    }

    noteRequestStart(url);
    const belongs = Boolean(action && burstId && !isInternal(url) && !isAsset(url));
    const stamped = belongs ? withBurstHeader(input, init) : { input, init };
    rememberFetch(stamped, init?.body);
    const send = () => originalFetch(stamped.input, stamped.init).finally(() => noteRequestEnd(url, action));
    if (belongs && action) {
      return context.with(burstContext(action), send);
    }

    return send();
  };
}

function burstContext(span: Span): Context {
  const current = span.spanContext();
  const traceState = (current.traceState ?? new TraceState()).set('Newtrend-AI', burstId ?? '');
  return trace.setSpanContext(context.active(), { ...current, traceState });
}

function holdAction(span: Span): void {
  finishAction();
  burstId = crypto.randomUUID();
  burstSpan = span;
  span.setAttribute('newtrend.ai.burst', burstId);
  requestsInFlight = 0;
  const original = span.end.bind(span);
  let ended = false;
  span.end = (time) => {
    if (ended) {
      return;
    }

    ended = true;
    span.end = original;
    original(time);
    if (burstSpan === span && requestsInFlight === 0) {
      armClose(burstQuietMs);
    }
  };

  const finish = () => {
    if (burstSpan !== span) {
      return;
    }

    window.clearTimeout(closeTimer);
    burstSpan = undefined;
    burstId = undefined;
    if (!ended) {
      ended = true;
      span.end = original;
      original();
    }
  };

  (span as Span & { __finish?: () => void }).__finish = finish;
}

function finishAction(): void {
  const span = burstSpan as (Span & { __finish?: () => void }) | undefined;
  span?.__finish?.();
}

function armClose(delay: number): void {
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(finishAction, delay);
}

function noteRequestStart(url: string): void {
  if (!burstSpan || isInternal(url) || isAsset(url)) {
    return;
  }

  requestsInFlight += 1;
  window.clearTimeout(closeTimer);
}

function noteRequestEnd(url: string, span: Span | undefined): void {
  if (!span || burstSpan !== span || isInternal(url) || isAsset(url)) {
    return;
  }

  requestsInFlight = Math.max(0, requestsInFlight - 1);
  if (requestsInFlight === 0) {
    armClose(burstQuietMs);
  }
}

function rememberFetch(
  stamped: { input: RequestInfo | URL; init?: RequestInit },
  body: BodyInit | null | undefined,
): void {
  const url = requestUrl(stamped.input);
  if (isInternal(url) || isAsset(url)) {
    return;
  }

  const capture = describeFetch(stamped.input, stamped.init, body);
  if (stamped.input instanceof Request) {
    fetchCaptures.set(stamped.input, capture);
    return;
  }

  stamped.init = stamped.init ?? {};
  fetchCaptures.set(stamped.init, capture);
}

function describeFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: BodyInit | null | undefined,
): HttpCapture {
  const request = input instanceof Request ? input : undefined;
  const headers = new Headers(request?.headers);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  return {
    url: absoluteUrl(requestUrl(input)),
    headers: headerLines(headers),
    body: textBody(body),
  };
}

function rememberHeader(headers: string[], name: string, value: string): void {
  if (!value) {
    return;
  }

  const line = `${headerLabel(name)}: ${value}`;
  const lower = name.toLowerCase();
  const index = headers.findIndex((entry) => entry.slice(0, entry.indexOf(':')).toLowerCase() === lower);
  if (index >= 0) {
    headers[index] = line;
    return;
  }

  headers.push(line);
}

function headerLines(headers: Headers): string[] {
  const lines: string[] = [];
  headers.forEach((value, key) => {
    if (!value || !keepHttpHeader(key)) {
      return;
    }

    lines.push(`${headerLabel(key)}: ${value}`);
  });
  return lines;
}

function writeHttp(span: Span, capture: HttpCapture | undefined): void {
  if (!capture?.url) {
    return;
  }

  span.setAttribute('url.full', capture.url);
  const lines = capture.headers.filter((line) => keepHttpHeader(line.slice(0, line.indexOf(':'))));
  if (lines.length > 0) {
    span.setAttribute('newtrend.ai.http.headers', lines.join('\n'));
  }
  if (capture.body) {
    span.setAttribute('newtrend.ai.http.body', capture.body);
  }
}

function keepHttpHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === 'authorization' || lower === 'content-type' || lower === 'accept') {
    return true;
  }

  return lower.startsWith('x-') && lower !== burstHeader.toLowerCase();
}

function headerLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'authorization') return 'Authorization';
  if (lower === 'content-type') return 'Content-Type';
  if (lower === 'accept') return 'Accept';
  return name;
}

function textBody(body: Document | XMLHttpRequestBodyInit | BodyInit | null | undefined): string | undefined {
  if (body == null || body === '') {
    return undefined;
  }

  if (typeof body === 'string') {
    return clipHttpBody(body);
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    const text = body.toString();
    return text ? clipHttpBody(text) : undefined;
  }

  if (typeof Document !== 'undefined' && body instanceof Document) {
    const text = new XMLSerializer().serializeToString(body);
    return text ? clipHttpBody(text) : undefined;
  }

  return undefined;
}

function clipHttpBody(text: string): string {
  return text.length > maxHttpBody ? text.slice(0, maxHttpBody) : text;
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function isInternal(url: string): boolean {
  return /\/v1\/traces(?:$|\?)/.test(url) || /\.map(?:$|\?)/.test(url);
}

function isAsset(url: string): boolean {
  return /\.(?:js|css|woff2?)(?:$|\?)/.test(url);
}

function withBurstHeader(
  input: RequestInfo | URL,
  init?: RequestInit,
): { input: RequestInfo | URL; init?: RequestInit } {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(burstHeader, burstId ?? '');
  const traceState = headers.get('tracestate');
  if (!traceState?.includes('Newtrend-AI=')) {
    headers.set('tracestate', `Newtrend-AI=${burstId}${traceState ? `,${traceState}` : ''}`);
  }
  if (input instanceof Request) {
    return { input: new Request(input, { ...init, headers }) };
  }

  return { input, init: { ...init, headers } };
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
    if (burstId) {
      span.setAttribute('newtrend.ai.burst', burstId);
    }

    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (span.attributes['newtrend.ai.drop'] === true) {
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
