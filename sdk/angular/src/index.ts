import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

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
const xhrSpans = new WeakMap<XMLHttpRequest, Span>();

let actionSpan: Span | undefined;
let propagateTo: RegExp | RegExp[] = /.*/;
let httpPatched = false;

export function initAINewtrend(options: AINewtrendOptions): void {
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4318';
  const url = endpoint.endsWith('/v1/traces')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/v1/traces`;

  propagateTo = options.propagateTo ?? /.*/;
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const exporter = new OTLPTraceExporter({
    url,
    headers: { 'X-AI-Newtrend': '1' },
  });
  const provider = new WebTracerProvider({
    resource: new Resource({
      'service.name': options.appName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 200,
      }),
    ],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  installHttpPropagation();
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
  const previous = actionSpan;
  actionSpan = span;

  return Promise.resolve()
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
      actionSpan = previous;
      span.end();
    });
}

export function activeTraceId(): string | undefined {
  return actionSpan?.spanContext().traceId ?? trace.getSpan(context.active())?.spanContext().traceId;
}

function installHttpPropagation(): void {
  if (httpPatched || typeof XMLHttpRequest === 'undefined') {
    return;
  }

  httpPatched = true;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch.bind(window);

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const parent = actionSpan;
    const href = resolveUrl(String(url));
    if (parent && allows(href)) {
      const parentContext = trace.setSpan(ROOT_CONTEXT, parent);
      const httpSpan = trace.getTracer(tracerName).startSpan(requestName(method, href), {
        kind: SpanKind.CLIENT,
        attributes: {
          'ai.newtrend.layer': 'http',
          'http.method': method.toUpperCase(),
          'http.url': href,
        },
      }, parentContext);
      xhrSpans.set(this, httpSpan);
      (this as XMLHttpRequest & { __aiHeaders?: Record<string, string> }).__aiHeaders =
        carrierFor(trace.setSpan(parentContext, httpSpan));
    }

    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const marked = this as XMLHttpRequest & { __aiHeaders?: Record<string, string> };
    if (marked.__aiHeaders) {
      for (const [key, value] of Object.entries(marked.__aiHeaders)) {
        this.setRequestHeader(key, value);
      }
    }

    const httpSpan = xhrSpans.get(this);
    if (httpSpan) {
      this.addEventListener('loadend', () => {
        httpSpan.setAttribute('http.status_code', this.status);
        httpSpan.setStatus({
          code: this.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
        httpSpan.end();
      });
    }

    return originalSend.call(this, body);
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const parent = actionSpan;
    const href = requestUrl(input);
    if (!parent || !allows(href)) {
      return originalFetch(input, init);
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const parentContext = trace.setSpan(ROOT_CONTEXT, parent);
    const httpSpan = trace.getTracer(tracerName).startSpan(requestName(method, href), {
      kind: SpanKind.CLIENT,
      attributes: {
        'ai.newtrend.layer': 'http',
        'http.method': method,
        'http.url': href,
      },
    }, parentContext);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [key, value] of Object.entries(carrierFor(trace.setSpan(parentContext, httpSpan)))) {
      headers.set(key, value);
    }

    try {
      const response = await originalFetch(input, { ...init, headers });
      httpSpan.setAttribute('http.status_code', response.status);
      httpSpan.setStatus({ code: response.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
      return response;
    } catch (error) {
      httpSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      httpSpan.end();
    }
  };
}

function carrierFor(spanContext: ReturnType<typeof trace.setSpan>): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(spanContext, carrier);
  return carrier;
}

function allows(url: string): boolean {
  const rules = Array.isArray(propagateTo) ? propagateTo : [propagateTo];
  return rules.some((rule) => rule.test(url));
}

function resolveUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return resolveUrl(input);
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestName(method: string, url: string): string {
  try {
    return `${method.toUpperCase()} ${new URL(url).pathname}`;
  } catch {
    return `${method.toUpperCase()} ${url}`;
  }
}
