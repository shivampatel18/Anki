import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Tab = 'decks' | 'dictionary' | 'browse' | 'add' | 'stats' | 'settings';

export type Route =
  | { name: 'tab'; tab: Tab }
  | { name: 'deck'; deckId: number }
  | { name: 'study'; deckId: number }
  | { name: 'deckOptions'; deckId: number }
  | { name: 'editNote'; noteId: number }
  | { name: 'browse'; query: string }
  | { name: 'add'; deckId?: number }
  | { name: 'import' };

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  route: Route;
  /** Push a screen; `back()` returns to the previous one. */
  go: (r: Route) => void;
  /** Replace the stack with a tab. */
  tab: (t: Tab) => void;
  back: () => void;
  /** Bumps whenever data changes, so screens re-query. */
  rev: number;
  refresh: () => void;
  toast: (text: string, action?: Toast['action']) => void;
  currentToast?: Toast;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'tab', tab: 'decks' }]);
  const [rev, setRev] = useState(0);
  const [currentToast, setToast] = useState<Toast>();
  const timer = useRef<number | undefined>(undefined);

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const tab = useCallback((t: Tab) => setStack([{ name: 'tab', tab: t }]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const toast = useCallback((text: string, action?: Toast['action']) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = window.setTimeout(() => setToast(undefined), action ? 5000 : 2600);
  }, []);

  // scroll to top when the screen changes
  const route = stack[stack.length - 1];
  useEffect(() => window.scrollTo(0, 0), [route]);

  return <Ctx.Provider value={{ route, go, tab, back, rev, refresh, toast, currentToast }}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Run an async loader whenever its deps or the data revision change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | undefined; reload: () => void } {
  const { rev } = useApp();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then(
      (d) => live && (setData(d), setError(undefined)),
      (e) => live && setError(e as Error),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, rev, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
