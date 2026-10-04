import { useRef, useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { collectionCounts, getSettings, updateSettings } from '../../data/repo';
import { mediaUsage } from '../../data/media';
import { eraseEverything, exportBackup, restoreBackup } from '../../data/backup';
import { applyTheme, type ThemePref } from '../theme';
import { TitleBar, downloadBlob, plural } from '../components/common';
import { ConfirmSheet } from '../components/Sheet';
import { IconChevronRight } from '../components/Icons';

function mb(bytes: number) {
  return bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

export function SettingsScreen() {
  const app = useApp();
  const restoreInput = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<null | 'erase' | { file: File }>(null);
  const [busy, setBusy] = useState('');
  const { data, reload } = useLoad(async () => {
    const [settings, counts, media] = await Promise.all([getSettings(), collectionCounts(), mediaUsage()]);
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    return { settings, counts, media, est, persisted };
  }, []);

  if (!data) return <div className="screen" />;
  const s = data.settings;

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(patch);
    if (patch.theme) applyTheme(patch.theme);
    reload();
    app.refresh();
  };

  return (
    <div className="screen">
      <TitleBar large title="Settings" />

      <h3 className="group-title">Your collection</h3>
      <div className="group">
        <button className="row-link" onClick={() => app.go({ name: 'import' })}>
          <span className="grow">Import from Anki or a text file</span>
          <IconChevronRight />
        </button>
        <button
          className="row-link"
          disabled={!!busy}
          onClick={async () => {
            setBusy('Preparing backup…');
            try {
              const blob = await exportBackup(true);
              downloadBlob(blob, `recall-backup-${new Date().toISOString().slice(0, 10)}.zip`);
            } finally {
              setBusy('');
            }
          }}
        >
          <span className="grow">Back up everything<div className="meta">A .zip with your cards, progress and media</div></span>
          <IconChevronRight />
        </button>
        <button className="row-link" onClick={() => restoreInput.current?.click()}>
          <span className="grow">Restore from a backup<div className="meta">Replaces everything on this device</div></span>
          <IconChevronRight />
        </button>
        <input ref={restoreInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setConfirm({ file: f }); e.target.value = ''; }} />
      </div>
      {busy && <p className="muted">{busy}</p>}

      <h3 className="group-title">Studying</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        <label className="field">
          <span>A new day starts at</span>
          <select value={s.dayStartHour} onChange={(e) => save({ dayStartHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}
              </option>
            ))}
          </select>
          <small>Reviews done after midnight but before this hour count toward the previous day.</small>
        </label>
        <label className="field">
          <span>Show learning cards early by up to</span>
          <select value={s.learnAheadMinutes} onChange={(e) => save({ learnAheadMinutes: Number(e.target.value) })}>
            {[0, 5, 10, 20, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Never' : `${m} minutes`}
              </option>
            ))}
          </select>
          <small>When nothing else is due, a card in its learning steps can come back a little early.</small>
        </label>
      </div>

      <h3 className="group-title">Appearance</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        <label className="field">
          <span>Theme</span>
          <select value={s.theme} onChange={(e) => save({ theme: e.target.value as ThemePref })}>
            <option value="system">Match this device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>

      <h3 className="group-title">Storage</h3>
      <div className="group" style={{ padding: 16 }}>
        <dl className="kv">
          <dt>Notes</dt>
          <dd>{data.counts.notes.toLocaleString()}</dd>
          <dt>Cards</dt>
          <dd>{data.counts.cards.toLocaleString()}</dd>
          <dt>Media</dt>
          <dd>{plural(data.media.count, 'file')}, {mb(data.media.bytes)}</dd>
          {data.est?.usage !== undefined && (
            <>
              <dt>Space used</dt>
              <dd>{mb(data.est.usage)}</dd>
            </>
          )}
          <dt>Protected from clean-up</dt>
          <dd>{data.persisted ? 'Yes' : 'No'}</dd>
        </dl>
        {!data.persisted && (
          <p className="hint">
            Everything is stored on this device only. Add Recall to your Home Screen so iOS keeps it, and back up regularly.
          </p>
        )}
      </div>

      <h3 className="group-title">Danger zone</h3>
      <div className="group">
        <button className="row-link danger" onClick={() => setConfirm('erase')}>
          <span className="grow">Erase all data on this device</span>
        </button>
      </div>

      <p className="hint center" style={{ marginTop: 24 }}>
        Recall schedules reviews with FSRS, the same algorithm Anki uses. Your data never leaves this device.
      </p>
      <p className="hint center">Version built {__APP_VERSION__}</p>

      {confirm === 'erase' && (
        <ConfirmSheet
          title="Erase everything?"
          body="All decks, cards, progress and media on this device will be deleted. Make a backup first if you might want them back."
          confirm="Erase everything"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => eraseEverything()}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <ConfirmSheet
          title="Restore this backup?"
          body={`Everything currently on this device will be replaced by ${confirm.file.name}.`}
          confirm="Restore"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              const r = await restoreBackup(confirm.file);
              app.toast(`Restored ${plural(r.cards, 'card')}.`);
              setTimeout(() => location.reload(), 800);
            } catch (e) {
              app.toast((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
