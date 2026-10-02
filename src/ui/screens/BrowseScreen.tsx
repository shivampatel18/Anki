import { useEffect, useMemo, useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { db } from '../../data/db';
import { addTags, deleteNotes, forgetCards, getSettings, listDecks, moveCards, removeTags, setDueDays, setFlag, setSuspended } from '../../data/repo';
import { compileSearch, type SearchItem } from '../../domain/search';
import { displayText } from '../../domain/template';
import { dayEnd, dayNumber, dayStart } from '../../domain/time';
import { FLAG_COLORS, FLAG_NAMES, type Note, type NoteType } from '../../domain/types';
import { DeckSelect, TitleBar, plural } from '../components/common';
import { ActionSheet, ConfirmSheet, PromptSheet, Sheet } from '../components/Sheet';
import { describeCard } from './NoteEditor';

type SortKey = 'created' | 'due' | 'interval' | 'field' | 'lapses';
const SORTS: Record<SortKey, string> = { created: 'Newest first', due: 'Due date', interval: 'Interval', field: 'Sort field', lapses: 'Most lapses' };
const QUICK = [
  ['Due today', 'is:due'],
  ['New', 'is:new'],
  ['Suspended', 'is:suspended'],
  ['Flagged', '-flag:0'],
  ['Leeches', 'tag:leech'],
  ['Added today', 'added:1'],
] as const;

type Pending = null | 'move' | 'flag' | 'addTags' | 'removeTags' | 'due' | 'delete' | 'forget' | 'more';

export function BrowseScreen({ initialQuery = '', asTab }: { initialQuery?: string; asTab?: boolean }) {
  const app = useApp();
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [sort, setSort] = useState<SortKey>('created');
  const [limit, setLimit] = useState(150);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [moveTo, setMoveTo] = useState<number>(1);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data } = useLoad(async () => {
    const [cards, notes, noteTypes, decks, settings] = await Promise.all([db.cards.toArray(), db.notes.toArray(), db.noteTypes.toArray(), listDecks(), getSettings()]);
    return { cards, notes: new Map(notes.map((n) => [n.id, n])), noteTypes: new Map(noteTypes.map((n) => [n.id, n])), decks, deckNames: new Map(decks.map((d) => [d.id, d.name])), settings };
  }, []);

  const results = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const env = { now, todayStart: dayStart(now, data.settings.dayStartHour), todayEnd: dayEnd(now, data.settings.dayStartHour), today: dayNumber(now, data.settings.dayStartHour) };
    let pred;
    try {
      pred = compileSearch(debounced);
    } catch {
      return [];
    }
    const out: (SearchItem & { sortText: string })[] = [];
    for (const card of data.cards) {
      const note = data.notes.get(card.noteId) as Note | undefined;
      const noteType = note && (data.noteTypes.get(note.noteTypeId) as NoteType | undefined);
      if (!note || !noteType) continue;
      const it = { card, note, noteType, deckName: data.deckNames.get(card.deckId) ?? '', sortText: '' };
      if (pred(it, env)) out.push(it);
    }
    for (const it of out) it.sortText = displayText(it.note.fields[it.noteType.sortField] ?? it.note.fields[0] ?? '');
    const by: Record<SortKey, (a: (typeof out)[0], b: (typeof out)[0]) => number> = {
      created: (a, b) => b.card.created - a.card.created || a.card.ord - b.card.ord,
      due: (a, b) => (a.card.state === 0 ? Infinity : a.card.due) - (b.card.state === 0 ? Infinity : b.card.due) || a.card.position - b.card.position,
      interval: (a, b) => b.card.scheduledDays - a.card.scheduledDays,
      field: (a, b) => a.sortText.localeCompare(b.sortText, undefined, { numeric: true }),
      lapses: (a, b) => b.card.lapses - a.card.lapses,
    };
    return out.sort(by[sort]);
  }, [data, debounced, sort]);

  const ids = [...selected];
  const noteIds = () => [...new Set(results.filter((r) => selected.has(r.card.id)).map((r) => r.note.id))];
  const done = (msg: string) => {
    app.toast(msg);
    app.refresh();
  };
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className={'screen' + (asTab ? '' : ' no-tabs')}>
      {asTab ? (
        <TitleBar large title="Browse" right={<button className="btn small" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Done' : 'Select'}</button>} />
      ) : (
        <TitleBar title="Browse" right={<button className="btn small" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Done' : 'Select'}</button>} />
      )}
      <div className="searchbar">
        <input type="search" value={query} placeholder="Search cards, e.g. tag:verbs is:due" aria-label="Search" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="chips">
        {QUICK.map(([label, q]) => (
          <button key={q} className="chip" onClick={() => setQuery(query.includes(q) ? query : `${query} ${q}`.trim())}>
            {label}
          </button>
        ))}
      </div>
      <div className="browse-meta">
        <span>{data ? plural(results.length, 'card') : 'Loading…'}</span>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {selecting && (
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button className="btn small" onClick={() => setSelected(new Set(results.slice(0, limit).map((r) => r.card.id)))}>Select shown</button>
          <button className="btn small" onClick={() => setSelected(new Set(results.map((r) => r.card.id)))}>Select all {results.length}</button>
        </div>
      )}
      {results.slice(0, limit).map((r) => (
        <div key={r.card.id} className={'result' + (r.card.suspended ? ' suspended' : '')}>
          <span className="flagbar" style={{ background: r.card.flag ? FLAG_COLORS[r.card.flag] : 'transparent' }} />
          {selecting && <input type="checkbox" checked={selected.has(r.card.id)} onChange={() => toggle(r.card.id)} aria-label={`Select ${r.sortText}`} />}
          <button className="main" onClick={() => (selecting ? toggle(r.card.id) : app.go({ name: 'editNote', noteId: r.note.id }))}>
            <div className="sort">{r.sortText || '(empty)'}</div>
            <div className="sub">
              {r.deckName.split('::').pop()}, {r.noteType.kind === 'cloze' ? `cloze ${r.card.ord + 1}` : (r.noteType.templates[r.card.ord]?.name ?? '').toLowerCase()}, {describeCard(r.card).toLowerCase()}
            </div>
          </button>
        </div>
      ))}
      {results.length > limit && (
        <button className="btn wide" onClick={() => setLimit(limit + 300)}>
          Show more ({results.length - limit} left)
        </button>
      )}
      {data && results.length === 0 && <p className="muted center" style={{ marginTop: 32 }}>No cards match this search.</p>}

      {selecting && selected.size > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Selected cards">
          <button className="btn" onClick={() => setSuspended(ids, true).then(() => done(`Suspended ${plural(ids.length, 'card')}.`))}>Suspend</button>
          <button className="btn" onClick={() => setSuspended(ids, false).then(() => done(`Unsuspended ${plural(ids.length, 'card')}.`))}>Unsuspend</button>
          <button className="btn" onClick={() => { setMoveTo(data?.decks[0]?.id ?? 1); setPending('move'); }}>Move</button>
          <button className="btn" onClick={() => setPending('flag')}>Flag</button>
          <button className="btn" onClick={() => setPending('more')}>More</button>
        </div>
      )}

      {pending === 'more' && (
        <ActionSheet
          title={plural(selected.size, 'card') + ' selected'}
          onClose={() => setPending(null)}
          actions={[
            { label: 'Add tags', run: () => setPending('addTags') },
            { label: 'Remove tags', run: () => setPending('removeTags') },
            { label: 'Set due date', run: () => setPending('due') },
            { label: 'Reset to new', run: () => setPending('forget') },
            { label: 'Delete notes', danger: true, run: () => setPending('delete') },
          ]}
        />
      )}
      {pending === 'flag' && (
        <ActionSheet
          title="Flag cards"
          onClose={() => setPending(null)}
          actions={FLAG_NAMES.map((name, i) => ({ label: i === 0 ? 'No flag' : name, color: FLAG_COLORS[i], run: () => setFlag(ids, i).then(() => done('Flags updated.')) }))}
        />
      )}
      {pending === 'move' && data && (
        <Sheet title={`Move ${plural(ids.length, 'card')}`} onClose={() => setPending(null)}>
          <label className="field">
            <span>Deck</span>
            <DeckSelect decks={data.decks} value={moveTo} onChange={setMoveTo} />
          </label>
          <button className="btn primary wide" onClick={() => moveCards(ids, moveTo).then(() => { setPending(null); done('Cards moved.'); })}>
            Move cards
          </button>
        </Sheet>
      )}
      {pending === 'addTags' && (
        <PromptSheet title="Add tags" label="Tags" hint="Separate tags with spaces." confirm="Add tags" onClose={() => setPending(null)} onSubmit={(v) => addTags(noteIds(), v.split(/\s+/)).then(() => done('Tags added.'))} />
      )}
      {pending === 'removeTags' && (
        <PromptSheet title="Remove tags" label="Tags" hint="Separate tags with spaces." confirm="Remove tags" onClose={() => setPending(null)} onSubmit={(v) => removeTags(noteIds(), v.split(/\s+/)).then(() => done('Tags removed.'))} />
      )}
      {pending === 'due' && (
        <PromptSheet
          title="Set due date"
          label="Days from today"
          initial="0"
          hint="0 = today, 1 = tomorrow. New cards become review cards."
          confirm="Set due date"
          onClose={() => setPending(null)}
          onSubmit={async (v) => {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) throw new Error('Enter a number of days, like 0 or 7.');
            await setDueDays(ids, Math.round(n));
            done('Due dates updated.');
          }}
        />
      )}
      {pending === 'forget' && (
        <ConfirmSheet title="Reset to new?" body={`${plural(ids.length, 'card')} will lose their progress and return to the new queue.`} confirm="Reset cards" danger onClose={() => setPending(null)} onConfirm={() => forgetCards(ids).then(() => done('Cards reset to new.'))} />
      )}
      {pending === 'delete' && (
        <ConfirmSheet
          title="Delete notes?"
          body={`${plural(noteIds().length, 'note')} and all of their cards will be deleted. This can’t be undone.`}
          confirm="Delete notes"
          danger
          onClose={() => setPending(null)}
          onConfirm={() => deleteNotes(noteIds()).then(() => { setSelected(new Set()); done('Notes deleted.'); })}
        />
      )}
    </div>
  );
}
