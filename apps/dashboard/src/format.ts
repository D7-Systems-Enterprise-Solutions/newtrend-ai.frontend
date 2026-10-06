export function executionLabel(execution: { userAction?: string | null; traceId: string; steps: { layer: string; name: string }[] }): string {
  if (execution.userAction) return execution.userAction
  const http = execution.steps.find((step) => step.layer === 'Http')
  return http?.name || execution.steps[0]?.name || execution.traceId
}

export function layerLabel(layer: string): string {
  if (layer === 'Backend') return '.NET'
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

const generatedMethod = /lambda_method\d+|<>c|\+<|b__/i
const sqlObject = /\b(?:FROM|JOIN|INTO|UPDATE)\s+((?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*))*)/gi
const authTables = new Set(['users', 'roles', 'claims', 'permissions', 'userroles', 'authsessions', 'credentialaccounts', 'refreshtokens'])

export function isInfrastructure(step: { kind?: string | null; name: string; sqlText?: string | null; source?: { function?: string | null } | null }): boolean {
  if (step.kind === 'infrastructure') return true
  return generatedMethod.test(step.name)
    || generatedMethod.test(step.source?.function ?? '')
    || isInfrastructureMethod(step.name)
    || isInfrastructureMethod(step.source?.function)
    || isInfrastructureSql(step.sqlText)
    || isInfrastructureSql(step.name)
}

function isInfrastructureMethod(value?: string | null): boolean {
  if (!value) return false
  return /permission|authorization|credential|authsession/i.test(value)
}

function isInfrastructureSql(sql?: string | null): boolean {
  if (!sql) return false
  for (const match of sql.matchAll(sqlObject)) {
    const parts = match[1].split('.').map((part) => part.trim().replace(/^\[|\]$/g, '')).filter(Boolean)
    const table = (parts[parts.length - 1] ?? '').toLowerCase()
    const schema = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : ''
    if (schema === 'identity' || schema === 'auth' || schema === 'security') return true
    if (authTables.has(table)) return true
    if (table.startsWith('aspnet')) return true
    if (/credential|permission|token/i.test(table)) return true
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
}): string | null {
  const url = step.httpUrl?.trim()
  if (!url) return null

  const method = httpMethods.exec(step.name)?.[1] ?? 'GET'
  const insecure = localHttps(url) ? '-k ' : ''
  const parts = [`curl.exe ${insecure}-X ${method} ${powershellQuote(url)}`]
  for (const line of (step.httpHeaders ?? '').split(/\r?\n/)) {
    const header = line.trim()
    if (header) parts.push(`-H ${powershellQuote(header)}`)
  }
  if (step.httpBody && method !== 'GET' && method !== 'HEAD') {
    parts.push(`--data-raw ${powershellQuote(step.httpBody)}`)
  }
  return parts.join(' ')
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
