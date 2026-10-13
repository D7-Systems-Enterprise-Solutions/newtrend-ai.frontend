import { initNewtrendAi } from '@newtrend-ai/react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './app.css';

initNewtrendAi({
  appName: 'Sample.React',
  endpoint: 'http://127.0.0.1:4318',
});

createRoot(document.getElementById('root')).render(<App />);
