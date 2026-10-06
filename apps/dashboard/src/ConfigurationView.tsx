import { useState } from 'react'
import { loadAiPrompt, saveAiPrompt } from './sqlCopy'

export function ConfigurationView() {
  const [prompt, setPrompt] = useState(loadAiPrompt)
  const [saved, setSaved] = useState(false)

  return (
    <section>
      <h1 className="m-0 text-2xl font-bold">Configuration</h1>
      <label className="mt-4 block text-sm" htmlFor="ai-sql-prompt">
        AI explanation prompt
      </label>
      <p className="mt-1 text-sm text-quiet">Use {'{sql}'} where the statement should appear.</p>
      <textarea
        id="ai-sql-prompt"
        className="mt-2 min-h-40 w-full border border-rule bg-tape px-2 py-1 font-mono text-sm"
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value)
          setSaved(false)
        }}
      />
      <button
        type="button"
        className="mt-3 border border-ink px-3 py-1 text-sm"
        onClick={() => {
          saveAiPrompt(prompt)
          setSaved(true)
        }}
      >
        {saved ? 'Saved' : 'Save'}
      </button>
    </section>
  )
}
