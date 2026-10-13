import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type Execution, type Investigation, type Step } from './api'
import { loadBurstItems } from './burstLimit'
import { executionLabel, formatClock, formatMs, isInfrastructure, labelStatus, layerLabel, sqlTableTitle, toCurl } from './format'
import { RoadmapDialog } from './RoadmapDialog'
import { copyAsIs, copyForAi, copyInvolvedTables } from './sqlCopy'

type Snapshot = { type: string; executions: Execution[]; epoch?: number }
type Tab = 'execution' | 'technical'

const socketUrl = 'ws://127.0.0.1:4319/live'

export function LiveView({ investigations, onAttached }: { investigations: Investigation[]; onAttached: () => void }) {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [connected, setConnected] = useState(false)
  const [tab, setTab] = useState<Tab>('execution')
  const [selected, setSelected] = useState<string>('')
  const [tableCleared, setTableCleared] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [roadmapExecution, setRoadmapExecution] = useState<Execution | null>(null)
  const [receiving, setReceiving] = useState(true)
  const [message, setMessage] = useState('')
  const knownIds = useRef<Set<string>>(new Set())
  const epoch = useRef(0)
  const ignoreThroughEpoch = useRef<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const rolledBursts = useRef<Set<string>>(new Set())
  const current = tableCleared
    ? undefined
    : executions.find((execution) => execution.traceId === selected) ?? executions.find((execution) => execution.userAction) ?? executions[0]
  useEffect(() => {
    if (!receiving) {
      setConnected(false)
      return
    }

    let socket: WebSocket | undefined
    let stopped = false
    let retry: number | undefined
    const connect = () => {
      socket = new WebSocket(socketUrl)
      socket.onopen = () => setConnected(true)
      socket.onclose = () => {
        setConnected(false)
        if (!stopped) retry = window.setTimeout(connect, 1000)
      }
      socket.onerror = () => socket?.close()
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as Snapshot
        if (typeof snapshot.epoch === 'number') {
          if (ignoreThroughEpoch.current != null && snapshot.epoch <= ignoreThroughEpoch.current) return
          if (snapshot.epoch < epoch.current) return
          ignoreThroughEpoch.current = null
          epoch.current = snapshot.epoch
        }
        const next = snapshot.executions ?? []
        const shown = next.find((execution) => execution.traceId === selectedRef.current)
          ?? next.find((execution) => execution.userAction)
          ?? next[0]
        if (shown && shown.steps.length >= loadBurstItems() && !rolledBursts.current.has(shown.traceId)) {
          rolledBursts.current.add(shown.traceId)
          knownIds.current = new Set(next.map((execution) => execution.traceId))
          setTableCleared(true)
          setRoadmapExecution(null)
          api.startTrace().catch(() => {
            rolledBursts.current.delete(shown.traceId)
          })
        }
        setExecutions(next)
        setTableCleared((cleared) => {
          if (!cleared) return false
          const fresh = next.find((execution) => !knownIds.current.has(execution.traceId))
          if (!fresh) return true
          setSelected(fresh.traceId)
          return false
        })
        knownIds.current = new Set(next.map((execution) => execution.traceId))
      }
    }
    connect()
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      socket?.close()
    }
  }, [receiving])

  useEffect(() => {
    if (!listOpen) return
    const close = () => setListOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [listOpen])

  async function clearSession() {
    const confirmed = window.confirm('Clear this session? The execution list and the table will be removed.')
    if (!confirmed) return
    setMessage('')
    ignoreThroughEpoch.current = epoch.current
    setExecutions([])
    setSelected('')
    setTableCleared(false)
    setRoadmapExecution(null)
    knownIds.current = new Set()
    try {
      await api.clearSession()
    } catch (error) {
      ignoreThroughEpoch.current = null
      setMessage(error instanceof Error ? error.message : 'Could not clear the session.')
    }
  }

  function startTrace() {
    setMessage('')
    setTableCleared(true)
    setRoadmapExecution(null)
    knownIds.current = new Set(executions.map((execution) => execution.traceId))
  }

  async function attach(investigationId: string) {
    if (!current) return
    setMessage('')
    try {
      await api.attach(investigationId, current.traceId)
      setMessage('Attached to the investigation.')
      onAttached()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not attach.')
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 inline-flex items-center gap-2 text-sm font-semibold">
          <span className={`size-2 ${receiving && connected ? 'bg-signal motion-safe:animate-pulse' : 'bg-quiet'}`} aria-hidden="true" />
          <span className={receiving && connected ? '' : 'text-quiet'}>{receiving ? (connected ? 'Receiving' : 'Connecting') : 'Stopped'}</span>
        </p>
        <nav className="switch" aria-label="Detail">
          <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>Execution</TabButton>
          <TabButton active={tab === 'technical'} onClick={() => setTab('technical')}>Technical</TabButton>
        </nav>
      </div>
      {executions.length > 0 ? (
        <label className="mb-4 block text-sm">
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>Execution</span>
            <span className="text-quiet">Total: <span className="font-mono">{executions.length}</span></span>
          </span>
          <span className="relative mt-1 flex items-stretch gap-2" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="block min-w-0 flex-1 truncate border border-rule bg-field px-3 py-2 text-left"
              aria-haspopup="listbox"
              aria-expanded={listOpen}
              onClick={() => setListOpen((open) => !open)}
            >
              {tableCleared ? 'Choose an execution' : current ? executionLabel(current) : 'Choose an execution'}
            </button>
            {listOpen ? (
              <ul className="absolute left-0 top-full z-20 mt-1 max-h-72 w-full max-w-full overflow-auto border border-rule bg-tape shadow-panel" role="listbox">
                {executions.map((execution) => (
                  <li key={execution.traceId}>
                    <button
                      type="button"
                      className={`block w-full truncate px-3 py-2 text-left hover:bg-signal/25 ${!tableCleared && execution.traceId === current?.traceId ? 'bg-signal/20 font-semibold' : ''}`}
                      role="option"
                      aria-selected={!tableCleared && execution.traceId === current?.traceId}
                      onClick={() => {
                        setSelected(execution.traceId)
                        setTableCleared(false)
                        setListOpen(false)
                      }}
                    >
                      {executionLabel(execution)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="shrink-0 border border-ink px-3 py-1"
              aria-pressed={receiving}
              onClick={() => setReceiving((open) => !open)}
            >
              {receiving ? 'Stop Receiving' : 'Start Receiving'}
            </button>
            <button
              type="button"
              className="shrink-0 border border-ink px-3 py-1 disabled:border-rule disabled:text-quiet"
              disabled={!current}
              aria-haspopup="dialog"
              onClick={() => {
                if (!current) return
                setListOpen(false)
                setRoadmapExecution(structuredClone(current))
              }}
            >
              Show Roadmap
            </button>
            <button type="button" className="shrink-0 border border-ink px-3 py-1" onClick={() => clearSession()}>
              Clear session
            </button>
            <button type="button" className="shrink-0 border border-ink px-3 py-1" onClick={startTrace}>
              New trace
            </button>
          </span>
        </label>
      ) : null}
      {current ? <ExecutionView key={current.traceId} execution={current} tab={tab} /> : executions.length > 0 ? <p className="m-0 max-w-[42ch] border border-dashed border-rule bg-field px-4 py-6 text-lg leading-snug">The table is clear. Choose an execution to show it again.</p> : <p className="m-0 max-w-[38ch] border border-dashed border-rule bg-field px-4 py-6 text-lg leading-snug">Nothing has happened in this session yet. Use the application, and the execution will print here.</p>}
      {current && investigations.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {investigations.map((investigation) => (
            <button key={investigation.id} type="button" className="border border-ink px-3 py-1" onClick={() => attach(investigation.id)}>
              Attach to {investigation.name}
            </button>
          ))}
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {roadmapExecution ? <RoadmapDialog execution={roadmapExecution} onClose={() => setRoadmapExecution(null)} /> : null}
    </section>
  )
}

const columns = 'grid-cols-[2.5rem_5.5rem_5.5rem_6.5rem_1fr]'

export function ExecutionView({ execution, tab }: { execution: Execution; tab: Tab }) {
  const title = executionLabel(execution)
  const failed = execution.status === 'failed'
  const [time, setTime] = useState('')
  const [layer, setLayer] = useState('')
  const [detail, setDetail] = useState('')
  const [showInfrastructure, setShowInfrastructure] = useState(false)
  const filtering = time !== '' || layer !== '' || detail !== ''
  const steps = execution.steps.filter((step) => matches(step, time, layer, detail, tab === 'execution'))
  const core = steps.filter((step) => !isInfrastructure(step))
  const infrastructure = steps.filter((step) => isInfrastructure(step))
  const timed = tab === 'execution' ? (showInfrastructure ? [...infrastructure, ...core] : core) : []
  const maxDuration = timed.reduce((max, step) => Math.max(max, step.durationMs ?? 0), 0)
  const longest = longestStep(timed)

  return (
    <article>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-2xl font-bold leading-tight">{title}</h1>
        <p className={`m-0 font-mono text-sm ${failed ? 'text-fail' : 'text-ok'}`}>
          {labelStatus(execution.status)}
          {execution.durationMs != null ? `  ${formatMs(execution.durationMs)}` : ''}
        </p>
      </div>
      {execution.error?.message ? <p className="mt-3 text-fail">{execution.error.operation ? `${execution.error.operation}: ` : ''}{execution.error.message}</p> : null}
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          className="border border-ink px-3 py-1 text-sm disabled:border-rule disabled:text-quiet"
          disabled={infrastructure.length === 0}
          aria-expanded={showInfrastructure}
          onClick={() => setShowInfrastructure((open) => !open)}
        >
          {showInfrastructure ? 'Hide' : 'Show'} infrastructure · {infrastructure.length}
        </button>
        <button
          type="button"
          className="border border-ink px-3 py-1 text-sm disabled:border-rule disabled:text-quiet"
          disabled={!filtering}
          onClick={() => {
            setTime('')
            setLayer('')
            setDetail('')
          }}
        >
          Clear filter
        </button>
      </div>
      <div className={`mt-2 grid ${columns} gap-3`}>
        <span className="px-2 py-1 text-sm text-quiet">#</span>
        <FilterInput label="Time" value={time} onChange={setTime} />
        <span className="px-2 py-1 text-right text-sm text-quiet">Duration</span>
        <FilterInput label="Layer" value={layer} onChange={setLayer} />
        <FilterInput label="Detail" value={detail} onChange={setDetail} />
      </div>
      {showInfrastructure && tab === 'execution' ? <StepList steps={infrastructure} start={1} detailed quiet bars maxDuration={maxDuration} longestId={longest} /> : null}
      {showInfrastructure && tab === 'technical' ? <Technical execution={execution} steps={infrastructure} hideTrace /> : null}
      {execution.steps.length === 0 ? <p className="mt-6 text-quiet">Waiting for the rest of this execution.</p> : null}
      {execution.steps.length > 0 && steps.length === 0 ? <p className="mt-6 text-quiet">No steps match this filter.</p> : null}
      {tab === 'execution' ? <StepList steps={core} start={showInfrastructure ? infrastructure.length + 1 : 1} detailed bars maxDuration={maxDuration} longestId={longest} /> : null}
      {tab === 'technical' ? <Technical execution={execution} steps={core} /> : null}
    </article>
  )
}

function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      aria-label={`Filter ${label}`}
      placeholder={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full border border-rule bg-field px-2 py-1 text-sm"
    />
  )
}

function matches(step: Step, time: string, layer: string, detail: string, detailed: boolean): boolean {
  const clock = formatClock(step.startedAt)
  const layerText = layerLabel(step.layer)
  const detailText = [
    step.name,
    step.durationMs != null ? formatMs(step.durationMs) : '',
    step.sqlText ?? '',
    detailed ? step.source?.file : '',
    detailed ? step.source?.function : '',
    detailed && step.source?.line ? String(step.source.line) : '',
    step.spanId,
  ].join(' ')
  return includes(clock, time) && includes(layerText, layer) && includes(detailText, detail)
}

function includes(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || value.toLowerCase().includes(needle)
}

function longestStep(steps: Step[]): string | undefined {
  let best: Step | undefined
  for (const step of steps) {
    if ((step.durationMs ?? -1) > (best?.durationMs ?? -1)) best = step
  }
  return (best?.durationMs ?? 0) > 0 ? best?.spanId : undefined
}

const durationTrack = {
  backgroundColor: 'var(--color-housing)',
  backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--color-ink) 16%, transparent) 1px, transparent 1px)',
  backgroundSize: '25% 100%',
} as const

function durationShare(duration: number | null | undefined, max: number): number {
  if (max <= 0 || duration == null || duration <= 0) return 0
  return Math.min(100, Math.max(0.8, (duration / max) * 100))
}

function StepList({ steps, start, detailed, quiet = false, bars = false, maxDuration = 0, longestId }: { steps: Step[]; start: number; detailed: boolean; quiet?: boolean; bars?: boolean; maxDuration?: number; longestId?: string }) {
  const [sql, setSql] = useState<string | null>(null)
  const [truncated, setTruncated] = useState<Record<string, boolean>>({})
  if (steps.length === 0) return null
  return (
    <>
      <ol className="mt-2 list-none p-0">
        {steps.map((step, index) => {
          const curl = toCurl(step, steps)
          return (
            <li key={step.spanId} className={`grid ${columns} gap-3 border-t border-rule px-1 py-2.5 text-sm ${quiet ? 'text-quiet' : 'hover:bg-signal/10'}`}>
              <span className="font-mono text-quiet">{start + index}</span>
              <time className="font-mono text-quiet">{formatClock(step.startedAt)}</time>
              <span className="text-right font-mono text-quiet">{step.durationMs != null ? formatMs(step.durationMs) : ''}</span>
              <span><LayerLabel layer={step.layer} /></span>
              <span className="flex min-w-0 items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    {bars && step.spanId === longestId ? <span className="shrink-0 bg-signal px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-on-signal">Longest</span> : null}
                    {bars && step.status === 'failed' ? <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-fail">Failed</span> : null}
                    <span className="min-w-0 flex-1 truncate">{step.sqlText ? sqlTableTitle(step.sqlText) : step.name}</span>
                  </span>
                  {bars ? (
                    <div className="relative mt-2 h-2.5" style={durationTrack} title={`${step.name} · ${step.durationMs != null ? formatMs(step.durationMs) : 'Running'}`}>
                      <span
                        className={`absolute inset-y-0 left-0 ${step.status === 'failed' ? 'bg-fail' : 'bg-signal'}`}
                        style={{ width: `${durationShare(step.durationMs, maxDuration)}%` }}
                      />
                    </div>
                  ) : null}
                  {step.sqlText ? (
                    <SqlPreview
                      text={step.sqlText}
                      onTruncated={(value) => {
                        setTruncated((current) => current[step.spanId] === value ? current : { ...current, [step.spanId]: value })
                      }}
                    />
                  ) : null}
                  {detailed && (step.source?.file || step.source?.function) ? (
                    <span className="mt-1 block break-all font-mono text-quiet">
                      {step.source?.file}
                      {step.source?.function ? `  ${step.source.function}` : ''}
                      {step.source?.line ? `:${step.source.line}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="flex w-16 shrink-0 flex-col gap-1">
                  {curl ? <CopyButton text={curl} label="cURL" /> : null}
                  {step.sqlText ? (
                    <SqlCopyMenu sql={step.sqlText} />
                  ) : (
                    <CopyButton text={detailText(step, detailed)} />
                  )}
                  {step.sqlText && truncated[step.spanId] ? (
                    <button type="button" className="w-full border border-ink px-2 py-0.5 text-xs text-ink" onClick={() => setSql(step.sqlText ?? null)}>
                      View
                    </button>
                  ) : null}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      {sql ? <SqlDialog text={sql} onClose={() => setSql(null)} /> : null}
    </>
  )
}

function detailText(step: Step, detailed: boolean): string {
  const source = detailed && (step.source?.file || step.source?.function)
    ? `${step.source?.file ?? ''}${step.source?.function ? `  ${step.source.function}` : ''}${step.source?.line ? `:${step.source.line}` : ''}`
    : ''
  return [step.name, source].filter(Boolean).join('\n')
}

const maxPreviewLines = 15

function SqlPreview({ text, onTruncated }: { text: string; onTruncated: (truncated: boolean) => void }) {
  const node = useRef<HTMLSpanElement>(null)
  const report = useRef(onTruncated)
  report.current = onTruncated
  const [preview, setPreview] = useState(() => clipPreview(text))

  useLayoutEffect(() => {
    const element = node.current
    if (!element) return
    const lineHeight = lineHeightOf(element)
    const maxHeight = lineHeight * maxPreviewLines
    element.textContent = text
    if (element.scrollHeight <= maxHeight + 1) {
      setPreview(text)
      report.current(false)
      return
    }

    const fitted = fitPreview(element, text, maxHeight)
    setPreview(`${fitted}...`)
    report.current(true)
  }, [text])

  return <span ref={node} className="mt-1 block whitespace-pre-wrap break-words font-mono text-quiet">{preview}</span>
}

function clipPreview(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length <= maxPreviewLines) return text
  return `${lines.slice(0, maxPreviewLines).join('\n')}...`
}

function fitPreview(element: HTMLElement, text: string, maxHeight: number): string {
  let low = 0
  let high = text.length
  let best = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    element.textContent = `${text.slice(0, mid).trimEnd()}...`
    if (element.scrollHeight <= maxHeight + 1) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return text.slice(0, best).trimEnd()
}

function lineHeightOf(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const parsed = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const fontSize = Number.parseFloat(style.fontSize)
  return (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 14) * 1.25
}

function SqlCopyMenu({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setOpen(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <span ref={root} className="relative block">
      <button type="button" className="w-full border border-ink px-2 py-0.5 text-xs text-ink" onClick={() => setOpen((value) => !value)}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      {open ? (
        <span className="absolute right-0 z-10 mt-1 flex w-48 flex-col border border-rule bg-tape text-xs shadow-panel">
          <button type="button" className="px-2 py-1.5 text-left hover:bg-signal/25" onClick={() => copy(copyAsIs(sql))}>Copy as is</button>
          <button type="button" className="border-t border-rule px-2 py-1.5 text-left hover:bg-signal/25" onClick={() => copy(copyInvolvedTables(sql))}>Copy involved tables</button>
          <button type="button" className="border-t border-rule px-2 py-1.5 text-left hover:bg-signal/25" onClick={() => copy(copyForAi(sql))}>Copy for AI explanation</button>
        </span>
      ) : null}
    </span>
  )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="w-full border border-ink px-2 py-0.5 text-xs text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

function SqlDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
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
    }
  }, [text])

  return (
    <dialog
      ref={dialog}
      className="panel m-auto max-h-[80vh] w-[min(72rem,calc(100%-2rem))] p-5 text-ink shadow-none"
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="m-0 font-bold">SQL</p>
        <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="m-0 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words border border-rule bg-field p-3 font-mono text-sm">{text}</pre>
    </dialog>
  )
}

function LayerLabel({ layer }: { layer: string }) {
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
  return <span className={`inline-block px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ${tone}`}>{layerLabel(layer)}</span>
}

function Technical({ execution, steps, hideTrace = false }: { execution: Execution; steps: Step[]; hideTrace?: boolean }) {
  return (
    <dl className="mt-2 font-mono text-sm">
      {hideTrace ? null : (
        <div className="border-t border-rule py-2">
          <dt className="font-sans text-quiet">Trace</dt>
          <dd className="m-0 break-all">{execution.traceId}</dd>
        </div>
      )}
      {steps.map((step) => (
        <div key={step.spanId} className="border-t border-rule py-2">
          <dt className="font-sans text-quiet"><LayerLabel layer={step.layer} /> span</dt>
          <dd className="m-0 break-all">{step.spanId}</dd>
        </div>
      ))}
    </dl>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
      {children}
    </button>
  )
}
