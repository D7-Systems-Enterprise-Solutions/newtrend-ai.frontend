const storageKey = 'ai-newtrend-theme'

export type Theme = 'day' | 'dark'

export function initTheme(): Theme {
  const stored = localStorage.getItem(storageKey)
  const theme: Theme = stored === 'day' || stored === 'dark'
    ? stored
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'day'
  applyTheme(theme)
  return theme
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  localStorage.setItem(storageKey, theme)
}
