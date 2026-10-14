import { useState } from 'react';

export function App() {
  const [result, setResult] = useState('Ready');

  async function save() {
    setResult('Saving');
    try {
      const response = await fetch('http://127.0.0.1:5088/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: 'Acme' }),
      });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      setResult('Saved');
    } catch {
      setResult('Could not save');
    }
  }

  return (
    <main>
      <p className="eyebrow">Sample application</p>
      <h1>Providers</h1>
      <p>Save a provider. The dashboard shows what this click actually did.</p>
      <button type="button" onClick={save}>Save</button>
      <p className="result">{result}</p>
    </main>
  );
}
