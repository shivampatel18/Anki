import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  window.dispatchEvent(new Event('themechange'));
}

function computeDark(): boolean {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr) return attr === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useIsDark(): boolean {
  const [dark, setDark] = useState(computeDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(computeDark());
    mq.addEventListener('change', update);
    window.addEventListener('themechange', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('themechange', update);
    };
  }, []);
  return dark;
}
