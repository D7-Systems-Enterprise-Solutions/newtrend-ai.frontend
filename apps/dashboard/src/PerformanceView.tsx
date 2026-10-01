import { useState } from 'react'
import { api } from './api'
import { formatMs } from './format'

export function PerformanceView() {
  const [executionId, setExecutionId] = useState('')
  const [operationKey, setOperationKey] = useState('')
  const [versionA, setVersionA] = useState('')
  const [versionB, setVersionB] = useState('')
  const [breakdown, setBreakdown] = useState<Awaited<ReturnType<typeof api.performance>> | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.history>> | null>(null)
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof api.compareVersions>> | null>(null)
  const [explain, setExplain] = useState<string[]>([])
  const [error, setError] = useState('')

  return (
    <section>
      <h1 className="m-0 text-2xl font-bold">Performance</h1>
      <form className="mt-4 grid gap-2" onSubmit={(event) => {
        event.preventDefault()
        setError('')
        api.performance(executionId).then(setBreakdown).catch((reason: Error) => setError(reason.message))
      }}>
        <input className="border border-rule bg-tape px-2 py-1 font-mono" placeholder="Execution id" value={executionId} onChange={(event) => setExecutionId(event.target.value)} />
        <button type="submit" className="w-fit border border-ink px-3 py-1">Show breakdown</button>
      </form>
      {error ? <p className="mt-3 text-fail">{error}</p> : null}
      {breakdown ? (
        <div className="mt-6">
          <h2 className="m-0 text-lg font-bold">Measured share</h2>
          <ul className="mt-2 list-none p-0">
            {breakdown.bottleneck.map((share) => (
              <li key={share.layer} className="grid grid-cols-[8rem_1fr_4rem] gap-3 border-t border-rule py-2 font-mono text-sm">
                <span>{share.layer}</span>
                <span>{formatMs(share.durationMs)}</span>
                <span>{Math.round(share.share * 100)}%</span>
              </li>
            ))}
          </ul>
          {breakdown.slowSql ? (
            <div className="mt-4 max-w-[68ch]">
              <h2 className="m-0 text-lg font-bold">Slow SQL</h2>
              <p>{breakdown.slowSql.userAction} called {breakdown.slowSql.endpoint}. {breakdown.slowSql.handler} reached {breakdown.slowSql.repository}.</p>
              <p className="font-mono text-sm">{breakdown.slowSql.statement}</p>
              <p className="font-mono">{breakdown.slowSql.durationMs != null ? formatMs(breakdown.slowSql.durationMs) : ''}</p>
              <p className="font-mono text-sm text-quiet">{breakdown.slowSql.file}{breakdown.slowSql.line ? `:${breakdown.slowSql.line}` : ''}</p>
            </div>
          ) : null}
          {breakdown.repeated.length > 0 ? (
            <ul className="mt-4 list-none p-0">
              {breakdown.repeated.map((item) => (
                <li key={item.statement} className="border-t border-rule py-2">
                  {item.repeatedReadInLoop ? 'The same read repeated inside one operation.' : 'Repeated database access was detected.'} {item.occurrences} times.
                  <span className="mt-1 block font-mono text-sm">{item.statement}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="mt-4 border border-ink px-3 py-1" onClick={() => api.explainPerformance(executionId).then((result) => setExplain([...result.measuredFacts, ...result.likelyContributors, ...result.recommendations])).catch((reason: Error) => setError(reason.message))}>Explain this execution</button>
          {explain.map((line) => <p key={line} className="max-w-[68ch]">{line}</p>)}
        </div>
      ) : null}
      <form className="mt-8 grid gap-2" onSubmit={(event) => {
        event.preventDefault()
        api.history(operationKey).then(setHistory).catch((reason: Error) => setError(reason.message))
      }}>
        <input className="border border-rule bg-tape px-2 py-1 font-mono" placeholder="Operation key" value={operationKey} onChange={(event) => setOperationKey(event.target.value)} />
        <button type="submit" className="w-fit border border-ink px-3 py-1">Show history</button>
      </form>
      {history ? (
        <ul className="mt-3 list-none p-0 font-mono text-sm">
          {history.versions.map((version) => (
            <li key={version.version ?? 'none'} className="border-t border-rule py-2">
              {version.version ?? 'unversioned'} p50 {Math.round(version.metrics.p50)} ms, p95 {Math.round(version.metrics.p95)} ms, p99 {Math.round(version.metrics.p99)} ms, max {Math.round(version.metrics.maximum)} ms
            </li>
          ))}
        </ul>
      ) : null}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault()
        api.compareVersions(operationKey, versionA, versionB).then(setComparison).catch((reason: Error) => setError(reason.message))
      }}>
        <input className="border border-rule bg-tape px-2 py-1" placeholder="Version A" value={versionA} onChange={(event) => setVersionA(event.target.value)} />
        <input className="border border-rule bg-tape px-2 py-1" placeholder="Version B" value={versionB} onChange={(event) => setVersionB(event.target.value)} />
        <button type="submit" className="border border-ink px-3 py-1">Compare versions</button>
      </form>
      {comparison ? <p className="mt-3">p95 moved from {Math.round(comparison.valueA)} ms to {Math.round(comparison.valueB)} ms ({comparison.changePercent}%).</p> : null}
    </section>
  )
}
