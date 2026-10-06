import { useEffect, useRef, useState } from 'react'
import { api, type Execution, type Investigation, type Step } from './api'
import { executionLabel, formatClock, formatMs, isInfrastructure, labelStatus, layerLabel, sqlTableTitle, toCurl } from './format'
import { copyAsIs, copyForAi, copyInvolvedTables } from './sqlCopy'

type Snapshot = { type: string; executions: Execution[] }
type Tab = 'simple' | 'execution' | 'technical'

const socketUrl = 'ws://127.0.0.1:4319/live'

export function LiveView({ investigations, onAttached }: { investigations: Investigation[]; onAttached: () => void }) {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [connected, setConnected] = useState(false)
  const [tab, setTab] = useState<Tab>('simple')
  const [selected, setSelected] = useState<string>('')
  const [message, setMessage] = useState('')
  const current = executions.find((execution) => execution.traceId === selected) ?? executions.find((execution) => execution.userAction) ?? executions[0]
  const sinceFrontend = executionsSinceFrontend(executions)

  useEffect(() => {
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
        setExecutions(snapshot.executions ?? [])
      }
    }
    connect()
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      socket?.close()
    }
  }, [])

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
        <p className="m-0 text-sm text-quiet">{connected ? 'Receiving' : 'Connecting'}</p>
        <nav className="flex gap-1 text-sm" aria-label="Detail">
          <TabButton active={tab === 'simple'} onClick={() => setTab('simple')}>Simple</TabButton>
          <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>Execution</TabButton>
          <TabButton active={tab === 'technical'} onClick={() => setTab('technical')}>Technical</TabButton>
        </nav>
      </div>
      {executions.length > 0 ? (
        <label className="mb-4 block text-sm">
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>Execution</span>
            <span className="text-quiet">Total: <span className="font-mono">{executions.length}</span></span>
            <span className="text-fail">New from last event: <span className="font-mono">{sinceFrontend}</span></span>
          </span>
          <select className="mt-1 block w-full border border-rule bg-tape px-2 py-1" value={current?.traceId ?? ''} onChange={(event) => setSelected(event.target.value)} disabled={executions.length < 2}>
            {executions.map((execution) => (
              <option key={execution.traceId} value={execution.traceId}>
                {executionLabel(execution)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {current ? <ExecutionView key={current.traceId} execution={current} tab={tab} /> : <p className="m-0 max-w-[38ch] text-lg leading-snug">Nothing has happened in this session yet. Use the application, and the execution will print here.</p>}
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
    </section>
  )
}

const columns = 'grid-cols-[5.5rem_5.5rem_6.5rem_1fr]'

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
        <FilterInput label="Time" value={time} onChange={setTime} />
        <span className="px-2 py-1 text-right text-sm text-quiet">Duration</span>
        <FilterInput label="Layer" value={layer} onChange={setLayer} />
        <FilterInput label="Detail" value={detail} onChange={setDetail} />
      </div>
      {showInfrastructure && tab === 'simple' ? <StepList steps={infrastructure} detailed={false} quiet /> : null}
      {showInfrastructure && tab === 'execution' ? <StepList steps={infrastructure} detailed quiet /> : null}
      {showInfrastructure && tab === 'technical' ? <Technical execution={execution} steps={infrastructure} hideTrace /> : null}
      {execution.steps.length === 0 ? <p className="mt-6 text-quiet">Waiting for the rest of this execution.</p> : null}
      {execution.steps.length > 0 && steps.length === 0 ? <p className="mt-6 text-quiet">No steps match this filter.</p> : null}
      {tab === 'simple' ? <StepList steps={core} detailed={false} /> : null}
      {tab === 'execution' ? <StepList steps={core} detailed /> : null}
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
      className="w-full border border-rule bg-tape px-2 py-1 text-sm"
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

function executionsSinceFrontend(executions: Execution[]): number {
  let latest = -1
  for (const execution of executions) {
    if (!isFrontend(execution)) continue
    const started = Date.parse(execution.startedAt)
    if (started > latest) latest = started
  }
  if (latest < 0) return 0
  return executions.filter((execution) => Date.parse(execution.startedAt) > latest).length
}

function isFrontend(execution: Execution): boolean {
  return Boolean(execution.userAction) || execution.steps.some((step) => step.layer === 'Frontend')
}

function includes(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || value.toLowerCase().includes(needle)
}

function StepList({ steps, detailed, quiet = false }: { steps: Step[]; detailed: boolean; quiet?: boolean }) {
  const [sql, setSql] = useState<string | null>(null)
  if (steps.length === 0) return null
  return (
    <>
      <ol className="mt-2 list-none p-0">
        {steps.map((step) => {
          const curl = toCurl(step)
          return (
            <li key={step.spanId} className={`grid ${columns} gap-3 border-t border-rule py-2 text-sm ${quiet ? 'text-quiet' : ''}`}>
              <time className="font-mono text-quiet">{formatClock(step.startedAt)}</time>
              <span className="text-right font-mono text-quiet">{step.durationMs != null ? formatMs(step.durationMs) : ''}</span>
              <span><LayerLabel layer={step.layer} /></span>
              <span className="flex min-w-0 items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span>{step.sqlText ? sqlTableTitle(step.sqlText) : step.name}</span>
                  {step.sqlText ? <SqlPreview text={step.sqlText} /> : null}
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
                  {step.sqlText && sqlNeedsView(step.sqlText) ? (
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

function sqlNeedsView(text: string): boolean {
  return text.length > 160 || text.split(/\r?\n/).length > 4
}

function SqlPreview({ text }: { text: string }) {
  return <span className="mt-1 block whitespace-pre-wrap break-words font-mono text-quiet line-clamp-4">{text}</span>
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
        <span className="absolute right-0 z-10 mt-1 flex w-44 flex-col border border-ink bg-tape text-xs">
          <button type="button" className="px-2 py-1 text-left hover:bg-housing" onClick={() => copy(copyAsIs(sql))}>Copy as is</button>
          <button type="button" className="border-t border-rule px-2 py-1 text-left hover:bg-housing" onClick={() => copy(copyInvolvedTables(sql))}>Copy involved tables</button>
          <button type="button" className="border-t border-rule px-2 py-1 text-left hover:bg-housing" onClick={() => copy(copyForAi(sql))}>Copy for AI explanation</button>
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
      className="m-auto max-h-[80vh] w-[min(72rem,calc(100%-2rem))] border border-rule bg-tape p-5 text-ink"
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
      <pre className="m-0 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words font-mono text-sm">{text}</pre>
    </dialog>
  )
}

function LayerLabel({ layer }: { layer: string }) {
  const tone =
    layer === 'Frontend'
      ? 'bg-layer-frontend/15 text-layer-frontend'
      : layer === 'Http'
        ? 'bg-layer-http/15 text-layer-http'
        : layer === 'Backend'
          ? 'bg-layer-net/15 text-layer-net'
          : layer === 'Sql'
            ? 'bg-layer-sql/15 text-layer-sql'
            : 'bg-rule text-ink'
  return <span className={`inline-block px-1.5 py-0.5 text-xs font-bold tracking-wide ${tone}`}>{layerLabel(layer)}</span>
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
    <button type="button" onClick={onClick} className={`border-b-2 px-2 py-1 ${active ? 'border-ink font-bold' : 'border-transparent text-quiet'}`}>
      {children}
    </button>
  )
}
