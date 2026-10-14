import { useEffect, useId, useRef } from 'react'
import type { Execution, Step } from './api'
import { executionLabel, formatClock, formatMs, labelStatus, layerLabel } from './format'

const chartTrack = {
  backgroundColor: 'var(--color-housing)',
  backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--color-ink) 16%, transparent) 1px, transparent 1px)',
  backgroundSize: '25% 100%',
} as const

export function RoadmapDialog({ execution, onClose }: { execution: Execution; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const titleId = useId()
  const title = executionLabel(execution)
  const byDuration = [...execution.steps].sort(compareDuration)
  const longest = byDuration[0]
  const maxDuration = longest?.durationMs ?? 0
  const layers = [...new Set(execution.steps.map((step) => step.layer))]

  useEffect(() => {
    const node = dialog.current
    if (!node) return
    let opened = false
    const handle = () => {
      if (opened) close.current()
    }
    const frame = requestAnimationFrame(() => {
      if (!node.isConnected || node.open) return
      node.showModal()
      opened = true
    })
    node.addEventListener('close', handle)
    return () => {
      cancelAnimationFrame(frame)
      node.removeEventListener('close', handle)
      if (node.open) node.close()
    }
  }, [execution.traceId])

  function requestClose() {
    dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="panel m-auto max-h-[92vh] w-[min(76rem,calc(100%-2rem))] overflow-auto p-0 text-ink shadow-none"
      onClick={(event) => {
        if (event.target === dialog.current) requestClose()
      }}
    >
      <header className="sticky top-0 z-20 border-b border-rule bg-tape px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 inline-block bg-signal px-2 py-0.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-on-signal">Timeline</p>
            <h2 id={titleId} className="m-0 mt-3 w-fit max-w-full pb-1 text-2xl font-bold leading-tight tracking-tight shadow-[inset_0_-3px_0_var(--color-signal)]">
              {title}
            </h2>
            <p className="m-0 mt-2 font-mono text-sm text-quiet">
              {execution.steps.length} {execution.steps.length === 1 ? 'step' : 'steps'}
              {execution.durationMs != null ? ` · ${formatMs(execution.durationMs)}` : ''}
              {` · ${labelStatus(execution.status)}`}
              {execution.startedAt ? ` · ${formatStamp(execution.startedAt)}` : ''}
            </p>
          </div>
          <button type="button" className="shrink-0 border border-ink px-3 py-1 text-sm" onClick={requestClose}>
            Close
          </button>
        </div>
        {layers.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {layers.map((layer) => <LayerChip key={layer} layer={layer} />)}
          </div>
        ) : null}
      </header>

      <div className="px-5 py-5">
        {execution.steps.length === 0 ? (
          <p className="m-0 border border-dashed border-rule bg-field px-4 py-6 text-quiet">This burst has no steps yet.</p>
        ) : (
            <section aria-label="Duration">
              <h3 className="m-0 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em]">
                <span className="size-2 bg-signal" aria-hidden="true" />
                Duration
              </h3>
              <p className="m-0 mt-1 max-w-[62ch] text-sm text-quiet">Steps ordered by duration. Bar length is the duration, so the slow parts are easy to see.</p>
              <div className="mt-4 min-w-[36rem] border border-rule bg-tape">
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] gap-x-3 border-b border-rule px-3 py-2">
                  <span />
                  <Scale max={Math.max(maxDuration, 1)} />
                  <span className="self-end text-right text-[0.65rem] font-bold uppercase tracking-[0.12em] text-quiet">Time</span>
                </div>
                <ol className="m-0 list-none p-0">
                  {byDuration.map((step, index) => {
                    return (
                      <li key={step.spanId} className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 border-t border-rule px-3 py-3 hover:bg-signal/10">
                        <span className="font-display text-xl font-bold leading-none text-quiet">{index + 1}</span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-baseline gap-2">
                            {index === 0 && (step.durationMs ?? 0) > 0 ? <span className="shrink-0 bg-signal px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-on-signal">Longest</span> : null}
                            <LayerChip layer={step.layer} />
                            {step.status === 'failed' ? <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-fail">Failed</span> : null}
                            <span className="min-w-0 flex-1 truncate" title={step.name}>{step.name}</span>
                            <time className="shrink-0 font-mono text-xs text-quiet" dateTime={step.startedAt}>{formatStamp(step.startedAt)}</time>
                          </div>
                          <div className="relative mt-2 h-3" style={chartTrack} title={`${step.name} · ${durationText(step)}`}>
                            <span
                              className={`absolute inset-y-0 left-0 z-10 ${step.status === 'failed' ? 'bg-fail' : 'bg-signal'}`}
                              style={{ width: `${durationWidth(step, maxDuration)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-right font-mono text-sm">{durationText(step)}</span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </section>
        )}
      </div>
    </dialog>
  )
}

function Scale({ max }: { max: number }) {
  return (
    <div className="relative h-4 font-mono text-[0.65rem] text-quiet">
      <span className="absolute left-0 top-0">0</span>
      <span className="absolute left-1/2 top-0 -translate-x-1/2">{formatMs(max / 2)}</span>
      <span className="absolute right-0 top-0">{formatMs(max)}</span>
    </div>
  )
}

function LayerChip({ layer }: { layer: string }) {
  const tone =
    layer === 'Frontend'
      ? 'bg-[#f97316] text-[#1c1004]'
      : layer === 'Http'
        ? 'bg-[#3b82f6] text-white'
        : layer === 'Backend'
          ? 'bg-[#16a34a] text-white'
          : layer === 'Sql'
            ? 'bg-[#8b5cf6] text-white'
            : 'bg-rule text-ink'
  return <span className={`inline-block shrink-0 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${tone}`}>{layerLabel(layer)}</span>
}

function durationText(step: Step): string {
  return step.durationMs != null ? formatMs(step.durationMs) : 'Running'
}

function formatStamp(value: string): string {
  const clock = formatClock(value)
  if (!clock) return ''
  const date = new Date(value)
  return `${clock}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function layerRank(layer: string): number {
  if (layer === 'Frontend') return 0
  if (layer === 'Http') return 1
  if (layer === 'Backend') return 2
  if (layer === 'Sql') return 3
  return 4
}

function compareStart(a: Step, b: Step): number {
  const delta = Date.parse(a.startedAt) - Date.parse(b.startedAt)
  if (delta !== 0 && !Number.isNaN(delta)) return delta
  return layerRank(a.layer) - layerRank(b.layer)
}

function compareDuration(a: Step, b: Step): number {
  const delta = (b.durationMs ?? -1) - (a.durationMs ?? -1)
  if (delta !== 0) return delta
  return compareStart(a, b)
}

function durationWidth(step: Step, max: number): number {
  if (max <= 0 || step.durationMs == null || step.durationMs <= 0) return 0
  return Math.min(100, Math.max(0.8, (step.durationMs / max) * 100))
}
