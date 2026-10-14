import { loadInfrastructureRules, type InfrastructureRules } from './infrastructureConfig'

export function executionLabel(execution: { userAction?: string | null; traceId: string; steps: { layer: string; name: string }[] }): string {
  if (execution.userAction) return execution.userAction
  const http = execution.steps.find((step) => step.layer === 'Http')
  return http?.name || execution.steps[0]?.name || execution.traceId
}

export function layerLabel(layer: string): string {
  if (layer === 'Backend') return 'BACKEND'
  if (layer === 'Http') return 'HTTP'
  return layer
}

export function labelStatus(status: string): string {
  if (status === 'failed') return 'Failed'
  if (status === 'completed') return 'Completed'
  return 'Running'
}

export function formatMs(value: number): string {
  if (value < 1) return '<1 ms'
  if (value >= 1000) return `${(value / 1000).toFixed(1)} sec`
  return `${Math.round(value)} ms`
}

const sqlObject = /\b(?:FROM|JOIN|INTO|UPDATE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))*)/gi

export function isInfrastructure(step: { name: string; sqlText?: string | null; source?: { function?: string | null } | null }): boolean {
  const rules = loadInfrastructureRules()
  return matchesGenerated(step.name, rules.generatedPatterns)
    || matchesGenerated(step.source?.function ?? '', rules.generatedPatterns)
    || matchesText(step.name, rules.nameText)
    || matchesText(step.source?.function, rules.nameText)
    || matchesInfrastructureSql(step.sqlText, rules)
    || matchesInfrastructureSql(step.name, rules)
}

function matchesGenerated(value: string, patterns: string[]): boolean {
  if (!value) return false
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern, 'i').test(value)) return true
    } catch {
      // An invalid pattern is ignored so one bad entry cannot hide the live table.
    }
  }
  return false
}

function matchesText(value: string | null | undefined, needles: string[]): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return needles.some((needle) => needle.length > 0 && lower.includes(needle.toLowerCase()))
}

function matchesInfrastructureSql(sql: string | null | undefined, rules: InfrastructureRules): boolean {
  if (!sql) return false
  const schemas = new Set(rules.schemas.map((schema) => schema.toLowerCase()))
  const tables = new Set(rules.tables.map((table) => table.toLowerCase()))
  const prefixes = rules.tablePrefixes.map((prefix) => prefix.toLowerCase()).filter(Boolean)
  const fragments = rules.tableText.map((fragment) => fragment.toLowerCase()).filter(Boolean)
  for (const match of sql.matchAll(sqlObject)) {
    const parts = match[1].split('.').map((part) => part.trim().replace(/^\[|\]$/g, '')).filter(Boolean)
    const table = (parts[parts.length - 1] ?? '').toLowerCase()
    const schema = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : ''
    if (schemas.has(schema) || tables.has(table)) return true
    if (prefixes.some((prefix) => table.startsWith(prefix))) return true
    if (fragments.some((fragment) => table.includes(fragment))) return true
  }
  return false
}

export function sqlTables(sql: string): string[] {
  const seen = new Set<string>()
  const tables: string[] = []
  const pattern = /\b(?:FROM|JOIN|INTO|UPDATE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))*)/gi
  for (const match of sql.matchAll(pattern)) {
    const parts = match[1].split('.').map((part) => part.trim().replace(/^\[|\]$/g, '')).filter(Boolean)
    const table = parts[parts.length - 1] ?? ''
    if (!table || /^(openjson|values)$/i.test(table)) continue
    const label = parts.length > 1 ? `[${parts[parts.length - 2]}].[${table}]` : `[${table}]`
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tables.push(label)
  }
  return tables
}

export function sqlTableTitle(sql: string): string {
  const tables = sqlTables(sql)
  return tables.length > 0 ? `TABLES: ${tables.join(', ')}` : 'TABLES:'
}

const httpMethods = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE)\b/

export function toCurl(step: {
  name: string
  httpUrl?: string | null
  httpHeaders?: string | null
  httpBody?: string | null
}, steps: { name: string; httpUrl?: string | null; httpHeaders?: string | null }[] = []): string | null {
  const url = step.httpUrl?.trim()
  if (!url) return null

  const method = httpMethods.exec(step.name)?.[1] ?? 'GET'
  const insecure = localHttps(url) ? '-k ' : ''
  const parts = [`curl.exe ${insecure}-X ${method} ${powershellQuote(url)}`]
  for (const line of headersForCurl(step, steps).split(/\r?\n/)) {
    const header = line.trim()
    if (header) parts.push(`-H ${powershellQuote(header)}`)
  }
  if (step.httpBody && method !== 'GET' && method !== 'HEAD') {
    parts.push(`--data-raw ${powershellQuote(step.httpBody)}`)
  }
  return parts.join(' ')
}

function headersForCurl(
  step: { name: string; httpUrl?: string | null; httpHeaders?: string | null },
  steps: { name: string; httpUrl?: string | null; httpHeaders?: string | null }[],
): string {
  const own = step.httpHeaders ?? ''
  if (authorizationLine(own)) return own

  const path = requestPath(step)
  const donor = steps.find((other) => other !== step && requestPath(other) === path && authorizationLine(other.httpHeaders ?? ''))
  const authorization = authorizationLine(donor?.httpHeaders ?? '')
  if (!authorization) return own
  return [authorization, own].filter(Boolean).join('\n')
}

function authorizationLine(headers: string): string | null {
  return headers.split(/\r?\n/).map((line) => line.trim()).find((line) => /^authorization:/i.test(line)) ?? null
}

function requestPath(step: { name: string; httpUrl?: string | null }): string {
  const url = step.httpUrl?.trim()
  if (url) {
    try {
      return new URL(url).pathname.replace(/\/+$/, '')
    } catch {
      return url.replace(/\/+$/, '')
    }
  }

  const path = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE)\s+(\S+)/.exec(step.name)?.[1] ?? ''
  return path.replace(/\/+$/, '')
}

function localHttps(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return parsed.protocol === 'https:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
  } catch {
    return false
  }
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
