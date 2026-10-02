import { useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { db } from '../../data/db';
import { createPreset, DEFAULT_PRESET_ID, deletePreset, listPresets, savePreset } from '../../data/repo';
import { isValidStep } from '../../domain/scheduler';
import type { Preset } from '../../domain/types';
import { TitleBar, plural } from '../components/common';
import { ActionSheet, PromptSheet } from '../components/Sheet';

export function DeckOptions({ deckId }: { deckId: number }) {
  const { data } = useLoad(async () => {
    const deck = await db.decks.get(deckId);
    const presets = await listPresets();
    const decks = await db.decks.toArray();
    return { deck, presets, decks };
  }, [deckId]);
  if (!data?.deck) return <div className="screen no-tabs" />;
  const preset = data.presets.find((p) => p.id === data.deck!.presetId) ?? data.presets[0];
  return <OptionsForm key={preset.id + ':' + preset.mtime} deckId={deckId} deckName={data.deck.name} preset={preset} presets={data.presets} usage={data.decks.filter((d) => d.presetId === preset.id).length} />;
}

function OptionsForm({ deckId, deckName, preset, presets, usage }: { deckId: number; deckName: string; preset: Preset; presets: Preset[]; usage: number }) {
  const app = useApp();
  const [p, setP] = useState<Preset>(preset);
  const [learn, setLearn] = useState(preset.learningSteps.join(' '));
  const [relearn, setRelearn] = useState(preset.relearningSteps.join(' '));
  const [params, setParams] = useState(preset.fsrsParams.join(', '));
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<null | 'menu' | 'new' | 'clone' | 'rename'>(null);
  const set = <K extends keyof Preset>(k: K, v: Preset[K]) => setP((x) => ({ ...x, [k]: v }));

  const switchPreset = async (id: number) => {
    await db.decks.update(deckId, { presetId: id });
    app.refresh();
  };

  const save = async () => {
    setError('');
    const ls = learn.split(/[\s,]+/).filter(Boolean);
    const rs = relearn.split(/[\s,]+/).filter(Boolean);
    const bad = [...ls, ...rs].find((s) => !isValidStep(s));
    if (bad) return setError(`“${bad}” isn’t a valid step. Use numbers with m, h or d, like 1m 10m 1d.`);
    const w = params.split(/[\s,]+/).filter(Boolean).map(Number);
    if (w.length && (![17, 19, 21].includes(w.length) || w.some((x) => !Number.isFinite(x))))
      return setError('FSRS parameters must be 19 or 21 numbers (copy them from Anki’s deck options), or left empty.');
    await savePreset({ ...p, learningSteps: ls, relearningSteps: rs, fsrsParams: w });
    app.toast('Options saved.');
    app.refresh();
    app.back();
  };

  const num = (k: 'newPerDay' | 'reviewsPerDay' | 'maximumInterval' | 'leechThreshold', label: string, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} value={p[k]} onChange={(e) => set(k, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <div className="screen no-tabs">
      <TitleBar title="Deck options" right={<button className="btn small" onClick={save}>Save</button>} />
      <p className="muted center" style={{ marginTop: -4 }}>{deckName.split('::').join(' › ')}</p>

      <h3 className="group-title">Preset</h3>
      <div className="group" style={{ paddingTop: 12, paddingBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={preset.id} onChange={(e) => switchPreset(Number(e.target.value))} aria-label="Preset" style={{ flex: 1 }}>
            {presets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => setSheet('menu')}>Manage</button>
        </div>
        <small className="hint">Used by {plural(usage, 'deck')}. Changes apply to all of them.</small>
      </div>

      <h3 className="group-title">Daily limits</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        {num('newPerDay', 'New cards per day', 'Each new card brings about 10 reviews over the following weeks.')}
        {num('reviewsPerDay', 'Maximum reviews per day')}
      </div>

      <h3 className="group-title">Memory</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        <label className="field">
          <span>Desired retention: {Math.round(p.desiredRetention * 100)}%</span>
          <input type="range" min={0.7} max={0.99} step={0.01} value={p.desiredRetention} onChange={(e) => set('desiredRetention', Number(e.target.value))} />
          <small>The chance you’ll remember a card when it comes due. Higher means more reviews; above 95% the workload climbs steeply.</small>
        </label>
        <label className="field">
          <span>Learning steps</span>
          <input type="text" value={learn} onChange={(e) => setLearn(e.target.value)} autoCapitalize="off" />
          <small>Short repeats for new cards before they graduate, e.g. 1m 10m.</small>
        </label>
        <label className="field">
          <span>Relearning steps</span>
          <input type="text" value={relearn} onChange={(e) => setRelearn(e.target.value)} autoCapitalize="off" />
          <small>Repeats after you forget a card. Leave empty to let the scheduler decide.</small>
        </label>
        {num('maximumInterval', 'Maximum interval (days)')}
        <label className="switch">
          <span>Spread out due dates slightly</span>
          <input type="checkbox" checked={p.enableFuzz} onChange={(e) => set('enableFuzz', e.target.checked)} />
        </label>
      </div>

      <h3 className="group-title">Order and siblings</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        <label className="field">
          <span>New card order</span>
          <select value={p.newOrder} onChange={(e) => set('newOrder', e.target.value as Preset['newOrder'])}>
            <option value="added">In the order added</option>
            <option value="random">Random</option>
          </select>
        </label>
        <label className="switch">
          <span>Hide new siblings until tomorrow</span>
          <input type="checkbox" checked={p.buryNew} onChange={(e) => set('buryNew', e.target.checked)} />
        </label>
        <label className="switch">
          <span>Hide review siblings until tomorrow</span>
          <input type="checkbox" checked={p.buryReviews} onChange={(e) => set('buryReviews', e.target.checked)} />
        </label>
      </div>

      <h3 className="group-title">Leeches</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        {num('leechThreshold', 'Mark as leech after this many lapses', '0 turns leech detection off.')}
        <label className="field">
          <span>When a card becomes a leech</span>
          <select value={p.leechAction} onChange={(e) => set('leechAction', e.target.value as Preset['leechAction'])}>
            <option value="tag">Tag it “leech”</option>
            <option value="suspend">Tag it and suspend it</option>
          </select>
        </label>
      </div>

      <h3 className="group-title">Advanced</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        <label className="field">
          <span>FSRS parameters</span>
          <textarea value={params} onChange={(e) => setParams(e.target.value)} placeholder="Empty: use the defaults" rows={3} style={{ fontSize: 15 }} />
          <small>Imported from Anki when available. Paste optimized parameters from Anki’s deck options to personalize scheduling.</small>
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" onClick={save}>Save options</button>

      {sheet === 'menu' && (
        <ActionSheet
          title={preset.name}
          onClose={() => setSheet(null)}
          actions={[
            { label: 'New preset with defaults', run: () => setSheet('new') },
            { label: 'Copy this preset', run: () => setSheet('clone') },
            { label: 'Rename preset', run: () => setSheet('rename') },
            {
              label: 'Delete preset',
              danger: true,
              hidden: preset.id === DEFAULT_PRESET_ID,
              run: async () => {
                await deletePreset(preset.id);
                app.toast('Preset deleted. Its decks now use Default.');
                app.refresh();
              },
            },
          ]}
        />
      )}
      {(sheet === 'new' || sheet === 'clone') && (
        <PromptSheet
          title={sheet === 'new' ? 'New preset' : 'Copy preset'}
          label="Preset name"
          initial={sheet === 'clone' ? `${preset.name} copy` : ''}
          confirm="Create preset"
          onClose={() => setSheet(null)}
          onSubmit={async (name) => {
            const created = await createPreset(name.trim(), sheet === 'clone' ? preset : undefined);
            await switchPreset(created.id);
          }}
        />
      )}
      {sheet === 'rename' && (
        <PromptSheet
          title="Rename preset"
          label="Preset name"
          initial={preset.name}
          confirm="Rename"
          onClose={() => setSheet(null)}
          onSubmit={async (name) => {
            await savePreset({ ...preset, name: name.trim() });
            app.refresh();
          }}
        />
      )}
    </div>
  );
}
