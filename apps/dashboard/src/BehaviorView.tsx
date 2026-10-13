import { useEffect, useState } from 'react'
import { api, type Baseline, type BehaviorDiff, type MapNode } from './api'

export function BehaviorView() {
  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [baselineId, setBaselineId] = useState('')
  const [executionId, setExecutionId] = useState('')
  const [name, setName] = useState('Save Provider')
  const [feature, setFeature] = useState('Save Provider')
  const [diff, setDiff] = useState<BehaviorDiff | null>(null)
  const [map, setMap] = useState<MapNode | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.baselines().then(setBaselines).catch((reason: Error) => setError(reason.message))
  }, [])

  return (
    <section>
      <h1 className="m-0 text-2xl font-bold">Behavior</h1>
      <form className="mt-4 grid gap-2" onSubmit={(event) => {
        event.preventDefault()
        api.saveBaseline(name, executionId, feature).then(() => api.baselines()).then(setBaselines).catch((reason: Error) => setError(reason.message))
      }}>
        <input className="border border-rule bg-field px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="border border-rule bg-field px-3 py-2" value={feature} onChange={(event) => setFeature(event.target.value)} />
        <input className="border border-rule bg-field px-3 py-2 font-mono" placeholder="Execution id" value={executionId} onChange={(event) => setExecutionId(event.target.value)} />
        <button type="submit" className="w-fit border border-ink px-3 py-1">Save baseline</button>
      </form>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
      <ul className="mt-4 list-none p-0">
        {baselines.map((baseline) => (
          <li key={baseline.id} className="border-t border-rule">
            <button type="button" className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left ${baselineId === baseline.id ? 'bg-signal font-bold text-on-signal' : 'hover:bg-signal/15'}`} onClick={() => setBaselineId(baseline.id)}>
              <span>{baseline.name}</span>
              <span className={`font-mono text-sm font-normal ${baselineId === baseline.id ? 'opacity-70' : 'text-quiet'}`}>{baseline.applicationVersion}</span>
            </button>
          </li>
        ))}
      </ul>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault()
        api.compare(executionId, baselineId).then(setDiff).catch((reason: Error) => setError(reason.message))
      }}>
        <button type="submit" className="border border-ink px-3 py-1" disabled={!baselineId || !executionId}>Compare</button>
        <button type="button" className="border border-ink px-3 py-1" onClick={() => api.map(feature).then(setMap).catch((reason: Error) => setError(reason.message))}>Show map</button>
      </form>
      {diff ? (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="m-0 text-lg font-bold">Expected</h2>
            <ul className="mt-2 list-none p-0 font-mono text-sm">{diff.expected.map((key) => <li key={key} className="border-t border-rule py-1">{key}</li>)}</ul>
          </div>
          <div>
            <h2 className="m-0 text-lg font-bold">Observed</h2>
            <ul className="mt-2 list-none p-0 font-mono text-sm">
              {diff.observed.map((key) => <li key={key} className="border-t border-rule py-1">{diff.added.includes(key) ? `+ ${key}` : key}</li>)}
            </ul>
          </div>
          <p className="md:col-span-2">Compared: added {diff.added.join(', ') || 'nothing'}.</p>
        </div>
      ) : null}
      {map ? <MapTree node={map} /> : null}
    </section>
  )
}

function MapTree({ node }: { node: MapNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-2 border-l border-rule pl-3">
      <button type="button" onClick={() => setOpen(!open)}>{open ? '−' : '+'} {node.name}</button>
      {open ? node.children.map((child) => <MapTree key={`${child.type}-${child.name}`} node={child} />) : null}
    </div>
  )
}
