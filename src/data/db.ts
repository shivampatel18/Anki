// IndexedDB schema (Dexie). Everything lives on the device; nothing leaves it.
import Dexie, { type Table } from 'dexie';
import type { Card, Deck, MediaFile, Note, NoteType, Preset, ReviewLogEntry, Settings } from '../domain/types';

export class RecallDB extends Dexie {
  noteTypes!: Table<NoteType, number>;
  decks!: Table<Deck, number>;
  presets!: Table<Preset, number>;
  notes!: Table<Note, number>;
  cards!: Table<Card, number>;
  revlog!: Table<ReviewLogEntry, number>;
  media!: Table<MediaFile, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'recall') {
    super(name);
    this.version(1).stores({
      noteTypes: 'id, name, ankiId',
      decks: 'id, &name',
      presets: 'id, name',
      notes: 'id, &guid, noteTypeId',
      cards: 'id, noteId, deckId, due',
      revlog: 'id, cardId',
      media: 'name',
      settings: 'id',
    });
  }
}

export let db = new RecallDB();

/** Tests swap in a fresh database. */
export function useDatabase(next: RecallDB) {
  db = next;
}

let lastId = 0;
/** Millisecond-timestamp ids, like Anki, guaranteed unique within this session. */
export function newId(): number {
  lastId = Math.max(Date.now(), lastId + 1);
  return lastId;
}

const GUID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
export function newGuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => GUID_CHARS[b % GUID_CHARS.length]).join('');
}
