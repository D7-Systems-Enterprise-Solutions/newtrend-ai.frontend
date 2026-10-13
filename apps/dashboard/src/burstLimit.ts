export const maxBurstItems = 350
export const defaultBurstItems = 350

const storageKey = 'newtrendai--burst-items'

export function loadBurstItems(): number {
  const stored = localStorage.getItem(storageKey)
  if (stored == null) return defaultBurstItems
  return clampBurstItems(Number(stored)) ?? defaultBurstItems
}

export function clampBurstItems(value: number): number | null {
  if (!Number.isInteger(value) || value < 1 || value > maxBurstItems) return null
  return value
}

export function saveBurstItems(value: number): number {
  const next = clampBurstItems(value)
  if (next == null) throw new Error('Maximum items must be from 1 to 350.')
  localStorage.setItem(storageKey, String(next))
  return next
}
