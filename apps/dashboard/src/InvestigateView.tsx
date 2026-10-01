import { useEffect, useState } from 'react'
import { api, type Execution, type Investigation, type InvestigationAnswer, type Note, type PatchAction } from './api'
import { formatClock, formatMs, labelStatus } from './format'
import { ExecutionView } from './LiveView'

export function InvestigateView({ refreshKey }: { refreshKey: number }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Investigation[]>([])
  const [selected, setSelected] = useState<string>('')
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [timeline, setTimeline] = useState<Execution[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [note, setNote] = useState('')
  const [openTrace, setOpenTrace] = useState<string>('')
  const [answer, setAnswer] = useState<InvestigationAnswer | null>(null)
  const [cause, setCause] = useState<{ evidence: string[]; hypothesis: string; confidence: string; relatedFiles: string[] } | null>(null)
  const [patch, setPatch] = useState<PatchAction | null>(null)
  const [error, setError] = useState('')

  async function load(q = query) {
    const list = await api.investigations(q)
    setItems(list)
    return list
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message))
  }, [refreshKey])

  async function open(id: string) {
    setSelected(id)
    setAnswer(null)
    setCause(null)
    setPatch(null)
    setOpenTrace('')
    const [events, written] = await Promise.all([api.timeline(id), api.notes(id)])
    setTimeline(events)
    setNotes(written)
  }

  async function create() {
    setError('')
    if (!name.trim()) {
      setError('Name the investigation.')
      return
    }
    const created = await api.createInvestigation(name.trim(), objective.trim())
    setName('')
    setObjective('')
    await load()
    await open(created.id)
  }

  const current = timeline.find((execution) => execution.traceId === openTrace)

  return (
    <section>
      <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); create().catch((reason: Error) => setError(reason.message)) }}>
        <input className="border border-rule bg-tape px-2 py-1" placeholder="Provider Save Failure" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="border border-rule bg-tape px-2 py-1" placeholder="Investigate why Save Provider fails" value={objective} onChange={(event) => setObjective(event.target.value)} />
        <button type="submit" className="w-fit border border-ink px-3 py-1">Create investigation</button>
      </form>
      <form className="mt-4" onSubmit={(event) => { event.preventDefault(); load().catch((reason: Error) => setError(reason.message)) }}>
        <input className="w-full border border-rule bg-tape px-2 py-1" placeholder="Search error, endpoint, action, file, SQL, or trace" value={query} onChange={(event) => setQuery(event.target.value)} />
      </form>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
      <ul className="mt-4 list-none p-0">
        {items.length === 0 ? <li className="text-quiet">Record a failing save, then attach it here.</li> : null}
        {items.map((item) => (
          <li key={item.id} className="border-t border-rule">
            <button type="button" className="w-full py-2 text-left" onClick={() => open(item.id).catch((reason: Error) => setError(reason.message))}>
              <span className="font-bold">{item.name}</span>
              <span className="ml-2 text-quiet">{item.status}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-xl font-bold">Timeline</h2>
            <a className="border border-ink px-3 py-1" href={api.packageUrl(selected)}>Export package</a>
          </div>
          <ol className="mt-3 list-none p-0">
            {timeline.length === 0 ? <li className="text-quiet">Attach an execution from Live.</li> : null}
            {timeline.map((execution) => (
              <li key={execution.traceId} className="border-t border-rule">
                <button type="button" className="grid w-full grid-cols-[5.5rem_1fr_auto] gap-3 py-2 text-left" onClick={() => setOpenTrace(execution.traceId)}>
                  <time className="font-mono text-quiet">{formatClock(execution.startedAt)}</time>
                  <span>{execution.userAction ?? execution.traceId}</span>
                  <span className={execution.status === 'failed' ? 'text-fail' : 'text-ok'}>
                    {execution.durationMs != null ? formatMs(execution.durationMs) : ''} {labelStatus(execution.status)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {current ? <div className="mt-4"><ExecutionView execution={current} tab="execution" /></div> : null}
          <h2 className="mb-0 mt-8 text-xl font-bold">Notes</h2>
          <ul className="mt-3 list-none p-0">
            {notes.map((item) => (
              <li key={item.id} className="border-t border-rule py-2">
                <p className="m-0">{item.text}</p>
                <p className="m-0 text-sm text-quiet">{item.author} {formatClock(item.createdAt)}{item.executionId ? ' on one execution' : ''}</p>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(event) => {
            event.preventDefault()
            api.addNote(selected, note, openTrace || undefined).then(() => api.notes(selected)).then(setNotes).then(() => setNote('')).catch((reason: Error) => setError(reason.message))
          }}>
            <input className="min-w-0 flex-1 border border-rule bg-tape px-2 py-1" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you see?" />
            <button type="submit" className="border border-ink px-3 py-1">Add note</button>
          </form>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className="border border-ink px-3 py-1" onClick={() => api.investigate(selected).then(setAnswer).catch((reason: Error) => setError(reason.message))}>Investigate</button>
            <button type="button" className="border border-ink px-3 py-1" disabled={!openTrace} onClick={() => openTrace && api.agentInvestigate(openTrace).then(setCause).catch((reason: Error) => setError(reason.message))}>Investigate this failure</button>
            <button type="button" className="border border-ink px-3 py-1" disabled={!openTrace} onClick={() => openTrace && api.proposePatch(openTrace, selected).then(setPatch).catch((reason: Error) => setError(reason.message))}>Generate patch</button>
          </div>
          {answer ? <Answer answer={answer} /> : null}
          {cause ? (
            <div className="mt-6">
              <h2 className="m-0 text-xl font-bold">Evidence</h2>
              <ol className="mt-2 list-decimal pl-5">
                {cause.evidence.map((line) => <li key={line}>{line}</li>)}
              </ol>
              <p className="mt-3">{cause.hypothesis}</p>
              <p className="text-quiet">Confidence {cause.confidence}</p>
              {cause.relatedFiles.length > 0 ? <p className="font-mono text-sm">{cause.relatedFiles.join(', ')}</p> : null}
            </div>
          ) : null}
          {patch ? <PatchReview patch={patch} onApproved={setPatch} onError={setError} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function Answer({ answer }: { answer: InvestigationAnswer }) {
  const sections = [
    ['What happened', answer.whatHappened],
    ['Where it failed', answer.failureLocation],
    ['Suspicious', answer.suspiciousOperations],
    ['Inspect', answer.recommendedInspection],
    ['Missing', answer.missingInformation],
  ] as const
  return (
    <div className="mt-6 max-w-[68ch]">
      <p className="text-lg">{answer.summary}</p>
      {sections.map(([title, lines]) => (
        <div key={title} className="mt-4">
          <h3 className="m-0 text-base font-bold">{title}</h3>
          <ul className="mt-1 list-none p-0">
            {lines.map((line) => <li key={line.text} className="border-t border-rule py-1">{line.kind}: {line.text}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function PatchReview({ patch, onApproved, onError }: { patch: PatchAction; onApproved: (patch: PatchAction) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6">
      <h2 className="m-0 text-xl font-bold">Proposed change</h2>
      <p>{patch.problem}</p>
      <p>{patch.proposedChange}</p>
      <p className="text-quiet">{patch.expectedImpact}</p>
      <pre className="overflow-x-auto border border-rule p-3 font-mono text-sm">{patch.diff}</pre>
      <button type="button" className="mt-3 border border-ink px-3 py-1" onClick={() => setOpen(true)}>Review approval</button>
      {open ? (
        <div className="mt-4 border border-ink p-4" role="dialog" aria-label="Approve change">
          <p className="font-bold">{patch.problem}</p>
          <ul className="list-none p-0">{patch.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
          <p>{patch.proposedChange}</p>
          <p className="font-mono text-sm">{patch.files.join(', ')}</p>
          <p>{patch.expectedImpact}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="border border-ink px-3 py-1" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="border border-ink bg-ink px-3 py-1 text-tape" onClick={() => api.approvePatch(patch.id, patch.diff).then(onApproved).catch((reason: Error) => onError(reason.message))}>Approve change</button>
          </div>
        </div>
      ) : null}
      {patch.applied ? <p className="mt-3 text-ok">Change applied.</p> : null}
    </div>
  )
}
