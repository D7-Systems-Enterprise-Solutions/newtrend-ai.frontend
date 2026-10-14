import {
  activeTraceId,
  initNewtrendAi as initBrowser,
  traceUserAction,
  type UserActionDetails,
} from '@newtrend-ai/browser';
import { findAngularComponent } from './angular-component';

export interface NewtrendAiOptions {
  appName: string;
  /** OTLP HTTP base address. /v1/traces is appended when missing. */
  endpoint?: string;
  /** URLs that receive the W3C traceparent header. Defaults to every URL. */
  propagateTo?: RegExp | RegExp[];
}

export type { UserActionDetails };
export { activeTraceId, traceUserAction };

export function initNewtrendAi(options: NewtrendAiOptions): void {
  initBrowser({
    ...options,
    tracerName: '@Newtrend-ai/angular',
    resolveComponent: findAngularComponent,
  });
}
