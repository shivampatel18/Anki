import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/literata';
import './ui/styles.css';
import { App } from './ui/App';

// Installed iPhone apps resume instead of reloading, so also look for a new version
// whenever the app comes back to the front (and hourly while it stays open).
// With autoUpdate, a new version activates and the page reloads on its own.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
