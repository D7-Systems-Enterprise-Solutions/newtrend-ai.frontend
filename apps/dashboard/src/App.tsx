import { useEffect, useState } from 'react'

type SourceLocation = {
  file?: string | null
  function?: string | null
  line?: number | null
}

type Step = {
  spanId: string
  parentSpanId?: string | null
  layer: string
  name: string
  durationMs?: number | null
  status: string
  startedAt: string
  source?: SourceLocation | null
  httpStatus?: number | null
}

type Execution = {
  traceId: string
  userAction?: string | null
  status: string
  durationMs?: number | null
  startedAt: string
  serviceName?: string | null
  steps: Step[]
  error?: { message?: string | null; layer?: string | null } | null
}

type Snapshot = {
  type: string
  executions: Execution[]
}

type Tab = 'simple' | 'execution' | 'technical'

const socketUrl = 'ws://127.0.0.1:4319/live'

export default function App() {
  const [executions, setExecutions] = useState<Execution[]>([])
  const [connected, setConnected] = useState(false)
  const [tab, setTab] = useState<Tab>('simple')
  const current = executions[0]

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

  return (
    <main className="min-h-svh bg-housing text-ink">
      <div className="mx-auto flex min-h-svh max-w-xl flex-col px-5 py-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`live-lamp size-3 rounded-full ${connected ? 'bg-signal motion-safe:animate-pulse' : 'bg-quiet'}`}
              aria-hidden="true"
            />
            <div>
              <p className="m-0 text-lg font-bold leading-none">AI-Newtrend</p>
              <p className="m-0 mt-1 text-sm text-quiet">{connected ? 'Live' : 'Connecting'}</p>
            </div>
          </div>
          <nav className="flex gap-1 text-sm" aria-label="Detail">
            <TabButton active={tab === 'simple'} onClick={() => setTab('simple')}>Simple</TabButton>
            <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>Execution</TabButton>
            <TabButton active={tab === 'technical'} onClick={() => setTab('technical')}>Technical</TabButton>
          </nav>
        </header>

        <section className="mt-8 flex-1 bg-tape px-5 py-6 shadow-[0_1px_0_rgba(36,28,20,0.08)]">
          {current ? (
            <ExecutionView execution={current} tab={tab} />
          ) : (
            <p className="m-0 max-w-[38ch] text-lg leading-snug">
              Nothing has happened in this session yet. Use the application, and the execution will print here.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

function ExecutionView({ execution, tab }: { execution: Execution; tab: Tab }) {
  const title = execution.userAction ?? execution.steps[0]?.name ?? 'Execution'
  const failed = execution.status === 'failed'

  return (
    <article>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-2xl font-bold leading-tight">{title}</h1>
        <p className={`m-0 font-mono text-sm ${failed ? 'text-fail' : 'text-ok'}`}>
          {labelStatus(execution.status)}
          {execution.durationMs != null ? `  ${formatMs(execution.durationMs)}` : ''}
        </p>
      </div>

      {execution.error?.message ? (
        <p className="mt-3 text-fail">{execution.error.message}</p>
      ) : null}

      {tab === 'simple' ? <StepList steps={execution.steps} detailed={false} /> : null}
      {tab === 'execution' ? <StepList steps={execution.steps} detailed /> : null}
      {tab === 'technical' ? <Technical execution={execution} /> : null}
    </article>
  )
}

function StepList({ steps, detailed }: { steps: Step[]; detailed: boolean }) {
  if (steps.length === 0) {
    return <p className="mt-6 text-quiet">Waiting for the rest of this execution.</p>
  }

  return (
    <ol className="mt-6 list-none p-0">
      {steps.map((step) => (
        <li key={step.spanId} className="grid grid-cols-[7.5rem_5.5rem_1fr] gap-3 border-t border-rule py-2 font-mono text-sm">
          <time className="text-quiet">{formatClock(step.startedAt)}</time>
          <span>{layerLabel(step.layer)}</span>
          <span>
            <span className="font-sans text-base">{step.name}</span>
            {step.durationMs != null ? <span className="ml-2 text-quiet">{formatMs(step.durationMs)}</span> : null}
            {detailed && step.source?.file ? (
              <span className="mt-1 block text-quiet">
                {step.source.file}
                {step.source.function ? `  ${step.source.function}` : ''}
                {step.source.line ? `:${step.source.line}` : ''}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Technical({ execution }: { execution: Execution }) {
  return (
    <dl className="mt-6 font-mono text-sm">
      <div className="border-t border-rule py-2">
        <dt className="text-quiet">Trace</dt>
        <dd className="m-0 break-all">{execution.traceId}</dd>
      </div>
      {execution.steps.map((step) => (
        <div key={step.spanId} className="border-t border-rule py-2">
          <dt className="text-quiet">{layerLabel(step.layer)} span</dt>
          <dd className="m-0 break-all">{step.spanId}</dd>
        </div>
      ))}
    </dl>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-2 py-1 ${active ? 'border-ink font-bold' : 'border-transparent text-quiet'}`}
    >
      {children}
    </button>
  )
}

function layerLabel(layer: string): string {
  if (layer === 'Backend') return '.NET'
  if (layer === 'Http') return 'HTTP'
  return layer
}

function labelStatus(status: string): string {
  if (status === 'failed') return 'Failed'
  if (status === 'completed') return 'Completed'
  return 'Running'
}

function formatMs(value: number): string {
  if (value < 1) return '<1 ms'
  return `${Math.round(value)} ms`
}

function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}
