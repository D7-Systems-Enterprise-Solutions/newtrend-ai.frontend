import type { ComponentOwner } from '@newtrend-ai/browser';

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

export function findAngularComponent(start: HTMLElement): ComponentOwner | null {
  const ng = (window as unknown as { ng?: NgGlobal }).ng;
  if (!ng?.getComponent && !ng?.getOwningComponent) {
    return null;
  }

  return owningAppComponent(ng, start) ?? owningAppComponent(ng, overlayTrigger(start));
}

function owningAppComponent(ng: NgGlobal, start: HTMLElement | null): ComponentOwner | null {
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
