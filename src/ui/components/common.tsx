import type { ReactNode } from 'react';
import { useApp } from '../app-state';
import { IconBack } from './Icons';
import type { Deck } from '../../domain/types';

export function TitleBar({ title, right, back = true, large }: { title: string; right?: ReactNode; back?: boolean; large?: boolean }) {
  const app = useApp();
  if (large)
    return (
      <header className="titlebar">
        <h1>{title}</h1>
        {right}
      </header>
    );
  return (
    <header className="titlebar">
      {back ? (
        <button className="icon-btn" onClick={app.back} aria-label="Back">
          <IconBack />
        </button>
      ) : (
        <span className="spacer" />
      )}
      <h2>{title}</h2>
      {right ?? <span className="spacer" />}
    </header>
  );
}

export function DeckSelect({ decks, value, onChange, id }: { decks: Deck[]; value: number; onChange: (id: number) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {decks.map((d) => (
        <option key={d.id} value={d.id}>
          {' '.repeat(d.name.split('::').length - 1) + d.name.split('::').pop()}
        </option>
      ))}
    </select>
  );
}

export function Count({ n, kind }: { n: number; kind: 'new' | 'learn' | 'due' }) {
  return <span className={`count ${kind}${n === 0 ? ' zero' : ''}`}>{n}</span>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
