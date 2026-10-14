import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api, type Execution, type Investigation, type Note } from './api'
import { executionLabel, formatClock, formatMs, labelStatus } from './format'
import { ExecutionView } from './LiveView'

type InvestigationRow = Investigation & { note: string }

export function InvestigateView({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [items, setItems] = useState<InvestigationRow[]>([])
  const [selected, setSelected] = useState('')
  const [dialog, setDialog] = useState<'new' | 'delete' | 'review' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.investigations()
      .then((list) => Promise.all(list.map(async (item) => {
        const written = await api.notes(item.id)
        return { ...item, note: written.map((entry) => entry.text).join('\n') }
      })))
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setSelected((current) => (list.some((item) => item.id === current) ? current : ''))
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const current = items.find((item) => item.id === selected)
  const canAct = current != null

  function close() {
    setDialog(null)
  }

  return (
    <section>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="border border-ink px-3 py-1" onClick={() => setDialog('new')}>New</button>
        <button type="button" className="border border-ink px-3 py-1" disabled={!canAct} onClick={() => setDialog('delete')}>Delete</button>
        <button type="button" className="border border-ink px-3 py-1" disabled={!canAct} onClick={() => setDialog('review')}>Review</button>
        {current ? (
          <a className="border border-ink px-3 py-1" href={api.packageUrl(current.id)}>Export Package</a>
        ) : (
          <button type="button" className="border border-ink px-3 py-1" disabled>Export Package</button>
        )}
      </div>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-rule text-sm uppercase tracking-wide text-quiet">
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
              <th className="px-3 py-2 font-semibold">Note</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-quiet">Record a failing save, then attach it from Live.</td>
              </tr>
            ) : null}
            {items.map((item) => {
              const active = item.id === selected
              return (
                <tr
                  key={item.id}
                  tabIndex={0}
                  aria-selected={active}
                  className={`cursor-pointer border-t border-rule ${active ? 'bg-signal text-on-signal' : 'hover:bg-signal/15'}`}
                  onClick={() => setSelected(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(item.id)
                    }
                  }}
                >
                  <td className="px-3 py-2.5 font-bold">{item.name}</td>
                  <td className="px-3 py-2.5">{item.objective || '—'}</td>
                  <td className="max-w-md px-3 py-2.5 whitespace-pre-line">{item.note || '—'}</td>
                  <td className={`px-3 py-2.5 text-sm uppercase tracking-wide ${active ? '' : 'text-quiet'}`}>{item.status}</td>
                  <td className={`px-3 py-2.5 font-mono text-sm ${active ? '' : 'text-quiet'}`}>{formatWhen(item.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {dialog === 'new' ? (
        <NewDialog
          onClose={close}
          onCreated={(id) => {
            setSelected(id)
            setError('')
            onChanged()
            close()
          }}
        />
      ) : null}
      {dialog === 'delete' && current ? (
        <DeleteDialog
          investigation={current}
          onClose={close}
          onDeleted={() => {
            setSelected('')
            setError('')
            onChanged()
            close()
          }}
        />
      ) : null}
      {dialog === 'review' && current ? <ReviewDialog investigation={current} onClose={close} onNoted={onChanged} /> : null}
    </section>
  )
}

function NewDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  async function create() {
    if (!name.trim()) {
      setError('Name the investigation.')
      return
    }
    const created = await api.createInvestigation(name.trim(), reason.trim())
    if (notes.trim()) await api.addNote(created.id, notes.trim())
    onCreated(created.id)
  }

  return (
    <Dialog title="New investigation" kicker="New" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          create().catch((reasonError: Error) => setError(reasonError.message))
        }}
      >
        <label className="grid gap-1 text-sm">
          Name
          <input className="border border-rule bg-field px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Provider Save Failure" />
        </label>
        <label className="grid gap-1 text-sm">
          Reason
          <input className="border border-rule bg-field px-3 py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Investigate why Save Provider fails" />
        </label>
        <label className="grid gap-1 text-sm">
          Notes
          <textarea className="min-h-24 border border-rule bg-field px-3 py-2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did you see?" />
        </label>
        {error ? <p className="m-0 text-fail">{error}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="border border-ink px-3 py-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="border border-ink bg-ink px-3 py-1 text-tape">Create</button>
        </div>
      </form>
    </Dialog>
  )
}

function DeleteDialog({ investigation, onClose, onDeleted }: { investigation: Investigation; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState('')

  return (
    <Dialog title={investigation.name} kicker="Delete" onClose={onClose}>
      <p className="m-0">Delete this investigation? This removes the investigation record only. Recorded traces and files on this computer stay.</p>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <button type="button" className="border border-ink px-3 py-1" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="border border-ink bg-ink px-3 py-1 text-tape"
          onClick={() => {
            api.deleteInvestigation(investigation.id).then(onDeleted).catch((reason: Error) => setError(reason.message))
          }}
        >
          Delete
        </button>
      </div>
    </Dialog>
  )
}

function ReviewDialog({ investigation, onClose, onNoted }: { investigation: Investigation; onClose: () => void; onNoted: () => void }) {
  const [timeline, setTimeline] = useState<Execution[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [note, setNote] = useState('')
  const [openTrace, setOpenTrace] = useState('')
  const [error, setError] = useState('')
  const current = timeline.find((execution) => execution.traceId === openTrace)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.timeline(investigation.id), api.notes(investigation.id)])
      .then(([events, written]) => {
        if (cancelled) return
        setTimeline(events)
        setNotes(written)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
    return () => {
      cancelled = true
    }
  }, [investigation.id])

  return (
    <Dialog title={investigation.name} kicker="Review" onClose={onClose} wide>
      {investigation.objective ? <p className="m-0 text-quiet">{investigation.objective}</p> : null}
      <h3 className="mb-0 mt-4 text-base font-bold">Items</h3>
      <ol className="mt-2 list-none p-0">
        {timeline.length === 0 ? <li className="text-quiet">Attach an execution from Live.</li> : null}
        {timeline.map((execution) => (
          <li key={execution.traceId} className="border-t border-rule">
            <button
              type="button"
              className={`grid w-full grid-cols-[5.5rem_1fr_auto] gap-3 px-3 py-2.5 text-left ${execution.traceId === openTrace ? 'bg-signal/20' : 'hover:bg-signal/10'}`}
              onClick={() => setOpenTrace(execution.traceId)}
            >
              <time className="font-mono text-quiet">{formatClock(execution.startedAt)}</time>
              <span>{executionLabel(execution)}</span>
              <span className={execution.status === 'failed' ? 'text-fail' : 'text-ok'}>
                {execution.durationMs != null ? formatMs(execution.durationMs) : ''} {labelStatus(execution.status)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {current ? <div className="mt-4"><ExecutionView execution={current} tab="execution" /></div> : null}
      <h3 className="mb-0 mt-6 text-base font-bold">Notes</h3>
      <ul className="mt-2 list-none p-0">
        {notes.length === 0 ? <li className="text-quiet">No notes yet.</li> : null}
        {notes.map((item) => (
          <li key={item.id} className="border-t border-rule py-2">
            <p className="m-0">{item.text}</p>
            <p className="m-0 text-sm text-quiet">{item.author} {formatClock(item.createdAt)}{item.executionId ? ' on one execution' : ''}</p>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!note.trim()) return
          api.addNote(investigation.id, note.trim(), openTrace || undefined)
            .then(() => api.notes(investigation.id))
            .then(setNotes)
            .then(() => {
              setNote('')
              onNoted()
            })
            .catch((reason: Error) => setError(reason.message))
        }}
      >
        <input className="min-w-0 flex-1 border border-rule bg-field px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you see?" aria-label="What did you see?" />
        <button type="submit" className="border border-ink px-3 py-1">Add note</button>
      </form>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
    </Dialog>
  )
}

function Dialog({ title, kicker, onClose, children, wide = false }: { title: string; kicker: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  const titleId = useId()

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
  }, [])

  function requestClose() {
    dialog.current?.close()
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`panel m-auto max-h-[92vh] overflow-auto bg-tape p-0 text-ink shadow-none ${wide ? 'w-[min(76rem,calc(100%-2rem))]' : 'w-[min(32rem,calc(100%-2rem))]'}`}
      onClick={(event) => {
        if (event.target === dialog.current) requestClose()
      }}
    >
      <header className="sticky top-0 z-20 border-b border-rule bg-tape px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 inline-block bg-signal px-2 py-0.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-on-signal">{kicker}</p>
            <h2 id={titleId} className="m-0 mt-3 w-fit max-w-full pb-1 text-2xl font-bold leading-tight tracking-tight shadow-[inset_0_-3px_0_var(--color-signal)]">{title}</h2>
          </div>
          <button type="button" className="shrink-0 border border-ink px-3 py-1 text-sm" onClick={requestClose}>Close</button>
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  )
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
