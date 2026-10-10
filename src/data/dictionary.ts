// Loads the "My words" dictionary from the collection.
import { db } from './db';
import { buildDictionary, type WordEntry } from '../domain/dictionary';
import type { Card } from '../domain/types';

export async function loadDictionary(): Promise<WordEntry[]> {
  const [notes, noteTypes, cards, decks] = await Promise.all([db.notes.toArray(), db.noteTypes.toArray(), db.cards.toArray(), db.decks.toArray()]);
  const byNote = new Map<number, Card[]>();
  for (const c of cards) {
    const list = byNote.get(c.noteId);
    if (list) list.push(c);
    else byNote.set(c.noteId, [c]);
  }
  return buildDictionary(notes, new Map(noteTypes.map((n) => [n.id, n])), byNote, new Map(decks.map((d) => [d.id, d.name])));
}
