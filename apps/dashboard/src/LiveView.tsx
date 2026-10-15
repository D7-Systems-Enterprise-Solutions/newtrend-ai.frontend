import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Execution, type Investigation, type Step } from './api'
import { loadBurstItems } from './burstLimit'
import { executionLabel, formatClock, formatMs, httpPath, httpQueryLines, isInfrastructure, labelStatus, layerLabel, sqlTableTitle, toCurl } from './format'
import { parameterPieces } from './parameters'
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
  const [roadmapExecution, setRoadmapExecution] = useState<Execution | null>(null)
  const [receiving, setReceiving] = useState(true)
  const [message, setMessage] = useState('')
  const knownIds = useRef<Set<string>>(new Set())
  const epoch = useRef(0)
  const ignoreThroughEpoch = useRef<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    api.setBurstLimit(loadBurstItems()).catch(() => {})
  }, [])

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
        const arrived = next.filter((execution) => !knownIds.current.has(execution.traceId))
        const newest = arrived[0]
        setExecutions(next)
        if (newest) {
          selectedRef.current = newest.traceId
          setSelected(newest.traceId)
          setTableCleared(false)
        }
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
          <span className={`size-2 ${receiving && connected ? 'bg-ok motion-safe:animate-pulse' : 'bg-quiet'}`} aria-hidden="true" />
          <span className={receiving && connected ? 'text-ok' : 'text-quiet'}>{receiving ? (connected ? 'Receiving' : 'Connecting') : 'Stopped'}</span>
        </p>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border border-ink px-3 py-1"
            aria-pressed={receiving}
            onClick={() => setReceiving((open) => !open)}
          >
            {receiving ? 'Stop Receiving' : 'Start Receiving'}
          </button>
          <button type="button" className="border border-ink px-3 py-1" onClick={() => clearSession()}>
            Clear session
          </button>
          <button type="button" className="border border-ink px-3 py-1" onClick={startTrace}>
            New trace
          </button>
        </span>
      </div>
      {executions.length > 0 ? (
        <div className="mb-4 text-sm">
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>Execution</span>
            <span className="text-quiet">Total: <span className="font-mono">{executions.length}</span></span>
          </span>
          <span className="mt-1 flex items-center gap-4">
            <span className="relative min-w-0 flex-1">
              <select
                aria-label="Execution"
                className="w-full appearance-none border border-rule bg-field py-2 pl-3 pr-10 text-xl font-semibold"
                value={tableCleared ? '' : current?.traceId ?? ''}
                onChange={(event) => {
                  const traceId = event.target.value
                  if (!traceId) return
                  setSelected(traceId)
                  setTableCleared(false)
                }}
              >
                {tableCleared ? <option value="">Choose an execution</option> : null}
                {executions.map((execution) => (
                  <option key={execution.traceId} value={execution.traceId}>{executionLabel(execution)}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </span>
            {current ? (
              <p className={`m-0 shrink-0 font-mono text-sm ${current.status === 'failed' ? 'text-fail' : 'text-ok'}`}>
                {labelStatus(current.status)}
                {current.durationMs != null ? `  ${formatMs(current.durationMs)}` : ''}
              </p>
            ) : null}
          </span>
        </div>
      ) : null}
      {current && investigations.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {investigations.map((investigation) => (
            <button key={investigation.id} type="button" className="border border-ink px-3 py-1" onClick={() => attach(investigation.id)}>
              Attach to {investigation.name}
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <ExecutionView
          key={current.traceId}
          execution={current}
          tab={tab}
          showHeading={false}
          leading={(
            <nav className="switch" aria-label="Detail">
              <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>Execution</TabButton>
              <TabButton active={tab === 'technical'} onClick={() => setTab('technical')}>Technical</TabButton>
            </nav>
          )}
          besideInfrastructure={(
            <button
              type="button"
              className="border border-ink px-3 py-1 text-sm"
              aria-haspopup="dialog"
              onClick={() => setRoadmapExecution(structuredClone(current))}
            >
              Show Timeline
            </button>
          )}
        />
      ) : executions.length > 0 ? <p className="m-0 max-w-[42ch] border border-dashed border-rule bg-field px-4 py-6 text-lg leading-snug">The table is clear. Choose an execution to show it again.</p> : <p className="m-0 max-w-[38ch] border border-dashed border-rule bg-field px-4 py-6 text-lg leading-snug">Nothing has happened in this session yet. Use the application, and the execution will print here.</p>}
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {roadmapExecution ? <RoadmapDialog execution={roadmapExecution} onClose={() => setRoadmapExecution(null)} /> : null}
    </section>
  )
}

const columns = 'grid-cols-[2.5rem_5.5rem_5.5rem_6.5rem_1fr]'

export function ExecutionView({ execution, tab, showHeading = true, leading, besideInfrastructure }: { execution: Execution; tab: Tab; showHeading?: boolean; leading?: ReactNode; besideInfrastructure?: ReactNode }) {
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
      {showHeading ? (
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="m-0 text-2xl font-bold leading-tight">{title}</h1>
          <p className={`m-0 font-mono text-sm ${failed ? 'text-fail' : 'text-ok'}`}>
            {labelStatus(execution.status)}
            {execution.durationMs != null ? `  ${formatMs(execution.durationMs)}` : ''}
          </p>
        </div>
      ) : null}
      {execution.error?.message ? <p className="mt-3 text-fail">{execution.error.operation ? `${execution.error.operation}: ` : ''}{execution.error.message}</p> : null}
      <div className={`flex flex-wrap items-center gap-2 ${showHeading ? 'mt-6' : ''}`}>
        {leading}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {besideInfrastructure}
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
        </span>
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
    httpQueryLines(step.httpUrl) ?? '',
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
  const [http, setHttp] = useState<{ step: Step; curl: string } | null>(null)
  const [truncated, setTruncated] = useState<Record<string, boolean>>({})
  if (steps.length === 0) return null
  return (
    <>
      <ol className="mt-2 list-none p-0">
        {steps.map((step, index) => {
          const curl = toCurl(step, steps)
          const query = httpQueryLines(step.httpUrl)
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
                  {query ? (
                    <span className="mt-1 block whitespace-pre-wrap break-all font-mono">
                      <ParameterText text={query} kind="query" />
                    </span>
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
                  {curl ? (
                    <button type="button" className="w-full border border-ink px-2 py-0.5 text-xs text-ink" onClick={() => setHttp({ step, curl })}>
                      View
                    </button>
                  ) : null}
                  {step.sqlText ? (
                    <SqlCopyMenu sql={step.sqlText} />
                  ) : curl ? null : (
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
      {http ? <HttpDialog step={http.step} curl={http.curl} onClose={() => setHttp(null)} /> : null}
    </>
  )
}

function detailText(step: Step, detailed: boolean): string {
  const source = detailed && (step.source?.file || step.source?.function)
    ? `${step.source?.file ?? ''}${step.source?.function ? `  ${step.source.function}` : ''}${step.source?.line ? `:${step.source.line}` : ''}`
    : ''
  return [step.name, httpQueryLines(step.httpUrl), source].filter(Boolean).join('\n')
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
    const probe = element.cloneNode(false) as HTMLElement
    probe.style.position = 'fixed'
    probe.style.left = '-10000px'
    probe.style.visibility = 'hidden'
    probe.style.height = 'auto'
    probe.style.maxHeight = 'none'
    probe.style.width = `${element.clientWidth}px`
    element.parentElement?.appendChild(probe)
    const lineHeight = lineHeightOf(probe)
    const maxHeight = lineHeight * maxPreviewLines
    probe.textContent = text
    const fits = probe.scrollHeight <= maxHeight + 1
    const fitted = fits ? text : fitPreview(probe, text, maxHeight)
    probe.remove()
    setPreview(fits ? text : `${fitted}...`)
    report.current(!fits)
  }, [text])

  return (
    <span ref={node} className="mt-1 block whitespace-pre-wrap break-words font-mono text-quiet">
      <ParameterText text={preview} kind="sql" />
    </span>
  )
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

function CopyButton({ text, label = 'Copy', className = 'w-full border border-ink px-2 py-0.5 text-xs text-ink' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
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

function HttpDialog({ step, curl, onClose }: { step: Step; curl: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  const [tab, setTab] = useState<'span' | 'curl'>('span')
  useEffect(() => {
    close.current = onClose
  })
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
  }, [step.spanId])

  function requestClose() {
    dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      className="panel m-auto max-h-[80vh] w-[min(72rem,calc(100%-2rem))] overflow-auto p-5 text-ink shadow-none"
      onClick={(event) => {
        if (event.target === dialog.current) requestClose()
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 inline-block bg-signal px-2 py-0.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-on-signal">HTTP</p>
          <h2 className="m-0 mt-3 break-words text-2xl font-bold leading-tight">{step.name}</h2>
        </div>
        <button type="button" className="shrink-0 border border-ink px-3 py-1 text-sm" onClick={requestClose}>
          Close
        </button>
      </div>
      <nav className="switch" aria-label="HTTP detail">
        <TabButton active={tab === 'span'} onClick={() => setTab('span')}>Span</TabButton>
        <TabButton active={tab === 'curl'} onClick={() => setTab('curl')}>cURL</TabButton>
      </nav>
      {tab === 'span' ? (
        <div className="mt-4">
          <LabeledText label="Request" text={httpSpanDetail(step)} parameters="query" boxClassName="max-h-[65vh]" />
        </div>
      ) : (
        <div className="mt-4">
          <LabeledText label="cURL" text={curl} parameters="query" />
        </div>
      )}
    </dialog>
  )
}

function httpSpanDetail(step: Step): string {
  const body = step.httpBody?.trim() ? step.httpBody : '—'
  const path = httpPath(step.httpUrl) || '—'
  return `Title\n${step.name}\n\nBody\n${body}\n\nPath\n${path}`
}

function LabeledText({ label, text, parameters, boxClassName = 'max-h-48' }: { label: string; text: string; parameters?: 'sql' | 'query'; boxClassName?: string }) {
  const shown = text || '—'
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="m-0 text-xs font-bold uppercase tracking-wider">{label}</p>
        <CopyButton text={text} className="shrink-0 border border-ink px-2 py-0.5 text-xs text-ink" />
      </div>
      <pre className={`m-0 overflow-auto whitespace-pre-wrap break-words border border-rule bg-field p-3 font-mono text-sm ${boxClassName}`}>
        {parameters && text ? <ParameterText text={shown} kind={parameters} /> : shown}
      </pre>
    </section>
  )
}

function ParameterText({ text, kind }: { text: string; kind: 'sql' | 'query' }) {
  return parameterPieces(text, kind).map((piece, index) =>
    piece.parameter
      ? <span key={index} className="text-parameter">{piece.text}</span>
      : <span key={index}>{piece.text}</span>,
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
      <pre className="m-0 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words border border-rule bg-field p-3 font-mono text-sm">
        <ParameterText text={text} kind="sql" />
      </pre>
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
    <div className="mt-4">
      {hideTrace ? null : (
        <div className="px-2 py-2">
          <p className="m-0 text-xs font-bold uppercase tracking-wider">Trace</p>
          <p className="m-0 mt-1 text-base font-bold">{executionLabel(execution)}</p>
          <p className="m-0 break-all font-mono text-sm font-bold">{execution.traceId}</p>
        </div>
      )}
      {steps.length === 0 ? null : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-quiet">
              <th className="w-[42%] px-2 py-1 font-normal">Id</th>
              <th className="px-2 py-1 font-normal">Name</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.spanId} className="border-t border-rule">
                <td className="break-all px-2 py-2 align-top font-mono">{step.spanId}</td>
                <td className="break-words px-2 py-2 align-top">{step.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
      {children}
    </button>
  )
}
