import { useEffect, useMemo, useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { loadDictionary } from '../../data/dictionary';
import { searchDictionary, type WordEntry, type WordStatus } from '../../domain/dictionary';
import { TitleBar, plural } from '../components/common';
import { Sheet } from '../components/Sheet';

const STATUS_LABEL: Record<WordStatus, string> = { known: 'Known', learning: 'Learning', new: 'New' };
const FILTERS: { key: 'all' | WordStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'known', label: 'Known' },
  { key: 'learning', label: 'Learning' },
  { key: 'new', label: 'New' },
];

/** First letter of the toneless pinyin, for section headers. */
function initial(e: WordEntry): string {
  const k = e.keys.pinyin[0];
  return k ? k[0].toUpperCase() : '#';
}

export function DictionaryScreen() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<'all' | WordStatus>('all');
  const [deck, setDeck] = useState('');
  const [limit, setLimit] = useState(150);
  const [open, setOpen] = useState<WordEntry | null>(null);
  const { data: entries } = useLoad(loadDictionary, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(t);
  }, [query]);
  useEffect(() => setLimit(150), [debounced, filter, deck]);

  // decks that contain words, as filter options (top two levels keep the list short)
  const deckOptions = useMemo(() => {
    const names = new Set<string>();
    for (const e of entries ?? []) for (const s of e.senses) {
      const parts = s.deckName.split('::');
      for (let i = 1; i <= Math.min(parts.length, 3); i++) names.add(parts.slice(0, i).join('::'));
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [entries]);

  const results = useMemo(() => {
    let list = entries ?? [];
    if (deck) list = list.filter((e) => e.senses.some((s) => s.deckName === deck || s.deckName.startsWith(deck + '::')));
    if (filter !== 'all') list = list.filter((e) => e.status === filter);
    return searchDictionary(list, debounced);
  }, [entries, debounced, filter, deck]);

  const browsing = !debounced.trim();
  const shown = results.slice(0, limit);

  return (
    <div className="screen">
      <TitleBar large title="Dictionary" />
      <p className="today-line">{entries ? `${plural(entries.length, 'word')} from your cards` : 'Loading…'}</p>
      <div className="searchbar">
        <input
          type="search"
          value={query}
          placeholder="Search 你好, nihao or hello"
          aria-label="Search your words"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="dict-filters">
        <div className="chips" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {deckOptions.length > 1 && (
          <select value={deck} onChange={(e) => setDeck(e.target.value)} aria-label="Deck">
            <option value="">All decks</option>
            {deckOptions.map((d) => (
              <option key={d} value={d}>
                {' '.repeat(d.split('::').length - 1) + d.split('::').pop()}
              </option>
            ))}
          </select>
        )}
      </div>

      {entries && entries.length === 0 && (
        <div className="empty">
          <h2>No Chinese words yet</h2>
          <p>Words show up here as soon as you import or add cards with Chinese characters.</p>
        </div>
      )}
      {entries && entries.length > 0 && results.length === 0 && <p className="muted center" style={{ marginTop: 32 }}>No words match.</p>}

      <div className="dict-list">
        {shown.map((e, i) => (
          <div key={e.word}>
            {browsing && (i === 0 || initial(shown[i - 1]) !== initial(e)) && <h3 className="dict-letter">{initial(e)}</h3>}
            <button className="dict-row" onClick={() => setOpen(e)}>
              <span className="dict-hanzi" lang="zh-CN">{e.word}</span>
              <span className="dict-text">
                <span className="dict-pinyin">{[...new Set(e.senses.map((s) => s.pinyin).filter(Boolean))].join(' / ')}</span>
                <span className="dict-meaning">{e.senses.map((s) => s.meaning).filter(Boolean).join('; ')}</span>
              </span>
              <span className={`dict-status ${e.status}`}>{STATUS_LABEL[e.status]}</span>
            </button>
          </div>
        ))}
      </div>
      {results.length > limit && (
        <button className="btn wide" style={{ marginTop: 12 }} onClick={() => setLimit(limit + 300)}>
          Show more ({results.length - limit} left)
        </button>
      )}

      {open && (
        <Sheet onClose={() => setOpen(null)}>
          <div className="dict-detail">
            <div className="dict-detail-hanzi" lang="zh-CN">{open.word}</div>
            {open.senses.map((s) => (
              <div key={s.noteId} className="dict-sense">
                {s.pinyin && <div className="dict-pinyin big">{s.pinyin}</div>}
                {s.meaning && <div className="dict-sense-meaning">{s.meaning}</div>}
                {s.traditional && s.traditional !== open.word && (
                  <div className="dict-trad">
                    <span className="muted">Traditional</span> <span lang="zh-TW">{s.traditional}</span>
                  </div>
                )}
                {s.deckName && <div className="hint">{s.deckName.split('::').join(' › ')}</div>}
                <button
                  className="btn small"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setOpen(null);
                    app.go({ name: 'editNote', noteId: s.noteId });
                  }}
                >
                  Open card
                </button>
              </div>
            ))}
            <p className={`dict-status-line ${open.status}`}>
              {open.status === 'known' ? 'You know this word well.' : open.status === 'learning' ? 'You’re still learning this word.' : 'You haven’t studied this word yet.'}
            </p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
