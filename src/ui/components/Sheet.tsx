import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export interface SheetAction {
  label: string;
  run: () => void;
  danger?: boolean;
  color?: string;
  hidden?: boolean;
}

export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {actions
        .filter((a) => !a.hidden)
        .map((a) => (
          <button
            key={a.label}
            className={'sheet-item' + (a.danger ? ' danger' : '')}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            {a.color !== undefined && <span className="dot" style={{ background: a.color || 'transparent', border: a.color ? 0 : '1px solid var(--line)' }} />}
            {a.label}
          </button>
        ))}
      <button className="btn wide" style={{ marginTop: 12 }} onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}

export function PromptSheet({
  title,
  label,
  initial = '',
  confirm,
  hint,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  hint?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSubmit(value);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input ref={input} type="text" value={value} onChange={(e) => setValue(e.target.value)} />
          {hint && <small>{hint}</small>}
        </label>
        {error && <p className="error">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {confirm}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ConfirmSheet({
  title,
  body,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      <div style={{ color: 'var(--ink-2)', marginBottom: 16, textAlign: 'center' }}>{body}</div>
      <div className="btn-row">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className={'btn ' + (danger ? 'danger' : 'primary')}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              onClose();
            }
          }}
        >
          {confirm}
        </button>
      </div>
    </Sheet>
  );
}
