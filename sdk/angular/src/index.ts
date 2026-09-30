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
  'button, a, [role="button"], input[type="submit"], input[type="button"], input[type="image"]';
const submitSelector = 'button[type="submit"], input[type="submit"], button:not([type])';
const xhrLookups = new WeakMap<XMLHttpRequest, SourceLookup>();
const fetchLookups: SourceLookup[] = [];
let callerPatched = false;

export function initAINewtrend(options: AINewtrendOptions): void {
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 80);
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4318';
  const url = endpoint.endsWith('/v1/traces')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/v1/traces`;
  const propagateTo = options.propagateTo ?? /.*/;
  const ignoreUrls = [/\/v1\/traces(?:$|\?)/, /\.map(?:$|\?)/];

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
          const owner = findAppComponent(element);
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
}

function findAppComponent(start: HTMLElement): { component: object; file: string; name?: string; line?: number } | null {
  const ng = (window as unknown as { ng?: NgGlobal }).ng;
  if (!ng?.getComponent) {
    return null;
  }

  let node: Element | null = start;
  while (node) {
    if (node.tagName.includes('-') && ng.getComponent) {
      try {
        const component = ng.getComponent(node);
        const debug = component ? readDebug(component) : null;
        if (component && debug) {
          return { component, ...debug };
        }
      } catch {
        // This element is not a component host.
      }
    }

    node = node.parentElement;
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
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const href = String(url);
    if (!isInternal(href)) {
      xhrLookups.set(this, beginLookup(captureStack(), trace.getSpan(context.active())));
    }

    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isInternal(requestUrl(input))) {
      fetchLookups.push(beginLookup(captureStack(), trace.getSpan(context.active())));
    }

    return originalFetch(input, init);
  };
}

function isInternal(url: string): boolean {
  return /\/v1\/traces(?:$|\?)/.test(url) || /\.map(?:$|\?)/.test(url);
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

  const control = element.matches(actionSelector) ? element : element.closest(actionSelector);
  if (!(control instanceof HTMLElement)) {
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
