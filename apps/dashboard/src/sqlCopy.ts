import { sqlTables } from './format'

const storageKey = 'newtrendai--sql-ai-prompt'

export const defaultAiPrompt =
  'Explica el proposito exacto de esta sentencia.\nAdemás genera 2 opciones mas con mejoras de rendimiento: {sql}'

export function loadAiPrompt(): string {
  const stored = localStorage.getItem(storageKey)
  return stored == null || stored.trim() === '' ? defaultAiPrompt : stored
}

export function saveAiPrompt(prompt: string) {
  localStorage.setItem(storageKey, prompt)
}

export function copyAsIs(sql: string): string {
  return sql
}

export function copyInvolvedTables(sql: string): string {
  return sqlTables(sql).map((table) => `SELECT * FROM ${table}`).join('\n\n')
}

export function copyForAi(sql: string, prompt = loadAiPrompt()): string {
  if (prompt.includes('{sql}')) return prompt.replaceAll('{sql}', sql)
  const trimmed = prompt.trimEnd()
  return trimmed ? `${trimmed}\n${sql}` : sql
}
