import { type Span } from '@opentelemetry/api';

export interface CallerSource {
  file?: string;
  name?: string;
  line?: number;
}

interface Frame {
  name?: string;
  file: string;
  line: number;
  column: number;
}

interface RawMap {
  sources?: string[];
  names?: string[];
  mappings?: string;
  sourceRoot?: string;
  indexed?: MappedSegment[][];
}

interface MappedSegment {
  generatedColumn: number;
  file: string;
  line: number;
  name?: string;
}

export interface SourceLookup {
  source?: CallerSource;
  done: boolean;
  parent?: Span;
}

const sourced = new WeakMap<Span, number>();
const preferredFiles = new WeakMap<Span, string>();
const writtenFiles = new WeakMap<Span, string>();
const maps = new Map<string, Promise<RawMap | null>>();
const readyMaps = new Map<string, RawMap | null>();
const vlq = new Map<string, number>(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .map((char, index) => [char, index]),
);

interface Hold {
  pending: number;
  ended: boolean;
  endTime?: Parameters<Span['end']>[0];
  original: Span['end'];
}

const holds = new WeakMap<Span, Hold>();

export function captureStack(): string {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = 80;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = previous;
  return stack;
}

export function pinComponent(span: Span, source: CallerSource): void {
  if (source.file) {
    preferredFiles.set(span, source.file);
  }
  writeSource(span, source);
}

export function beginLookup(stack: string, parent: Span | undefined): SourceLookup {
  const lookup: SourceLookup = { done: false, parent };
  const preferred = parent ? preferredFiles.get(parent) : undefined;
  const immediate = locateCaller(stack, undefined, preferred);
  if (immediate?.file && parent) {
    lookup.source = immediate;
    lookup.done = true;
    if (!preferred) {
      writeSource(parent, immediate);
    }
    return lookup;
  }

  if (parent) {
    track(parent);
  }

  void callerFromStack(stack, preferred)
    .then((source) => {
      lookup.source = source ?? immediate ?? undefined;
      if (lookup.source && parent?.isRecording() && !preferredFiles.has(parent)) {
        writeSource(parent, lookup.source);
      }
    })
    .finally(() => {
      lookup.done = true;
      release(parent);
    });
  return lookup;
}

function track(span: Span): void {
  let hold = holds.get(span);
  if (!hold) {
    const original = span.end.bind(span);
    hold = { pending: 0, ended: false, original };
    holds.set(span, hold);
    span.end = (endTime) => {
      const current = holds.get(span);
      if (!current) {
        original(endTime);
        return;
      }

      current.ended = true;
      current.endTime = endTime;
      finishHold(span);
    };
  }

  hold.pending += 1;
}

function release(span: Span | undefined): void {
  if (!span) {
    return;
  }

  const hold = holds.get(span);
  if (!hold) {
    return;
  }

  hold.pending = Math.max(0, hold.pending - 1);
  finishHold(span);
}

function finishHold(span: Span): void {
  const hold = holds.get(span);
  if (!hold || !hold.ended || hold.pending > 0) {
    return;
  }

  holds.delete(span);
  span.end = hold.original;
  hold.original(hold.endTime);
}

export function finishLookup(span: Span, lookup: SourceLookup | undefined): void {
  if (!lookup?.done || !lookup.source || sourced.has(span)) {
    return;
  }

  writeSource(span, lookup.source);
}

export function preloadSourceMaps(): void {
  const seen = new Set<string>();
  const scan = () => {
    document.querySelectorAll('script[src]').forEach((node) => {
      const src = (node as HTMLScriptElement).src.split('?')[0];
      if (!src || seen.has(src) || isIgnored(src)) {
        return;
      }

      seen.add(src);
      void loadMap(src);
    });
  };

  scan();
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
}

export function locateCaller(stack: string, methodName?: string, preferredFile?: string): CallerSource | null {
  const frames = parseFrames(stack);
  let html: CallerSource | null = null;
  for (const frame of frames) {
    if (isIgnored(frame.file)) {
      continue;
    }

    const source = isSourceFile(frame.file)
      ? toSource(frame.file, frame.line, methodName ?? frame.name)
      : mappedFrame(frame, methodName);
    if (!source?.file || (preferredFile && !sameComponent(source.file, preferredFile))) {
      continue;
    }
    if (preferredFile || source.file.endsWith('.ts')) {
      return source;
    }
    html ??= source;
  }

  if (preferredFile) {
    return html;
  }

  if (html) {
    return html;
  }

  const name = cleanName(methodName);
  return name ? { name } : null;
}

function mappedFrame(frame: Frame, methodName?: string): CallerSource | null {
  if (!/\.js(?:$|\?)/.test(frame.file)) {
    return null;
  }

  const map = readyMaps.get(frame.file.split('?')[0]);
  if (!map?.mappings || !map.sources) {
    return null;
  }

  const position = originalPosition(map, frame.line, frame.column);
  if (!position) {
    return null;
  }

  return toSource(position.file, position.line, methodName ?? position.name ?? frame.name, map.sourceRoot);
}

export function writeSource(span: Span, source: CallerSource): void {
  if (!span.isRecording()) {
    return;
  }

  const preferred = preferredFiles.get(span);
  if (preferred && source.file && !sameComponent(source.file, preferred)) {
    return;
  }

  const previous = writtenFiles.get(span);
  const sameFile = previous && source.file ? sameComponent(previous, source.file) : false;
  const next = sourceRank(source.file);
  const current = sourced.get(span) ?? 0;
  if (!sameFile && current > 0 && next <= current) {
    return;
  }

  if (source.file) {
    span.setAttribute('code.file.path', source.file);
  }
  if (source.name) {
    span.setAttribute('code.function.name', source.name);
  }
  if (source.line) {
    span.setAttribute('code.line.number', source.line);
  }
  if (source.file) {
    writtenFiles.set(span, source.file);
  }
  if (next > 0) {
    sourced.set(span, next);
  }
}

function sameComponent(file: string, other: string): boolean {
  return componentKey(file) === componentKey(other);
}

function componentKey(file: string): string {
  const name = file.replace(/\\/g, '/').split('/').pop() ?? file;
  return name.replace(/\.(ts|html|scss|css)$/i, '');
}

function sourceRank(file: string | undefined): number {
  if (!file) {
    return 0;
  }
  if (file.endsWith('.ts') || file.endsWith('.cs')) {
    return 3;
  }
  if (file.endsWith('.html')) {
    return 2;
  }
  return 1;
}

function parseFrames(stack: string): Frame[] {
  return stack.split('\n').map(parseFrame).filter((frame): frame is Frame => frame !== null);
}

async function callerFromStack(stack: string, preferredFile?: string): Promise<CallerSource | null> {
  const immediate = locateCaller(stack, undefined, preferredFile);
  if (immediate?.file) {
    return immediate;
  }

  const frames = parseFrames(stack);
  let html: CallerSource | null = null;
  for (const frame of frames) {
    if (isIgnored(frame.file) || !/\.js(?:$|\?)/.test(frame.file)) {
      continue;
    }

    const mapped = await mapFrame(frame);
    if (!mapped?.file || (preferredFile && !sameComponent(mapped.file, preferredFile))) {
      continue;
    }
    if (preferredFile || mapped.file.endsWith('.ts')) {
      return mapped;
    }
    html ??= mapped;
  }

  return html;
}

function toSource(file: string, line: number, name?: string, sourceRoot?: string): CallerSource | null {
  const formatted = formatSource(file, sourceRoot);
  if (!formatted || isIgnored(formatted)) {
    return null;
  }

  return {
    file: formatted,
    line,
    name: cleanName(name),
  };
}

async function mapFrame(frame: Frame): Promise<CallerSource | null> {
  const script = frame.file.split('?')[0];
  if (!/^https?:\/\//.test(script)) {
    return null;
  }

  const map = await loadMap(script);
  if (!map?.mappings || !map.sources) {
    return null;
  }

  const position = originalPosition(map, frame.line, frame.column);
  if (!position) {
    return null;
  }

  return toSource(position.file, position.line, position.name ?? frame.name, map.sourceRoot);
}

async function loadMap(script: string): Promise<RawMap | null> {
  const cached = maps.get(script);
  if (cached) {
    return cached;
  }

  const task = readMap(script)
    .then((map) => {
      if (map) {
        indexMap(map);
      }
      readyMaps.set(script, map);
      return map;
    })
    .catch(() => {
      readyMaps.set(script, null);
      return null;
    });
  maps.set(script, task);
  return task;
}

async function readMap(script: string): Promise<RawMap | null> {
  const scriptResponse = await fetch(script, { signal: AbortSignal.timeout(1500) });
  if (scriptResponse.ok) {
    const text = await scriptResponse.text();
    const markers = [...text.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
    const mappingUrl = markers.at(-1)?.[1];
    if (mappingUrl) {
      const inline = decodeInlineMap(mappingUrl);
      if (inline) {
        return inline;
      }

      const resolved = new URL(mappingUrl, script).href;
      const mapped = await fetch(resolved, { signal: AbortSignal.timeout(1500) });
      if (mapped.ok) {
        return (await mapped.json()) as RawMap;
      }
    }
  }

  const external = await fetch(`${script}.map`, { signal: AbortSignal.timeout(1500) });
  return external.ok ? ((await external.json()) as RawMap) : null;
}

function decodeInlineMap(mappingUrl: string): RawMap | null {
  if (!mappingUrl.startsWith('data:application/json')) {
    return null;
  }

  const encoded = mappingUrl.slice(mappingUrl.indexOf(',') + 1);
  const json = mappingUrl.includes(';base64,') ? atob(encoded) : decodeURIComponent(encoded);
  return JSON.parse(json) as RawMap;
}

function indexMap(map: RawMap): void {
  const rows = map.mappings?.split(';') ?? [];
  const sources = map.sources ?? [];
  const names = map.names ?? [];
  let sourceIndex = 0;
  let originalLine = 0;
  let nameIndex = 0;
  map.indexed = rows.map((row) => {
    const segments: MappedSegment[] = [];
    let generatedColumn = 0;
    for (const segment of row.split(',')) {
      if (!segment) {
        continue;
      }

      const cursor = { i: 0 };
      generatedColumn += decodeVlq(segment, cursor);
      if (cursor.i >= segment.length) {
        continue;
      }

      sourceIndex += decodeVlq(segment, cursor);
      originalLine += decodeVlq(segment, cursor);
      decodeVlq(segment, cursor);
      let name: string | undefined;
      if (cursor.i < segment.length) {
        nameIndex += decodeVlq(segment, cursor);
        name = names[nameIndex];
      }

      const file = sources[sourceIndex];
      if (file) {
        segments.push({ generatedColumn, file, line: originalLine + 1, name });
      }
    }
    return segments;
  });
}

function originalPosition(
  map: RawMap,
  line: number,
  column: number,
): { file: string; line: number; name?: string } | null {
  if (!map.indexed) {
    indexMap(map);
  }

  const segments = map.indexed?.[line - 1];
  if (!segments?.length) {
    return null;
  }

  const target = Math.max(column - 1, 0);
  let found: MappedSegment | null = null;
  for (const segment of segments) {
    if (segment.generatedColumn > target) {
      break;
    }
    found = segment;
  }

  return found ? { file: found.file, line: found.line, name: found.name } : null;
}

function decodeVlq(input: string, cursor: { i: number }): number {
  let value = 0;
  let shift = 0;
  let digit = 0;
  do {
    if (cursor.i >= input.length) {
      return 0;
    }
    digit = vlq.get(input[cursor.i++]) ?? 0;
    value |= (digit & 31) << shift;
    shift += 5;
  } while (digit & 32);

  const magnitude = value >> 1;
  return value & 1 ? -magnitude : magnitude;
}

function parseFrame(raw: string): Frame | null {
  let text = raw.trim();
  if (!text.startsWith('at ')) {
    return null;
  }

  text = text.slice(3);
  let name: string | undefined;
  if (text.endsWith(')')) {
    const open = text.lastIndexOf(' (');
    if (open >= 0) {
      name = text.slice(0, open).replace(/^async\s+/, '');
      text = text.slice(open + 2, -1);
    }
  }

  const location = /^(.*):(\d+):(\d+)$/.exec(text);
  if (!location) {
    return null;
  }

  return {
    name,
    file: location[1],
    line: Number(location[2]),
    column: Number(location[3]),
  };
}

function isSourceFile(file: string): boolean {
  return /\.(?:ts|html|cs)(?:$|\?)/.test(file);
}

function isIgnored(file: string): boolean {
  return /node_modules|zone\.js|@angular[\\/]|@opentelemetry|rxjs|polyfills|vite[\\/]deps|@newtrend-ai|source-location|\/sdk\/angular/i.test(
    file,
  );
}

function formatSource(file: string, sourceRoot?: string): string | null {
  let formatted = file.replace(/^webpack:\/\/(?:\.\/)?/, '').replace(/^webpack:\/\/[^/]+\//, '');
  formatted = formatted.split('?')[0].replace(/\\/g, '/');
  if (sourceRoot && !formatted.startsWith('/') && !/^[A-Za-z]:\//.test(formatted) && !formatted.startsWith('http')) {
    formatted = `${sourceRoot.replace(/\/$/, '')}/${formatted.replace(/^\.\//, '')}`;
  }

  const srcAt = formatted.lastIndexOf('/src/');
  if (srcAt >= 0) {
    return formatted.slice(srcAt + 1);
  }
  if (formatted.startsWith('src/')) {
    return formatted;
  }

  return formatted || null;
}

function cleanName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const trimmed = name.replace(/^async\s+/, '').trim();
  if (!trimmed || trimmed === 'eval' || trimmed === '<anonymous>' || /^[a-zA-Z_$]$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
