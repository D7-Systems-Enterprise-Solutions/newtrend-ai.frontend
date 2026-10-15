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
import { burstForSend, clickFollowsPress, startOnPointerDown, traceStateWithBurst } from './gesture';

export interface ComponentOwner {
  component?: object;
  file?: string;
  name?: string;
  line?: number;
  /** Call stack whose frames locate the component file when the fiber has no source. */
  stack?: string;
}

export interface NewtrendAiOptions {
  appName: string;
  /** OTLP HTTP base address. /v1/traces is appended when missing. */
  endpoint?: string;
  /** URLs that receive the W3C traceparent header. Defaults to every URL. */
  propagateTo?: RegExp | RegExp[];
  /** Scope name stored on spans. Defaults to the browser package. */
  tracerName?: string;
  /** Framework hook that names the component owning a clicked element. */
  resolveComponent?: (element: HTMLElement) => ComponentOwner | null;
}

export interface UserActionDetails {
  functionName?: string;
  filePath?: string;
  line?: number;
}

let tracerName = '@Newtrend-ai/browser';
let resolveComponent: ((element: HTMLElement) => ComponentOwner | null) | undefined;
const actionSelector =
  'button, a, select, [role="button"], [role="combobox"], [role="option"], input[type="submit"], input[type="button"], input[type="image"]';
const submitSelector = 'button[type="submit"], input[type="submit"], button:not([type])';
type HttpCapture = { url: string; headers: string[]; body?: string };

const xhrLookups = new WeakMap<XMLHttpRequest, SourceLookup>();
const xhrUrls = new WeakMap<XMLHttpRequest, string>();
const xhrCaptures = new WeakMap<XMLHttpRequest, HttpCapture>();
const xhrBursts = new WeakMap<XMLHttpRequest, string>();
const xhrOpened = new WeakSet<XMLHttpRequest>();
const fetchCaptures = new WeakMap<object, HttpCapture>();
const fetchBursts = new WeakMap<object, string>();
const fetchLookups: SourceLookup[] = [];
const maxHttpBody = 64 * 1024;
let callerPatched = false;

const burstHeader = 'X-Newtrend-AI-Burst';
let burstSpan: Span | undefined;
let burstId: string | undefined;
let burstEvent: Event | undefined;
let burstOrigin: string | undefined;
let burstControl: HTMLElement | undefined;
let armedPointer: HTMLElement | undefined;
let armedAction: HTMLElement | undefined;

export function initNewtrendAi(options: NewtrendAiOptions): void {
  tracerName = options.tracerName ?? '@Newtrend-ai/browser';
  resolveComponent = options.resolveComponent;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 80);
  const endpoint = options.endpoint ?? 'http://127.0.0.1:4318';
  const url = endpoint.endsWith('/v1/traces')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/v1/traces`;
  const propagateTo = options.propagateTo ?? /.*/;
  const ignoreUrls = [/\/v1\/traces(?:$|\?)/, /:431[89](?:\/|$|\?)/, /\.map(?:$|\?)/, /\.(?:js|css|woff2?)(?:$|\?)/];

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
        shouldPreventSpanCreation: (_eventName, _element, span) => {
          span.setAttribute('newtrend.ai.drop', true);
          span.end();
          return true;
        },
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: propagateTo,
        ignoreUrls,
        applyCustomAttributesOnSpan: (span, xhr) => {
          const url = xhrUrls.get(xhr) ?? '';
          if (isInternal(url)) {
            span.setAttribute('newtrend.ai.drop', true);
            return;
          }

          span.setAttribute('newtrend.ai.layer', 'http');
          const sentBurst = xhrBursts.get(xhr);
          if (sentBurst) {
            span.setAttribute('newtrend.ai.burst', sentBurst);
          }
          writeHttp(span, xhrCaptures.get(xhr));
          finishLookup(span, xhrLookups.get(xhr));
        },
      }),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateTo,
        ignoreUrls,
        applyCustomAttributesOnSpan: (span, request) => {
          const url = request instanceof Request ? request.url : '';
          if (isInternal(url)) {
            span.setAttribute('newtrend.ai.drop', true);
            return;
          }

          span.setAttribute('newtrend.ai.layer', 'http');
          const sentBurst = fetchBursts.get(request);
          if (sentBurst) {
            span.setAttribute('newtrend.ai.burst', sentBurst);
          }
          writeHttp(span, fetchCapture(request));
          finishLookup(span, fetchLookups.shift());
        },
      }),
    ],
  });

  listenForInteractions();
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
  holdAction(span);
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
    if (burstId && name.toLowerCase() === 'tracestate') {
      value = traceStateWithBurst(value, burstId);
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
    if (!isInternal(url) && !isAsset(url)) {
      const opened = xhrOpened.has(this);
      const id = burstForSend(xhrBursts.get(this), action && burstId ? burstId : undefined, opened);
      if (id && !opened) {
        xhrBursts.set(this, id);
        xhrOpened.add(this);
      }
      if (id) {
        try {
          this.setRequestHeader(burstHeader, id);
          this.setRequestHeader('tracestate', `Newtrend-AI=${id}`);
        } catch {
          // open() was not called, or the header was already sent.
        }

        if (action && burstId === id) {
          return context.with(burstContext(action), () => originalSend.call(this, body));
        }
      }
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
    const tracked = !isInternal(href) && !isAsset(href);
    if (tracked) {
      ensurePointerAction();
    }
    xhrUrls.set(this, href);
    xhrCaptures.set(this, { url: absoluteUrl(href), headers: [] });
    if (tracked) {
      xhrLookups.set(this, beginLookup(captureStack(), trace.getSpan(context.active())));
    }

    const opened = originalOpen.call(this, method, url, async ?? true, username, password);
    if (tracked) {
      xhrOpened.add(this);
      if (burstId) {
        xhrBursts.set(this, burstId);
        try {
          this.setRequestHeader(burstHeader, burstId);
          this.setRequestHeader('tracestate', traceStateWithBurst('', burstId));
        } catch {
          // The request is not open yet, or the header was already sent.
        }
      } else {
        xhrBursts.delete(this);
      }
    }
    return opened;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isInternal(url) && !isAsset(url)) {
      ensurePointerAction();
    }
    const action = burstSpan;
    if (!isInternal(url)) {
      fetchLookups.push(beginLookup(captureStack(), action ?? trace.getSpan(context.active())));
    }

    const belongs = Boolean(burstId && !isInternal(url) && !isAsset(url));
    const stamped = belongs ? withBurstHeader(input, init) : { input, init };
    rememberFetch(stamped, init?.body);
    if (belongs && burstId) {
      const key = stamped.input instanceof Request ? stamped.input : stamped.init;
      if (key) {
        fetchBursts.set(key, burstId);
      }
    }
    const send = () => originalFetch(stamped.input, stamped.init);
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

function listenForInteractions(): void {
  window.addEventListener('pointerdown', (event) => {
    const element = eventElement(event);
    if (!element || selectControl(element)) {
      return;
    }
    const previous = armedAction;
    if (startOnPointerDown(Boolean(previous && (previous.contains(element) || element.contains(previous))))) {
      beginGesture(element, event);
    }
  }, true);
  for (const eventName of ['click', 'submit', 'change'] as const) {
    document.addEventListener(eventName, (event) => recordInteraction(eventName, event), true);
  }
}

function recordInteraction(eventName: string, event: Event): void {
  const target = event.target;
  const element = target instanceof HTMLElement ? target : target instanceof Element ? target.parentElement : null;
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const select = selectControl(element);
  if ((eventName === 'click' || eventName === 'pointerdown') && select) {
    return;
  }
  if (eventName === 'change' && !select) {
    return;
  }
  if (
    eventName === 'click' &&
    clickFollowsPress(
      armedAction === element,
      Boolean(armedAction?.contains(element)),
      Boolean(armedAction && element.contains(armedAction)),
    )
  ) {
    return;
  }

  const label = select && eventName === 'change' ? selectLabel(select) : describeInteraction(eventName, element);
  if (!label) {
    return;
  }

  const span = trace.getTracer(tracerName).startSpan(eventName, {
    attributes: {
      'newtrend.ai.layer': 'frontend',
      'newtrend.ai.user_action': label,
    },
  });
  if (!holdAction(span, event)) {
    return;
  }

  attachOwner(span, element);
  span.end();
}

function selectControl(element: HTMLElement): HTMLSelectElement | null {
  if (element instanceof HTMLSelectElement) {
    return element;
  }

  if (element instanceof HTMLOptionElement) {
    return element.closest('select');
  }

  return element.closest('select');
}

function beginGesture(element: HTMLElement, event: Event): void {
  const label = pointerLabel(element);
  if (!label) {
    armedPointer = element;
    armedAction = undefined;
    return;
  }

  const span = trace.getTracer(tracerName).startSpan('click', {
    attributes: {
      'newtrend.ai.layer': 'frontend',
      'newtrend.ai.user_action': label,
    },
  });
  if (!holdAction(span, event)) {
    return;
  }

  burstOrigin = 'pointerdown';
  burstControl = element;
  armedPointer = element;
  armedAction = element;
  attachOwner(span, element);
  span.end();
}

function ensurePointerAction(): void {
  const element = armedPointer;
  if (!element || selectControl(element) || armedAction === element) {
    return;
  }

  const label = pointerLabel(element);
  if (!label) {
    return;
  }

  const span = trace.getTracer(tracerName).startSpan('click', {
    attributes: {
      'newtrend.ai.layer': 'frontend',
      'newtrend.ai.user_action': label,
    },
  });
  if (!holdAction(span)) {
    return;
  }

  burstOrigin = 'pointerdown';
  burstControl = element;
  armedAction = element;
  attachOwner(span, element);
  span.end();
}

function attachOwner(span: Span, element: HTMLElement): void {
  const owner = resolveComponent?.(controlElement(element) ?? element);
  if (!owner) {
    return;
  }

  if (owner.file || owner.name || owner.line) {
    pinComponent(span, { file: owner.file, name: owner.name, line: owner.line });
  }
  if (owner.stack && !owner.file) {
    beginLookup(owner.stack, span);
  }
  if (owner.component) {
    const prototype = Object.getPrototypeOf(owner.component) as object | null;
    if (prototype) {
      wrapMethods(prototype);
    }
  }
}

function pointerLabel(element: HTMLElement): string | null {
  return describeInteraction('click', element) ?? gestureLabel(element);
}

function gestureLabel(element: HTMLElement): string | null {
  let node: HTMLElement | null = element;
  while (node && node !== document.body && node !== document.documentElement) {
    const text = node.innerText?.replace(/\s+/g, ' ').trim() ?? '';
    if (text && text.length <= 80) {
      return `Click "${clip(text)}"`;
    }
    node = node.parentElement;
  }

  return null;
}

function eventElement(event: Event): HTMLElement | null {
  const target = event.target;
  if (target instanceof HTMLElement) {
    return target;
  }

  if (target instanceof Element) {
    return target.parentElement;
  }

  return null;
}

function eventTargetControl(event?: Event): HTMLElement | undefined {
  const target = event?.target;
  const element = target instanceof HTMLElement ? target : target instanceof Element ? target.parentElement : null;
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }

  return controlElement(element) ?? undefined;
}

function selectLabel(select: HTMLSelectElement): string {
  const chosen = select.selectedOptions[0]?.text?.replace(/\s+/g, ' ').trim() || select.value.trim();
  return `Change "${clip(chosen || controlText(select))}"`;
}

function holdAction(span: Span, event?: Event): boolean {
  if (event && event === burstEvent) {
    span.setAttribute('newtrend.ai.drop', true);
    span.end();
    return false;
  }

  if (event) {
    burstEvent = event;
  }
  finishAction();
  burstId = crypto.randomUUID();
  burstSpan = span;
  burstOrigin = event?.type;
  burstControl = eventTargetControl(event);
  span.setAttribute('newtrend.ai.burst', burstId);
  const original = span.end.bind(span);
  let ended = false;
  span.end = (time) => {
    if (ended) {
      return;
    }

    ended = true;
    span.end = original;
    original(time);
  };

  const finish = () => {
    if (burstSpan !== span) {
      return;
    }

    burstSpan = undefined;
    burstId = undefined;
    burstOrigin = undefined;
    burstControl = undefined;
    if (!ended) {
      ended = true;
      span.end = original;
      original();
    }
  };

  (span as Span & { __finish?: () => void }).__finish = finish;
  return true;
}

function finishAction(): void {
  const span = burstSpan as (Span & { __finish?: () => void }) | undefined;
  span?.__finish?.();
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

function fetchCapture(request: Request | RequestInit): HttpCapture | undefined {
  const stored = fetchCaptures.get(request);
  const headers = headerLines(request instanceof Request ? request.headers : new Headers(request.headers));
  const authorization = headers.find((line) => line.toLowerCase().startsWith('authorization:'));
  if (!stored) {
    if (!authorization) {
      return undefined;
    }

    return {
      url: request instanceof Request ? absoluteUrl(request.url) : '',
      headers: [authorization],
    };
  }

  if (authorization && !stored.headers.some((line) => line.toLowerCase().startsWith('authorization:'))) {
    return { ...stored, headers: [authorization, ...stored.headers] };
  }

  return stored;
}

function writeHttp(span: Span, capture: HttpCapture | undefined): void {
  if (!capture) {
    return;
  }

  if (capture.url) {
    span.setAttribute('url.full', capture.url);
  }
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
  return /\/v1\/traces(?:$|\?)/.test(url)
    || /:431[89](?:\/|$|\?)/.test(url)
    || /\.map(?:$|\?)/.test(url);
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
  headers.set('tracestate', traceStateWithBurst(headers.get('tracestate') ?? '', burstId ?? ''));
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
