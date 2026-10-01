import { useEffect, useState } from 'react'
import { api, type Investigation } from './api'
import { BehaviorView } from './BehaviorView'
import { InvestigateView } from './InvestigateView'
import { LiveView } from './LiveView'
import { PerformanceView } from './PerformanceView'
import { applyTheme, initTheme, type Theme } from './theme'

type Area = 'live' | 'investigate' | 'behavior' | 'performance'

export default function App() {
  const [area, setArea] = useState<Area>('live')
  const [theme, setTheme] = useState<Theme>('day')
  const [investigations, setInvestigations] = useState<Investigation[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setTheme(initTheme())
    api.investigations().then(setInvestigations).catch(() => setInvestigations([]))
  }, [refreshKey])

  function chooseTheme(next: Theme) {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <main className="min-h-svh bg-housing text-ink">
      <div className="mx-auto flex min-h-svh max-w-3xl flex-col px-5 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="live-lamp size-3 rounded-full bg-signal motion-safe:animate-pulse" aria-hidden="true" />
            <p className="m-0 text-lg font-bold leading-none">AI-Newtrend</p>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Areas">
            <AreaButton active={area === 'live'} onClick={() => setArea('live')}>Live</AreaButton>
            <AreaButton active={area === 'investigate'} onClick={() => setArea('investigate')}>Investigate</AreaButton>
            <AreaButton active={area === 'behavior'} onClick={() => setArea('behavior')}>Behavior</AreaButton>
            <AreaButton active={area === 'performance'} onClick={() => setArea('performance')}>Performance</AreaButton>
          </nav>
          <div className="flex gap-1 text-sm" role="group" aria-label="Theme">
            <AreaButton active={theme === 'day'} onClick={() => chooseTheme('day')}>Day</AreaButton>
            <AreaButton active={theme === 'dark'} onClick={() => chooseTheme('dark')}>Dark</AreaButton>
          </div>
        </header>
        <section className="mt-8 flex-1 bg-tape px-5 py-6 shadow-[0_1px_0_rgba(36,28,20,0.08)]">
          {area === 'live' ? <LiveView investigations={investigations} onAttached={() => setRefreshKey((value) => value + 1)} /> : null}
          {area === 'investigate' ? <InvestigateView refreshKey={refreshKey} /> : null}
          {area === 'behavior' ? <BehaviorView /> : null}
          {area === 'performance' ? <PerformanceView /> : null}
        </section>
      </div>
    </main>
  )
}

function AreaButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={`border-b-2 px-2 py-1 ${active ? 'border-ink font-bold' : 'border-transparent text-quiet'}`}>
      {children}
    </button>
  )
}
