const configuredBase = import.meta.env.VITE_NEW_TREND_API_URL?.trim() || 'http://127.0.0.1:4318'
const base = configuredBase.replace(/\/+$/, '')

export type SourceLocation = {
  file?: string | null
  function?: string | null
  line?: number | null
}

export type Step = {
  spanId: string
  parentSpanId?: string | null
  layer: string
  name: string
  durationMs?: number | null
  status: string
  startedAt: string
  source?: SourceLocation | null
  httpStatus?: number | null
  httpUrl?: string | null
  httpHeaders?: string | null
  httpBody?: string | null
  sqlText?: string | null
  kind?: string | null
}

export type Execution = {
  traceId: string
  userAction?: string | null
  status: string
  durationMs?: number | null
  startedAt: string
  serviceName?: string | null
  applicationVersion?: string | null
  steps: Step[]
  error?: { message?: string | null; layer?: string | null; operation?: string | null } | null
}

export type Investigation = {
  id: string
  name: string
  objective?: string | null
  status: string
  applicationVersion?: string | null
  createdAt: string
  updatedAt: string
  executionIds: string[]
}

export type Note = {
  id: string
  investigationId: string
  executionId?: string | null
  author?: string | null
  createdAt: string
  text: string
}

export type Labeled = { kind: string; text: string }

export type InvestigationAnswer = {
  summary: string
  whatHappened: Labeled[]
  failureLocation: Labeled[]
  suspiciousOperations: Labeled[]
  recommendedInspection: Labeled[]
  missingInformation: Labeled[]
}

export type Baseline = {
  id: string
  name: string
  featureKey: string
  executionId: string
  applicationVersion?: string | null
}

export type BehaviorDiff = {
  kind: string
  expected: string[]
  observed: string[]
  added: string[]
  removed: string[]
  changed: string[]
  reordered: string[]
}

export type MapNode = { name: string; type: string; children: MapNode[] }

export type LayerShare = { layer: string; durationMs: number; share: number }

export type SlowSql = {
  userAction?: string | null
  endpoint?: string | null
  handler?: string | null
  repository?: string | null
  statement?: string | null
  durationMs?: number | null
  file?: string | null
  line?: number | null
  traceId: string
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  clearSession: () => send<void>('/api/session', { method: 'DELETE' }),
  startTrace: (traceId?: string) =>
    send<void>('/api/session/trace', { method: 'POST', body: JSON.stringify({ traceId }) }),
  setBurstLimit: (maxItems: number) =>
    send<void>('/api/session/burst-limit', { method: 'PUT', body: JSON.stringify({ maxItems }) }),
  investigations: (q?: string) => send<Investigation[]>(`/api/investigations${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createInvestigation: (name: string, objective: string) =>
    send<Investigation>('/api/investigations', { method: 'POST', body: JSON.stringify({ name, objective }) }),
  deleteInvestigation: (id: string) => send<void>(`/api/investigations/${id}`, { method: 'DELETE' }),
  timeline: (id: string) => send<Execution[]>(`/api/investigations/${id}/timeline`),
  attach: (id: string, traceId: string) =>
    send<Investigation>(`/api/investigations/${id}/executions`, { method: 'POST', body: JSON.stringify({ traceId }) }),
  notes: (id: string) => send<Note[]>(`/api/investigations/${id}/notes`),
  addNote: (id: string, text: string, executionId?: string) =>
    send<Note>(`/api/investigations/${id}/notes`, { method: 'POST', body: JSON.stringify({ text, author: 'D7', executionId }) }),
  investigate: (id: string) => send<InvestigationAnswer>(`/api/investigations/${id}/investigate`, { method: 'POST', body: '{}' }),
  packageUrl: (id: string) => `${base}/api/investigations/${id}/package`,
  baselines: () => send<Baseline[]>('/api/baselines'),
  saveBaseline: (name: string, executionId: string, featureKey: string) =>
    send<Baseline>('/api/baselines', { method: 'POST', body: JSON.stringify({ name, executionId, featureKey }) }),
  compare: (executionId: string, baselineId: string) =>
    send<BehaviorDiff>(`/api/executions/${executionId}/compare/${baselineId}`, { method: 'POST' }),
  map: (feature: string) => send<MapNode>(`/api/behavior/map?feature=${encodeURIComponent(feature)}`),
  performance: (executionId: string) =>
    send<{ bottleneck: LayerShare[]; repeated: { statement: string; occurrences: number; repeatedReadInLoop: boolean }[]; slowSql: SlowSql | null }>(
      `/api/performance/${executionId}`,
    ),
  history: (operationKey: string) =>
    send<{ versions: { version?: string | null; metrics: { average: number; p50: number; p95: number; p99: number; maximum: number } }[] }>(
      `/api/performance/history?operationKey=${encodeURIComponent(operationKey)}`,
    ),
  compareVersions: (operationKey: string, versionA: string, versionB: string) =>
    send<{ valueA: number; valueB: number; changePercent: number; metric: string }>(
      `/api/performance/compare?operationKey=${encodeURIComponent(operationKey)}&versionA=${encodeURIComponent(versionA)}&versionB=${encodeURIComponent(versionB)}`,
    ),
  explainPerformance: (executionId: string) =>
    send<{ measuredFacts: string[]; likelyContributors: string[]; recommendations: string[] }>(
      `/api/performance/${executionId}/explain`,
      { method: 'POST', body: '{}' },
    ),
  agentInvestigate: (executionId: string) =>
    send<{ evidence: string[]; hypothesis: string; confidence: string; relatedFiles: string[] }>('/api/agent/investigate', {
      method: 'POST',
      body: JSON.stringify({ executionId }),
    }),
}
