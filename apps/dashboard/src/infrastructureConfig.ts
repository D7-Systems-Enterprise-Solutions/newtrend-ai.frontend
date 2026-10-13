export type InfrastructureRules = {
  generatedPatterns: string[]
  nameText: string[]
  schemas: string[]
  tables: string[]
  tablePrefixes: string[]
  tableText: string[]
}

const storageKey = 'newtrendai--infrastructure'

export const defaultInfrastructureRules: InfrastructureRules = {
  generatedPatterns: [
    'lambda_method\\d+',
    '<>c',
    '\\+<',
    'b__',
    '\\$\\$Lambda',
    'lambda\\$',
    '\\$\\$EnhancerBy',
    '\\$\\$FastClassBy',
    'GeneratedMethodAccessor',
    '\\$Proxy',
    'runtime\\.',
    'reflect\\.',
    '\\.func\\d+',
  ],
  nameText: ['permission', 'authorization', 'authentication', 'credential', 'authsession'],
  schemas: ['identity', 'auth', 'security'],
  tables: [
    'Users',
    'Roles',
    'Claims',
    'Permissions',
    'UserRoles',
    'AuthSessions',
    'CredentialAccounts',
    'RefreshTokens',
    'authorities',
  ],
  tablePrefixes: ['AspNet'],
  tableText: ['credential', 'permission', 'token'],
}

export function loadInfrastructureRules(): InfrastructureRules {
  const stored = localStorage.getItem(storageKey)
  if (stored == null) return cloneRules(defaultInfrastructureRules)
  try {
    return normalizeRules(JSON.parse(stored))
  } catch {
    return cloneRules(defaultInfrastructureRules)
  }
}

export function saveInfrastructureRules(rules: InfrastructureRules): void {
  localStorage.setItem(storageKey, JSON.stringify(normalizeRules(rules)))
}

function normalizeRules(value: unknown): InfrastructureRules {
  const record = value && typeof value === 'object' ? (value as Partial<InfrastructureRules>) : {}
  return {
    generatedPatterns: cleanList(record.generatedPatterns, defaultInfrastructureRules.generatedPatterns),
    nameText: cleanList(record.nameText, defaultInfrastructureRules.nameText),
    schemas: cleanList(record.schemas, defaultInfrastructureRules.schemas),
    tables: cleanList(record.tables, defaultInfrastructureRules.tables),
    tablePrefixes: cleanList(record.tablePrefixes, defaultInfrastructureRules.tablePrefixes),
    tableText: cleanList(record.tableText, defaultInfrastructureRules.tableText),
  }
}

function cleanList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return [...fallback]
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function cloneRules(rules: InfrastructureRules): InfrastructureRules {
  return {
    generatedPatterns: [...rules.generatedPatterns],
    nameText: [...rules.nameText],
    schemas: [...rules.schemas],
    tables: [...rules.tables],
    tablePrefixes: [...rules.tablePrefixes],
    tableText: [...rules.tableText],
  }
}
