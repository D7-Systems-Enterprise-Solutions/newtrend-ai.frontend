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
