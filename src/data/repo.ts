// Collection operations: decks, presets, note types, notes and cards.
import { db, newGuid, newId } from './db';
import { defaultPreset, STOCK_NOTE_TYPES } from '../domain/defaults';
import { cardOrdsForNote } from '../domain/template';
import { emptySchedule, resetCard, setDue } from '../domain/scheduler';
import { dayNumber } from '../domain/time';
import type { Card, Deck, Note, NoteType, Preset, Settings } from '../domain/types';

export const DEFAULT_DECK_ID = 1;
export const DEFAULT_PRESET_ID = 1;

// ---------- setup & settings ----------

export async function ensureInitialized(): Promise<void> {
  await db.transaction('rw', [db.settings, db.presets, db.decks, db.noteTypes], async () => {
    if (await db.settings.get('settings')) return;
    const now = Date.now();
    await db.presets.put(defaultPreset(DEFAULT_PRESET_ID));
    await db.decks.put({ id: DEFAULT_DECK_ID, name: 'Default', presetId: DEFAULT_PRESET_ID, mtime: now });
    let id = now;
    for (const nt of STOCK_NOTE_TYPES) await db.noteTypes.put({ ...nt, id: id++, mtime: now });
    await db.settings.put({
      id: 'settings',
      dayStartHour: 4,
      theme: 'system',
      learnAheadMinutes: 20,
      defaultDeckId: DEFAULT_DECK_ID,
      nextPosition: 1,
    });
  });
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  if (!s) throw new Error('Collection not initialized');
  return s;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = { ...(await getSettings()), ...patch };
  await db.settings.put(s);
  return s;
}

/** Reserve `count` consecutive new-card positions. */
export async function reservePositions(count: number): Promise<number> {
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const start = s.nextPosition;
    await db.settings.put({ ...s, nextPosition: start + count });
    return start;
  });
}

export async function today(now = Date.now()): Promise<number> {
  const s = await getSettings();
  return dayNumber(now, s.dayStartHour);
}

// ---------- decks ----------

export async function listDecks(): Promise<Deck[]> {
  const decks = await db.decks.toArray();
  return decks.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

export function normalizeDeckName(name: string): string {
  return name
    .split('::')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('::');
}

/** Get or create a deck by full path, creating missing parents. */
export async function ensureDeck(name: string, presetId?: number): Promise<Deck> {
  const clean = normalizeDeckName(name) || 'Default';
  const parts = clean.split('::');
  let deck: Deck | undefined;
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('::');
    deck = await db.decks.where('name').equalsIgnoreCase(path).first();
    if (!deck) {
      const parentPreset = i > 1 ? (await db.decks.where('name').equalsIgnoreCase(parts.slice(0, i - 1).join('::')).first())?.presetId : undefined;
      deck = { id: newId(), name: path, presetId: presetId ?? parentPreset ?? DEFAULT_PRESET_ID, mtime: Date.now() };
      await db.decks.add(deck);
    }
  }
  return deck!;
}

/** Ids of a deck and all of its subdecks. */
export async function deckAndChildrenIds(deckId: number): Promise<number[]> {
  const deck = await db.decks.get(deckId);
  if (!deck) return [];
  const prefix = deck.name.toLowerCase() + '::';
  const all = await db.decks.toArray();
  return all.filter((d) => d.id === deckId || d.name.toLowerCase().startsWith(prefix)).map((d) => d.id);
}

export async function renameDeck(deckId: number, newName: string): Promise<void> {
  const clean = normalizeDeckName(newName);
  if (!clean) throw new Error('Deck name can’t be empty.');
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(deckId);
    if (!deck) return;
    const clash = await db.decks.where('name').equalsIgnoreCase(clean).first();
    if (clash && clash.id !== deckId) throw new Error(`A deck named “${clean}” already exists.`);
    const oldPrefix = deck.name + '::';
    const all = await db.decks.toArray();
    for (const d of all) {
      if (d.id === deckId) await db.decks.update(d.id, { name: clean, mtime: Date.now() });
      else if (d.name.startsWith(oldPrefix)) await db.decks.update(d.id, { name: clean + '::' + d.name.slice(oldPrefix.length), mtime: Date.now() });
    }
  });
  // make sure parents exist
  const parts = clean.split('::');
  if (parts.length > 1) await ensureDeck(parts.slice(0, -1).join('::'));
}

/** Delete a deck, its subdecks and their cards. Notes left without cards are deleted too. */
export async function deleteDeck(deckId: number): Promise<number> {
  if (deckId === DEFAULT_DECK_ID) throw new Error('The Default deck can’t be deleted.');
  const ids = await deckAndChildrenIds(deckId);
  let removed = 0;
  await db.transaction('rw', [db.decks, db.cards, db.notes], async () => {
    const cards = await db.cards.where('deckId').anyOf(ids).toArray();
    removed = cards.length;
    await db.cards.bulkDelete(cards.map((c) => c.id));
    const noteIds = [...new Set(cards.map((c) => c.noteId))];
    for (const nid of noteIds) if ((await db.cards.where('noteId').equals(nid).count()) === 0) await db.notes.delete(nid);
    await db.decks.bulkDelete(ids);
  });
  return removed;
}

// ---------- presets ----------

export const listPresets = () => db.presets.toArray();

export async function presetForDeck(deckId: number): Promise<Preset> {
  const deck = await db.decks.get(deckId);
  return (await db.presets.get(deck?.presetId ?? DEFAULT_PRESET_ID)) ?? (await db.presets.get(DEFAULT_PRESET_ID))!;
}

export async function savePreset(p: Preset): Promise<void> {
  await db.presets.put({ ...p, mtime: Date.now() });
}

export async function createPreset(name: string, from?: Preset): Promise<Preset> {
  const p: Preset = from ? { ...from, id: newId(), name, mtime: Date.now() } : defaultPreset(newId(), name);
  await db.presets.add(p);
  return p;
}

export async function deletePreset(id: number): Promise<void> {
  if (id === DEFAULT_PRESET_ID) throw new Error('The Default preset can’t be deleted.');
  await db.transaction('rw', [db.presets, db.decks], async () => {
    await db.decks.filter((d) => d.presetId === id).modify({ presetId: DEFAULT_PRESET_ID });
    await db.presets.delete(id);
  });
}

// ---------- note types ----------

export async function listNoteTypes(): Promise<NoteType[]> {
  return (await db.noteTypes.toArray()).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- notes & cards ----------

export function newCard(noteId: number, deckId: number, ord: number, position: number, now: number): Card {
  return {
    id: newId(),
    noteId,
    deckId,
    ord,
    created: now,
    mtime: now,
    position,
    ...emptySchedule(now),
    suspended: false,
    buriedUntil: 0,
    flag: 0,
  };
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags.flatMap((x) => x.split(/\s+/))) {
    const tag = t.trim();
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()];
}

export interface AddNoteResult {
  note: Note;
  cards: Card[];
}

export async function addNote(noteTypeId: number, deckId: number, fields: string[], tags: string[]): Promise<AddNoteResult> {
  const nt = await db.noteTypes.get(noteTypeId);
  if (!nt) throw new Error('Note type not found.');
  const ords = cardOrdsForNote(nt, fields);
  if (!ords.length)
    throw new Error(nt.kind === 'cloze' ? 'Add at least one cloze deletion, like {{c1::answer}}.' : 'The front of the card is empty. Fill in the first field.');
  const now = Date.now();
  const note: Note = { id: newId(), guid: newGuid(), noteTypeId, fields, tags: normalizeTags(tags), created: now, mtime: now };
  const pos = await reservePositions(1);
  const cards = ords.map((ord) => newCard(note.id, deckId, ord, pos, now));
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.notes.add(note);
    await db.cards.bulkAdd(cards);
  });
  return { note, cards };
}

/** Save edits to a note; generates any cards its new content now calls for. */
export async function updateNote(note: Note, deckIdForNewCards?: number): Promise<Card[]> {
  const nt = await db.noteTypes.get(note.noteTypeId);
  if (!nt) throw new Error('Note type not found.');
  const now = Date.now();
  const existing = await db.cards.where('noteId').equals(note.id).toArray();
  const have = new Set(existing.map((c) => c.ord));
  const wanted = cardOrdsForNote(nt, note.fields).filter((o) => !have.has(o));
  const deckId = deckIdForNewCards ?? existing[0]?.deckId ?? DEFAULT_DECK_ID;
  const pos = wanted.length ? await reservePositions(1) : 0;
  const added = wanted.map((ord) => newCard(note.id, deckId, ord, pos, now));
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.notes.put({ ...note, tags: normalizeTags(note.tags), mtime: now });
    if (added.length) await db.cards.bulkAdd(added);
  });
  return added;
}

export async function deleteNotes(noteIds: number[]): Promise<void> {
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.cards.where('noteId').anyOf(noteIds).delete();
    await db.notes.bulkDelete(noteIds);
  });
}

export async function deleteCards(cardIds: number[]): Promise<void> {
  await db.transaction('rw', [db.notes, db.cards], async () => {
    const cards = (await db.cards.bulkGet(cardIds)).filter(Boolean) as Card[];
    await db.cards.bulkDelete(cardIds);
    for (const nid of new Set(cards.map((c) => c.noteId)))
      if ((await db.cards.where('noteId').equals(nid).count()) === 0) await db.notes.delete(nid);
  });
}

async function modifyCards(cardIds: number[], fn: (c: Card) => Card): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const cards = (await db.cards.bulkGet(cardIds)).filter(Boolean) as Card[];
    await db.cards.bulkPut(cards.map(fn));
  });
}

export const setSuspended = (ids: number[], suspended: boolean) =>
  modifyCards(ids, (c) => ({ ...c, suspended, mtime: Date.now() }));

export const setFlag = (ids: number[], flag: number) => modifyCards(ids, (c) => ({ ...c, flag, mtime: Date.now() }));

export const moveCards = (ids: number[], deckId: number) => modifyCards(ids, (c) => ({ ...c, deckId, mtime: Date.now() }));

export async function buryCards(ids: number[]): Promise<void> {
  const t = await today();
  await modifyCards(ids, (c) => ({ ...c, buriedUntil: t + 1, mtime: Date.now() }));
}

export const unburyCards = (ids: number[]) => modifyCards(ids, (c) => ({ ...c, buriedUntil: 0, mtime: Date.now() }));

export async function forgetCards(ids: number[]): Promise<void> {
  const start = await reservePositions(ids.length);
  let i = 0;
  const now = Date.now();
  await modifyCards(ids, (c) => resetCard(c, now, start + i++));
}

export async function setDueDays(ids: number[], days: number): Promise<void> {
  const now = Date.now();
  await modifyCards(ids, (c) => setDue(c, now + days * 86_400_000, now));
}

export async function addTags(noteIds: number[], tags: string[]): Promise<void> {
  await db.transaction('rw', db.notes, async () => {
    const notes = (await db.notes.bulkGet(noteIds)).filter(Boolean) as Note[];
    await db.notes.bulkPut(notes.map((n) => ({ ...n, tags: normalizeTags([...n.tags, ...tags]), mtime: Date.now() })));
  });
}

export async function removeTags(noteIds: number[], tags: string[]): Promise<void> {
  const drop = new Set(tags.map((t) => t.toLowerCase()));
  await db.transaction('rw', db.notes, async () => {
    const notes = (await db.notes.bulkGet(noteIds)).filter(Boolean) as Note[];
    await db.notes.bulkPut(notes.map((n) => ({ ...n, tags: n.tags.filter((t) => !drop.has(t.toLowerCase())), mtime: Date.now() })));
  });
}

export async function collectionCounts(): Promise<{ notes: number; cards: number; decks: number; media: number }> {
  const [notes, cards, decks, media] = await Promise.all([db.notes.count(), db.cards.count(), db.decks.count(), db.media.count()]);
  return { notes, cards, decks, media };
}
