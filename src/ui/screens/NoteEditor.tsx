import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useLoad } from '../app-state';
import { db } from '../../data/db';
import { addNote, deleteNotes, getSettings, listDecks, listNoteTypes, moveCards, updateNote, updateSettings } from '../../data/repo';
import { addMediaFile } from '../../data/media';
import { cardOrdsForNote, clozeNumbers, renderCard } from '../../domain/template';
import { formatInterval } from '../../domain/time';
import { type Card, CardState, type Note, type NoteType } from '../../domain/types';
import { CardView } from '../components/CardView';
import { DeckSelect, TitleBar, plural } from '../components/common';
import { ConfirmSheet } from '../components/Sheet';

type Props = { mode: 'add'; deckId?: number; asTab?: boolean } | { mode: 'edit'; noteId: number };

export function NoteEditor(props: Props) {
  const { data } = useLoad(async () => {
    const [noteTypes, decks, settings] = await Promise.all([listNoteTypes(), listDecks(), getSettings()]);
    let note: Note | undefined;
    let cards: Card[] = [];
    if (props.mode === 'edit') {
      note = await db.notes.get(props.noteId);
      if (note) cards = (await db.cards.where('noteId').equals(note.id).toArray()).sort((a, b) => a.ord - b.ord);
    }
    return { noteTypes, decks, settings, note, cards };
  }, [props.mode === 'edit' ? props.noteId : -1]);

  if (!data) return <div className="screen" />;
  if (props.mode === 'edit' && !data.note)
    return (
      <div className="screen no-tabs">
        <TitleBar title="Edit note" />
        <p className="muted">This note was deleted.</p>
      </div>
    );
  return <EditorForm key={data.note?.id ?? 'new'} {...props} {...data} />;
}

function EditorForm(
  props: Props & {
    noteTypes: NoteType[];
    decks: Awaited<ReturnType<typeof listDecks>>;
    settings: Awaited<ReturnType<typeof getSettings>>;
    note?: Note;
    cards: Card[];
  },
) {
  const app = useApp();
  const editing = props.mode === 'edit';
  const initialType =
    props.note?.noteTypeId ??
    (props.noteTypes.find((n) => n.id === props.settings.lastNoteTypeId) ?? props.noteTypes.find((n) => n.name === 'Basic') ?? props.noteTypes[0]).id;
  const [noteTypeId, setNoteTypeId] = useState(initialType);
  const nt = props.noteTypes.find((n) => n.id === noteTypeId)!;
  const initialDeck = editing ? (props.cards[0]?.deckId ?? 1) : ((props.mode === 'add' && props.deckId) || props.settings.defaultDeckId);
  const [deckId, setDeckId] = useState(props.decks.some((d) => d.id === initialDeck) ? initialDeck : props.decks[0].id);
  const [fields, setFields] = useState<string[]>(() => props.note?.fields ?? nt.fields.map(() => ''));
  const [tags, setTags] = useState(props.note?.tags.join(' ') ?? '');
  const [error, setError] = useState('');
  const [previewOrd, setPreviewOrd] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = useRef<{ index: number; el: HTMLTextAreaElement } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setFields((f) => nt.fields.map((_, i) => f[i] ?? ''));
  }, [noteTypeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ords = useMemo(() => cardOrdsForNote(nt, fields), [nt, fields]);
  const shownOrd = ords.includes(previewOrd) ? previewOrd : ords[0];
  const rendered = useMemo(() => {
    if (shownOrd === undefined) return null;
    const deck = props.decks.find((d) => d.id === deckId);
    return renderCard({ noteType: nt, fields, tags: tags.split(/\s+/).filter(Boolean), deckName: deck?.name ?? '', cardOrd: shownOrd });
  }, [nt, fields, tags, shownOrd, deckId, props.decks]);

  const setField = (i: number, v: string) => setFields((f) => f.map((x, j) => (j === i ? v : x)));

  const insert = (before: string, after = '', placeholder = '') => {
    const a = active.current ?? (firstField.current ? { index: 0, el: firstField.current } : null);
    if (!a) return;
    const { el, index } = a;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    const sel = el.value.slice(s, e) || placeholder;
    const next = el.value.slice(0, s) + before + sel + after + el.value.slice(e);
    setField(index, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };

  const cloze = () => {
    const nums = fields.flatMap((f) => clozeNumbers(f));
    const n = nums.length ? Math.max(...nums) + 1 : 1;
    insert(`{{c${n}::`, '}}', 'answer');
  };

  const pickMedia = async (file: File | undefined, kind: 'image' | 'audio') => {
    if (!file) return;
    const name = await addMediaFile(file);
    if (kind === 'image') insert(`<img src="${name}">`);
    else insert(`[sound:${name}]`);
  };

  const save = async () => {
    setError('');
    try {
      const tagList = tags.split(/\s+/).filter(Boolean);
      if (editing) {
        await updateNote({ ...props.note!, fields, tags: tagList });
        const moving = props.cards.filter((c) => c.deckId !== deckId).map((c) => c.id);
        if (moving.length) await moveCards(moving, deckId);
        app.toast('Note saved.');
        app.refresh();
        app.back();
      } else {
        const res = await addNote(noteTypeId, deckId, fields, tagList);
        await updateSettings({ lastNoteTypeId: noteTypeId, defaultDeckId: deckId });
        app.toast(`Added ${plural(res.cards.length, 'card')}.`);
        setFields(nt.fields.map(() => ''));
        app.refresh();
        firstField.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const isTab = props.mode === 'add' && props.asTab;
  return (
    <div className={'screen' + (isTab ? '' : ' no-tabs')}>
      {isTab ? <TitleBar large title="Add" /> : <TitleBar title={editing ? 'Edit note' : 'Add cards'} />}

      <div className="btn-row" style={{ marginBottom: 4 }}>
        <label className="field" style={{ flex: '1 1 160px' }}>
          <span>Note type</span>
          <select value={noteTypeId} disabled={editing} onChange={(e) => setNoteTypeId(Number(e.target.value))}>
            {props.noteTypes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}>
          <span>Deck</span>
          <DeckSelect decks={props.decks} value={deckId} onChange={setDeckId} />
        </label>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert('<b>', '</b>')}>
          <b>B</b>
        </button>
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert('<i>', '</i>')}>
          <i>I</i>
        </button>
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => insert('<br>')}>
          Line break
        </button>
        {nt.kind === 'cloze' && (
          <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={cloze}>
            Cloze
          </button>
        )}
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => imageInput.current?.click()}>
          Image
        </button>
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => audioInput.current?.click()}>
          Audio
        </button>
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { pickMedia(e.target.files?.[0], 'image'); e.target.value = ''; }} />
        <input ref={audioInput} type="file" accept="audio/*" hidden onChange={(e) => { pickMedia(e.target.files?.[0], 'audio'); e.target.value = ''; }} />
      </div>

      {nt.fields.map((f, i) => (
        <label className="field" key={f.name}>
          <span>{f.name}</span>
          <textarea
            ref={i === 0 ? firstField : undefined}
            value={fields[i] ?? ''}
            rows={i === 0 ? 3 : 2}
            onFocus={(e) => (active.current = { index: i, el: e.currentTarget })}
            onChange={(e) => setField(i, e.target.value)}
          />
        </label>
      ))}
      <label className="field">
        <span>Tags</span>
        <input type="text" value={tags} placeholder="Separate tags with spaces" autoCapitalize="off" autoCorrect="off" onChange={(e) => setTags(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" onClick={save}>
        {editing ? 'Save note' : ords.length > 1 ? `Add ${ords.length} cards` : 'Add card'}
      </button>

      <h3 className="group-title">Preview</h3>
      {ords.length === 0 ? (
        <p className="muted">{nt.kind === 'cloze' ? 'Add a cloze deletion like {{c1::answer}} to make a card.' : 'Fill in the first field to make a card.'}</p>
      ) : (
        <>
          {ords.length > 1 && (
            <div className="preview-tabs">
              {ords.map((o) => (
                <button key={o} aria-pressed={o === shownOrd} onClick={() => setPreviewOrd(o)}>
                  {nt.kind === 'cloze' ? `Cloze ${o + 1}` : nt.templates[o]?.name}
                </button>
              ))}
            </div>
          )}
          {rendered && (
            <div className="stack">
              <div className="index-card mini-card">
                <div className="index-card-head"><span>Front</span></div>
                <div className="index-card-content"><CardView html={rendered.question} css={rendered.css} /></div>
              </div>
              <div className="index-card mini-card">
                <div className="index-card-head"><span>Back</span></div>
                <div className="index-card-content"><CardView html={rendered.answer} css={rendered.css} /></div>
              </div>
            </div>
          )}
        </>
      )}

      {editing && props.cards.length > 0 && (
        <>
          <h3 className="group-title">Cards</h3>
          <div className="group">
            {props.cards.map((c) => (
              <div key={c.id} className="row-link" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div>{nt.kind === 'cloze' ? `Cloze ${c.ord + 1}` : nt.templates[c.ord]?.name ?? `Card ${c.ord + 1}`}</div>
                  <div className="meta">{describeCard(c)}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn danger wide" onClick={() => setConfirmDelete(true)}>
            Delete note
          </button>
        </>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete this note?"
          body={`Its ${plural(props.cards.length, 'card')} and their progress will be removed. This can’t be undone.`}
          confirm="Delete note"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteNotes([props.note!.id]);
            app.toast('Note deleted.');
            app.refresh();
            app.back();
          }}
        />
      )}
    </div>
  );
}

export function describeCard(c: Card): string {
  const parts: string[] = [];
  if (c.suspended) parts.push('Suspended');
  if (c.state === CardState.New) parts.push('New');
  else {
    const days = (c.due - Date.now()) / 86_400_000;
    parts.push(c.state === CardState.Review ? `Due ${days <= 0 ? 'now' : new Date(c.due).toLocaleDateString()}` : 'Learning');
    if (c.state === CardState.Review) parts.push(`interval ${formatInterval(c.scheduledDays * 86_400_000)}`);
    parts.push(`${plural(c.reps, 'review')}`);
    if (c.lapses) parts.push(plural(c.lapses, 'lapse'));
  }
  return parts.join(', ');
}
