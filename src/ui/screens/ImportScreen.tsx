import { useRef, useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { importPackage, type ImportSummary } from '../../import/importer';
import { loadSql } from '../../import/sqljs-browser';
import { importRows, parseDelimited, type ParsedText, type TextImportResult } from '../../import/csv';
import { listDecks, listNoteTypes } from '../../data/repo';
import { DeckSelect, Progress, TitleBar, plural } from '../components/common';

type Phase =
  | { kind: 'pick' }
  | { kind: 'running'; stage: string; value: number; file: string }
  | { kind: 'done'; summary: ImportSummary; file: string }
  | { kind: 'text'; parsed: ParsedText; file: string }
  | { kind: 'textDone'; result: TextImportResult }
  | { kind: 'error'; message: string };

export function ImportScreen() {
  const app = useApp();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [updateExisting, setUpdateExisting] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (['csv', 'tsv', 'txt'].includes(ext)) {
        const parsed = parseDelimited(await file.text());
        if (!parsed.rows.length) throw new Error('That file has no rows to import.');
        setPhase({ kind: 'text', parsed, file: file.name });
        return;
      }
      setPhase({ kind: 'running', stage: 'Opening file', value: 0, file: file.name });
      const sql = await loadSql();
      const summary = await importPackage(file, sql, { updateExisting }, (stage, done, total) =>
        setPhase({ kind: 'running', stage, value: total ? done / total : 0, file: file.name }),
      );
      app.refresh();
      setPhase({ kind: 'done', summary, file: file.name });
    } catch (e) {
      console.error(e);
      setPhase({ kind: 'error', message: (e as Error).message || 'The import failed.' });
    }
  };

  return (
    <div className="screen no-tabs">
      <TitleBar title="Import" />
      {phase.kind === 'pick' && (
        <>
          <div className="dropzone">
            <b>Bring your Anki decks over</b>
            <p className="muted" style={{ margin: '0 0 12px', maxWidth: '36ch' }}>
              In Anki on your computer, choose File › Export, pick “Anki Deck Package (.apkg)”, and include scheduling information and media. Then open that file here.
            </p>
            <button className="btn primary" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            {/* no accept filter: iOS greys out unknown extensions like .apkg */}
            <input ref={input} type="file" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="group" style={{ marginTop: 16 }}>
            <label className="switch">
              <span>
                Update cards I already have
                <small className="hint" style={{ marginTop: 2 }}>Bring in newer progress and edits when you re-import the same deck.</small>
              </span>
              <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
            </label>
          </div>
          <p className="hint">Also accepts whole-collection backups from Anki (.colpkg) and text files (.csv, .tsv, .txt) with one note per line.</p>
        </>
      )}

      {phase.kind === 'running' && (
        <div className="stack" style={{ marginTop: 32 }}>
          <p><b>Importing {phase.file}</b></p>
          <Progress value={phase.value} />
          <p className="muted">{phase.stage}…</p>
          <p className="hint">Large decks with lots of images can take a minute. Keep this screen open.</p>
        </div>
      )}

      {phase.kind === 'done' && <ImportResult summary={phase.summary} file={phase.file} onAnother={() => setPhase({ kind: 'pick' })} />}

      {phase.kind === 'text' && <TextImport parsed={phase.parsed} file={phase.file} onDone={(result) => { app.refresh(); setPhase({ kind: 'textDone', result }); }} />}

      {phase.kind === 'textDone' && (
        <div className="stack">
          <h3>Import finished</h3>
          <ul className="summary-list">
            <li>{plural(phase.result.added, 'note')} added</li>
            {phase.result.duplicates > 0 && <li>{plural(phase.result.duplicates, 'duplicate')} skipped</li>}
            {phase.result.failed > 0 && <li>{plural(phase.result.failed, 'row')} couldn’t be imported</li>}
          </ul>
          {phase.result.errors.map((e) => <p key={e} className="hint">{e}</p>)}
          <button className="btn primary wide" onClick={() => app.tab('decks')}>Go to decks</button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="stack">
          <p className="error">{phase.message}</p>
          <button className="btn wide" onClick={() => setPhase({ kind: 'pick' })}>Choose another file</button>
        </div>
      )}
    </div>
  );
}

function ImportResult({ summary: s, file, onAnother }: { summary: ImportSummary; file: string; onAnother: () => void }) {
  const app = useApp();
  return (
    <div className="stack">
      <h3 style={{ marginBottom: 0 }}>Imported {file}</h3>
      <ul className="summary-list">
        <li>{plural(s.notesAdded, 'new note')}, {plural(s.cardsAdded, 'card')}</li>
        {s.notesUpdated > 0 && <li>{plural(s.notesUpdated, 'note')} updated</li>}
        {s.cardsUpdated > 0 && <li>Progress updated on {plural(s.cardsUpdated, 'card')}</li>}
        {s.notesUnchanged > 0 && <li>{plural(s.notesUnchanged, 'note')} already here and unchanged</li>}
        {s.reviewsAdded > 0 && <li>{plural(s.reviewsAdded, 'past review')} brought over</li>}
        {s.media > 0 && <li>{plural(s.media, 'media file')}</li>}
        {s.decks.length > 0 && <li>New decks: {s.decks.join(', ')}</li>}
      </ul>
      {s.warnings.length > 0 && (
        <details>
          <summary className="muted">{plural(s.warnings.length, 'warning')}</summary>
          {s.warnings.slice(0, 20).map((w, i) => <p key={i} className="hint">{w}</p>)}
        </details>
      )}
      <button className="btn primary wide" onClick={() => app.tab('decks')}>Go to decks</button>
      <button className="btn wide" onClick={onAnother}>Import another file</button>
    </div>
  );
}

function TextImport({ parsed, file, onDone }: { parsed: ParsedText; file: string; onDone: (r: TextImportResult) => void }) {
  const { data } = useLoad(async () => ({ noteTypes: await listNoteTypes(), decks: await listDecks() }), []);
  const [noteTypeId, setNoteTypeId] = useState<number>();
  const [deckId, setDeckId] = useState<number>();
  const [mapping, setMapping] = useState<(number | null)[]>([]);
  const [tagsCol, setTagsCol] = useState<number | null>(parsed.tagsColumn ?? null);
  const [html, setHtml] = useState(parsed.html);
  const [skipDup, setSkipDup] = useState(true);
  const [extraTags, setExtraTags] = useState('');
  const [busy, setBusy] = useState(0);
  if (!data) return null;
  const nt = data.noteTypes.find((n) => n.id === noteTypeId) ?? data.noteTypes.find((n) => n.name === 'Basic') ?? data.noteTypes[0];
  const deck = deckId ?? data.decks[0].id;
  const map = nt.fields.map((_, i) => (mapping[i] !== undefined ? mapping[i] : i < parsed.columns && i !== tagsCol ? i : null));
  const cols = Array.from({ length: parsed.columns }, (_, i) => i);

  return (
    <div>
      <p className="muted">{file}: {plural(parsed.rows.length, 'row')}, {plural(parsed.columns, 'column')}.</p>
      <div className="table-scroll">
        <table>
          <thead><tr>{cols.map((c) => <th key={c}>Column {c + 1}</th>)}</tr></thead>
          <tbody>
            {parsed.rows.slice(0, 4).map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c}>{r[c] ?? ''}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="field">
        <span>Note type</span>
        <select value={nt.id} onChange={(e) => { setNoteTypeId(Number(e.target.value)); setMapping([]); }}>
          {data.noteTypes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Deck</span>
        <DeckSelect decks={data.decks} value={deck} onChange={setDeckId} />
      </label>
      <h3 className="group-title">Columns</h3>
      <div className="group" style={{ paddingTop: 12 }}>
        {nt.fields.map((f, i) => (
          <label className="field" key={f.name}>
            <span>{f.name}</span>
            <select value={map[i] ?? ''} onChange={(e) => { const next = [...map]; next[i] = e.target.value === '' ? null : Number(e.target.value); setMapping(next); }}>
              <option value="">Leave empty</option>
              {cols.map((c) => <option key={c} value={c}>Column {c + 1}</option>)}
            </select>
          </label>
        ))}
        <label className="field">
          <span>Tags</span>
          <select value={tagsCol ?? ''} onChange={(e) => setTagsCol(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">No tags column</option>
            {cols.map((c) => <option key={c} value={c}>Column {c + 1}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Add these tags to every note</span>
          <input type="text" value={extraTags} onChange={(e) => setExtraTags(e.target.value)} autoCapitalize="off" />
        </label>
        <label className="switch">
          <span>Fields contain HTML</span>
          <input type="checkbox" checked={html} onChange={(e) => setHtml(e.target.checked)} />
        </label>
        <label className="switch">
          <span>Skip rows whose first field already exists</span>
          <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
        </label>
      </div>
      {busy > 0 && <Progress value={busy} />}
      <button
        className="btn primary wide"
        style={{ marginTop: 12 }}
        disabled={busy > 0}
        onClick={async () => {
          setBusy(0.01);
          const r = await importRows(parsed.rows, { noteTypeId: nt.id, deckId: deck, fieldColumns: map, tagsColumn: tagsCol, extraTags: extraTags.split(/\s+/).filter(Boolean), html, skipDuplicates: skipDup }, (d, t) => setBusy(Math.max(0.01, d / t)));
          onDone(r);
        }}
      >
        Import {plural(parsed.rows.length, 'row')}
      </button>
    </div>
  );
}
