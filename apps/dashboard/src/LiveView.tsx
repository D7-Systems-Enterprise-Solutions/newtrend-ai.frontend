import { useEffect, useState } from 'react'
import { api, type Execution, type Investigation, type Step } from './api'
import { formatClock, formatMs, labelStatus, layerLabel } from './format'

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
      {executions.length > 1 ? (
        <label className="mb-4 block text-sm">
          Execution
          <select className="mt-1 block w-full border border-rule bg-tape px-2 py-1" value={current?.traceId ?? ''} onChange={(event) => setSelected(event.target.value)}>
            {executions.map((execution) => (
              <option key={execution.traceId} value={execution.traceId}>
                {execution.userAction ?? execution.traceId}
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

export function ExecutionView({ execution, tab }: { execution: Execution; tab: Tab }) {
  const title = execution.userAction ?? execution.steps[0]?.name ?? 'Execution'
  const failed = execution.status === 'failed'
  const [time, setTime] = useState('')
  const [layer, setLayer] = useState('')
  const [detail, setDetail] = useState('')
  const filtering = time !== '' || layer !== '' || detail !== ''
  const steps = execution.steps.filter((step) => matches(step, time, layer, detail, tab === 'execution'))

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
      <div className="mt-6 flex items-center justify-end">
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
      <div className="mt-2 grid grid-cols-[5.5rem_5.5rem_1fr] gap-3">
        <FilterInput label="Time" value={time} onChange={setTime} />
        <FilterInput label="Layer" value={layer} onChange={setLayer} />
        <FilterInput label="Detail" value={detail} onChange={setDetail} />
      </div>
      {execution.steps.length === 0 ? <p className="mt-6 text-quiet">Waiting for the rest of this execution.</p> : null}
      {execution.steps.length > 0 && steps.length === 0 ? <p className="mt-6 text-quiet">No steps match this filter.</p> : null}
      {tab === 'simple' ? <StepList steps={steps} detailed={false} /> : null}
      {tab === 'execution' ? <StepList steps={steps} detailed /> : null}
      {tab === 'technical' ? <Technical execution={execution} steps={steps} /> : null}
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

function includes(value: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || value.toLowerCase().includes(needle)
}

function StepList({ steps, detailed }: { steps: Step[]; detailed: boolean }) {
  if (steps.length === 0) return null
  return (
    <ol className="mt-2 list-none p-0">
      {steps.map((step) => (
        <li key={step.spanId} className="grid grid-cols-[5.5rem_5.5rem_1fr] gap-3 border-t border-rule py-2 text-sm">
          <time className="font-mono text-quiet">{formatClock(step.startedAt)}</time>
          <span>{layerLabel(step.layer)}</span>
          <span>
            <span>{step.name}</span>
            {step.durationMs != null ? <span className="ml-2 font-mono text-quiet">{formatMs(step.durationMs)}</span> : null}
            {step.sqlText ? <span className="mt-1 block font-mono text-quiet">{step.sqlText}</span> : null}
            {detailed && (step.source?.file || step.source?.function) ? (
              <span className="mt-1 block break-all font-mono text-quiet">
                {step.source?.file}
                {step.source?.function ? `  ${step.source.function}` : ''}
                {step.source?.line ? `:${step.source.line}` : ''}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Technical({ execution, steps }: { execution: Execution; steps: Step[] }) {
  return (
    <dl className="mt-2 font-mono text-sm">
      <div className="border-t border-rule py-2">
        <dt className="font-sans text-quiet">Trace</dt>
        <dd className="m-0 break-all">{execution.traceId}</dd>
      </div>
      {steps.map((step) => (
        <div key={step.spanId} className="border-t border-rule py-2">
          <dt className="font-sans text-quiet">{layerLabel(step.layer)} span</dt>
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
