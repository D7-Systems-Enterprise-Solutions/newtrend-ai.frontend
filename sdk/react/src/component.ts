import type { ComponentOwner } from '@newtrend-ai/browser';

interface Fiber {
  type?: unknown;
  elementType?: unknown;
  return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
}

const hostComponents = new Set([
  'Fragment',
  'StrictMode',
  'Suspense',
  'Profiler',
  'SuspenseList',
]);

export function findReactComponent(start: HTMLElement): ComponentOwner | null {
  let node: HTMLElement | null = start;
  const seen = new Set<HTMLElement>();
  while (node && !seen.has(node)) {
    seen.add(node);
    const owner = ownerFromFiber(fiberOn(node));
    if (owner) {
      return owner;
    }

    node = node.parentElement;
  }

  return null;
}

function fiberOn(node: HTMLElement): Fiber | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      return (node as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }

  return null;
}

function ownerFromFiber(start: Fiber | null): ComponentOwner | null {
  let fiber: Fiber | null | undefined = start;
  const seen = new Set<Fiber>();
  let source: { file: string; line?: number } | undefined;
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    source ??= readSource(fiber);
    const type = fiber.type ?? fiber.elementType;
    const name = displayName(type);
    if (name && !hostComponents.has(name)) {
      const fn = componentFunction(type);
      return {
        name,
        file: source?.file,
        line: source?.line,
        stack: source?.file || !fn ? undefined : componentStack(fn) ?? undefined,
      };
    }

    fiber = fiber.return;
  }

  return source ? { file: source.file, line: source.line } : null;
}

const probed = new WeakMap<Function, string | null>();
let probing = false;

function componentFunction(type: unknown): Function | undefined {
  if (typeof type === 'function') {
    return type;
  }

  if (typeof type === 'object' && type) {
    const objectType = type as { render?: unknown; type?: unknown };
    return componentFunction(objectType.type) ?? componentFunction(objectType.render);
  }

  return undefined;
}

function componentStack(fn: Function): string | null {
  const cached = probed.get(fn);
  if (cached !== undefined) {
    return cached;
  }

  const text = Function.prototype.toString.call(fn);
  if (probing || text.startsWith('class ') || !/\buse[A-Z]/.test(text)) {
    probed.set(fn, null);
    return null;
  }

  probing = true;
  const report = console.error;
  console.error = () => undefined;
  let stack: string | null = null;
  try {
    fn({});
  } catch (error) {
    stack = error instanceof Error ? error.stack ?? null : null;
  } finally {
    console.error = report;
    probing = false;
  }

  probed.set(fn, stack);
  return stack;
}

function readSource(fiber: Fiber): { file: string; line?: number } | undefined {
  const fileName = fiber._debugSource?.fileName;
  if (!fileName) {
    return undefined;
  }

  const formatted = fileName.replace(/\\/g, '/').split('?')[0];
  const srcAt = formatted.lastIndexOf('/src/');
  return {
    file: srcAt >= 0 ? formatted.slice(srcAt + 1) : formatted,
    line: fiber._debugSource?.lineNumber,
  };
}

function displayName(type: unknown): string | undefined {
  if (typeof type === 'string') {
    return undefined;
  }

  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || undefined;
  }

  if (typeof type === 'object' && type) {
    const objectType = type as { displayName?: string; name?: string; render?: unknown };
    return objectType.displayName || objectType.name || displayName(objectType.render);
  }

  return undefined;
}
