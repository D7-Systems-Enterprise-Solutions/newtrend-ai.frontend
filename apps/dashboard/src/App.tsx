import { useEffect, useState } from 'react'
import { api, type Investigation } from './api'
import { BehaviorView } from './BehaviorView'
import { ConfigurationView } from './ConfigurationView'
import { InvestigateView } from './InvestigateView'
import { LiveView } from './LiveView'
import { PerformanceView } from './PerformanceView'
import { applyTheme, initTheme, type Theme } from './theme'

type Area = 'live' | 'investigate' | 'behavior' | 'performance' | 'configuration'

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
      <div className="h-1.5 bg-signal" />
      <div className="mx-auto flex min-h-[calc(100svh-0.375rem)] w-full max-w-[90rem] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <header className="mast flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center bg-signal font-display text-[1.65rem] font-bold leading-none text-on-signal" aria-hidden="true">N</span>
            <div>
              <p className="m-0 font-display text-[1.7rem] font-bold uppercase leading-none tracking-[0.12em]">Newtrend-ai</p>
              <p className="m-0 mt-1 flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-quiet">
                <span className="live-lamp size-1.5 bg-signal motion-safe:animate-pulse" aria-hidden="true" />
                Dashboard
              </p>
            </div>
          </div>
          <nav className="switch" aria-label="Areas">
            <button type="button" aria-current={area === 'live' ? 'page' : undefined} onClick={() => setArea('live')}>Live</button>
            <button type="button" aria-current={area === 'investigate' ? 'page' : undefined} onClick={() => setArea('investigate')}>Investigate</button>
            <button type="button" aria-current={area === 'behavior' ? 'page' : undefined} onClick={() => setArea('behavior')}>Behavior</button>
            <button type="button" aria-current={area === 'performance' ? 'page' : undefined} onClick={() => setArea('performance')}>Performance</button>
            <button type="button" aria-current={area === 'configuration' ? 'page' : undefined} onClick={() => setArea('configuration')}>Configuration</button>
          </nav>
          <div className="switch" role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === 'day'} onClick={() => chooseTheme('day')}>Day</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => chooseTheme('dark')}>Dark</button>
          </div>
        </header>
        <section className="panel flex-1 px-5 py-6 sm:px-6">
          {area === 'live' ? <LiveView investigations={investigations} onAttached={() => setRefreshKey((value) => value + 1)} /> : null}
          {area === 'investigate' ? <InvestigateView refreshKey={refreshKey} /> : null}
          {area === 'behavior' ? <BehaviorView /> : null}
          {area === 'performance' ? <PerformanceView /> : null}
          {area === 'configuration' ? <ConfigurationView /> : null}
        </section>
      </div>
    </main>
  )
}
