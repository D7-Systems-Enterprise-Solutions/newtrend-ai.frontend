import { useState } from 'react'
import {
  defaultInfrastructureRules,
  loadInfrastructureRules,
  saveInfrastructureRules,
  type InfrastructureRules,
} from './infrastructureConfig'
import { clampBurstItems, defaultBurstItems, loadBurstItems, maxBurstItems, saveBurstItems } from './burstLimit'
import { defaultAiPrompt, loadAiPrompt, saveAiPrompt } from './sqlCopy'

type ConfigurationTab = 'prompt' | 'infrastructure' | 'burst'

const lists: { key: keyof InfrastructureRules; label: string; hint: string }[] = [
  {
    key: 'generatedPatterns',
    label: 'Generated name patterns',
    hint: 'Regular expressions matched against the span name and the source function. An invalid pattern is ignored.',
  },
  {
    key: 'nameText',
    label: 'Name text',
    hint: 'Case-insensitive text matched inside the span name or the source function.',
  },
  {
    key: 'schemas',
    label: 'SQL schemas',
    hint: 'Schema of a FROM, JOIN, INTO, or UPDATE target.',
  },
  {
    key: 'tables',
    label: 'Exact tables',
    hint: 'Table name of a FROM, JOIN, INTO, or UPDATE target.',
  },
  {
    key: 'tablePrefixes',
    label: 'Table prefixes',
    hint: 'The table name starts with this text.',
  },
  {
    key: 'tableText',
    label: 'Table text',
    hint: 'Case-insensitive text matched inside the table name.',
  },
]

export function ConfigurationView() {
  const [tab, setTab] = useState<ConfigurationTab>('prompt')
  const [prompt, setPrompt] = useState(loadAiPrompt)
  const [promptSaved, setPromptSaved] = useState(false)
  const [rules, setRules] = useState(loadInfrastructureRules)
  const [rulesSaved, setRulesSaved] = useState(false)
  const [burstItems, setBurstItems] = useState(String(loadBurstItems()))
  const [burstSaved, setBurstSaved] = useState(false)
  const [burstError, setBurstError] = useState('')

  function updateList(key: keyof InfrastructureRules, values: string[]) {
    setRules((current) => ({ ...current, [key]: values }))
    setRulesSaved(false)
  }

  function saveRules() {
    saveInfrastructureRules(rules)
    setRules(loadInfrastructureRules())
    setRulesSaved(true)
  }

  function restoreRules() {
    saveInfrastructureRules(defaultInfrastructureRules)
    setRules(loadInfrastructureRules())
    setRulesSaved(true)
  }

  function restorePrompt() {
    setPrompt(defaultAiPrompt)
    saveAiPrompt(defaultAiPrompt)
    setPromptSaved(true)
  }

  function saveBurst() {
    const next = clampBurstItems(Number(burstItems))
    if (next == null) {
      setBurstError('Enter a whole number from 1 to 350.')
      setBurstSaved(false)
      return
    }

    setBurstError('')
    saveBurstItems(next)
    setBurstItems(String(next))
    setBurstSaved(true)
  }

  function restoreBurst() {
    saveBurstItems(defaultBurstItems)
    setBurstItems(String(defaultBurstItems))
    setBurstError('')
    setBurstSaved(true)
  }

  return (
    <section>
      <h1 className="m-0 text-2xl font-bold">Configuration</h1>
      <nav className="switch mt-4" aria-label="Configuration">
        <button type="button" aria-current={tab === 'prompt' ? 'page' : undefined} onClick={() => setTab('prompt')}>
          AI explanation prompt
        </button>
        <button type="button" aria-current={tab === 'infrastructure' ? 'page' : undefined} onClick={() => setTab('infrastructure')}>
          Infrastructure filter
        </button>
        <button type="button" aria-current={tab === 'burst' ? 'page' : undefined} onClick={() => setTab('burst')}>
          Burst size
        </button>
      </nav>

      {tab === 'prompt' ? (
        <div>
          <label className="mt-4 block text-sm" htmlFor="ai-sql-prompt">
            AI explanation prompt
          </label>
          <p className="mt-1 text-sm text-quiet">Use {'{sql}'} where the statement should appear.</p>
          <textarea
            id="ai-sql-prompt"
            className="mt-2 min-h-40 w-full border border-rule bg-field px-3 py-2 font-mono text-sm"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value)
              setPromptSaved(false)
            }}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="border border-ink px-3 py-1 text-sm"
              onClick={() => {
                saveAiPrompt(prompt)
                setPromptSaved(true)
              }}
            >
              {promptSaved ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={restorePrompt}>
              Restore defaults
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'burst' ? (
        <div>
          <label className="mt-4 block text-sm" htmlFor="burst-items">
            Maximum items in a burst
          </label>
          <p className="mt-1 max-w-[62ch] text-sm text-quiet">
            When the next item would pass this number, a new burst starts and the live table clears. Earlier bursts stay in the session. The highest value is {maxBurstItems}. The default is {defaultBurstItems}.
          </p>
          <input
            id="burst-items"
            type="number"
            min={1}
            max={maxBurstItems}
            step={1}
            className="mt-2 w-32 border border-rule bg-field px-3 py-2 font-mono text-sm"
            value={burstItems}
            onChange={(event) => {
              const raw = event.target.value
              if (raw !== '' && Number(raw) > maxBurstItems) {
                setBurstItems(String(maxBurstItems))
                setBurstError('The maximum is 350.')
              } else {
                setBurstItems(raw)
                setBurstError('')
              }
              setBurstSaved(false)
            }}
          />
          {burstError ? <p className="mt-2 text-sm text-fail">{burstError}</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={saveBurst}>
              {burstSaved ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={restoreBurst}>
              Restore defaults
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'infrastructure' ? (
        <div>
          <p className="mt-4 max-w-[62ch] text-sm text-quiet">
            A step is hidden from the main table when its span name, source function, or SQL matches one of these lists. The same lists apply to .NET, Java, and Go traces. Add the names your own framework uses.
          </p>
          {lists.map((list) => (
            <ValueList
              key={list.key}
              id={`infrastructure-${list.key}`}
              label={list.label}
              hint={list.hint}
              values={rules[list.key]}
              onChange={(values) => updateList(list.key, values)}
            />
          ))}
          <div className="mt-4 flex gap-2">
            <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={saveRules}>
              {rulesSaved ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={restoreRules}>
              Restore defaults
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ValueList({
  id,
  label,
  hint,
  values,
  onChange,
}: {
  id: string
  label: string
  hint: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const next = draft.trim()
    if (!next || values.some((value) => value.toLowerCase() === next.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...values, next])
    setDraft('')
  }

  return (
    <div className="mt-6">
      <label className="block text-sm" htmlFor={id}>{label}</label>
      <p className="mt-1 text-sm text-quiet">{hint}</p>
      {values.length === 0 ? <p className="mt-2 text-sm text-quiet">No values. This rule matches nothing.</p> : (
        <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
          {values.map((value) => (
            <li key={value} className="inline-flex items-center gap-2 border border-rule bg-field px-2 py-1 font-mono text-xs">
              <span>{value}</span>
              <button
                type="button"
                className="px-0.5 text-base font-bold leading-none text-fail"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input
          id={id}
          className="w-full max-w-md border border-rule bg-field px-2 py-1 font-mono text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="border border-ink px-3 py-1 text-sm" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}
