import '@fontsource-variable/inter/index.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startAnalytics } from './lib/analytics';

const root = document.getElementById('root');

if (!root) {
  throw new Error('missing #root element');
}

startAnalytics();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
