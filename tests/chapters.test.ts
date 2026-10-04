import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addNote, ensureDeck, listNoteTypes, setChaptersStarted } from '../src/data/repo';
import { buildTree, findNode, loadSnapshot, nextCard } from '../src/data/queue';
import { answerCard } from '../src/data/review';
import { chapterRange } from '../src/domain/chapters';
import type { Deck } from '../src/domain/types';

const deck = (id: number, name: string): Deck => ({ id, name, presetId: 1, mtime: 0 });

describe('chapter ranges', () => {
  const decks = [
    deck(1, 'Mandarin'),
    deck(2, 'Mandarin::Book 1'),
    deck(3, 'Mandarin::Book 2'),
    deck(4, 'Mandarin::Book 2::Ch 1'),
    deck(5, 'Mandarin::Book 10'),
    deck(6, 'Mandarin::Book 3'),
    deck(7, 'Spanish'),
  ];
  it('orders numerically and stays among siblings under the same parent', () => {
    expect(chapterRange(decks, 6, 'from')).toEqual([6, 5]);
    expect(chapterRange(decks, 3, 'upTo')).toEqual([2, 3, 4]);
    expect(chapterRange(decks, 3, 'only')).toEqual([3, 4]);
    expect(chapterRange(decks, 2, 'from')).toEqual([2, 3, 4, 6, 5]);
  });

  it('never spills into another course nested in the same top-level deck', () => {
    const nested = [
      deck(10, 'Chinese'),
      deck(11, "Chinese::Let's Learn Mandarin"),
      deck(12, "Chinese::Let's Learn Mandarin::Book 5"),
      deck(13, "Chinese::Let's Learn Mandarin::Book 6"),
      deck(14, "Chinese::Let's Learn Mandarin::Book 7"),
      deck(15, 'Chinese::Mandarin Corner'),
      deck(16, 'Chinese::Mandarin Corner::Lesson 1'),
    ];
    expect(chapterRange(nested, 13, 'from')).toEqual([13, 14]);
    expect(chapterRange(nested, 13, 'upTo')).toEqual([12, 13]);
  });
});

describe('not-started chapters', () => {
  async function setup() {
    const db = await freshDb();
    const nt = (await listNoteTypes()).find((t) => t.name === 'Basic')!;
    const ids: number[] = [];
    for (let b = 1; b <= 7; b++) {
      const d = await ensureDeck(`Let's Learn Mandarin::Book ${b}`);
      ids.push(d.id);
      for (let i = 0; i < 3; i++) await addNote(nt.id, d.id, [`b${b} w${i}`, 'x'], []);
    }
    const root = (await db.decks.where('name').equals("Let's Learn Mandarin").first())!;
    return { db, ids, root };
  }

  it('the top deck only offers new words from started chapters', async () => {
    const { ids, root } = await setup();
    expect(await setChaptersStarted(ids[5], 'from', false)).toBe(2); // books 6 and 7
    let tree = buildTree(await loadSnapshot());
    expect(findNode(tree, root.id)!.newCount).toBe(15); // 5 books x 3
    expect(findNode(tree, ids[5])!.newCount).toBe(0);

    // catch-up: start everything up to book 6
    await setChaptersStarted(ids[5], 'upTo', true);
    tree = buildTree(await loadSnapshot());
    expect(findNode(tree, root.id)!.newCount).toBe(18);
    expect(findNode(tree, ids[6])!.newCount).toBe(0);
  });

  it('cards already learned in a not-started chapter still come up for review', async () => {
    const { db, ids, root } = await setup();
    const t = Date.now();
    let snap = await loadSnapshot(t);
    const card = (await db.cards.where('deckId').equals(ids[6]).toArray())[0];
    await answerCard(snap, card.id, 1, 1000, t); // learning, due in 1 minute
    await setChaptersStarted(ids[6], 'only', false);
    snap = await loadSnapshot(t + 2 * 60_000);
    const next = nextCard(snap, root.id, t + 2 * 60_000);
    expect(next.kind === 'card' && next.card.id).toBe(card.id);
    expect(findNode(buildTree(snap), ids[6])!.newCount).toBe(0);
  });
});

import { renameDeck } from '../src/data/repo';
it('nesting a course under a new top deck keeps its books, flags and counts', async () => {
  const db = await freshDb();
  const nt = (await listNoteTypes()).find((t) => t.name === 'Basic')!;
  for (const name of ["Let's Learn Mandarin::Book 1", "Let's Learn Mandarin::Book 2", 'HSK 1']) {
    const d = await ensureDeck(name);
    await addNote(nt.id, d.id, [name, 'x'], []);
  }
  const b2 = (await db.decks.where('name').equals("Let's Learn Mandarin::Book 2").first())!;
  await setChaptersStarted(b2.id, 'only', false);
  const course = (await db.decks.where('name').equals("Let's Learn Mandarin").first())!;
  await renameDeck(course.id, "Chinese::Let's Learn Mandarin");
  const hsk = (await db.decks.where('name').equals('HSK 1').first())!;
  await renameDeck(hsk.id, 'Chinese::HSK 1');
  const names = (await db.decks.toArray()).map((d) => d.name).sort();
  expect(names).toEqual(['Chinese', 'Chinese::HSK 1', "Chinese::Let's Learn Mandarin", "Chinese::Let's Learn Mandarin::Book 1", "Chinese::Let's Learn Mandarin::Book 2", 'Default']);
  expect((await db.decks.get(b2.id))!.notStarted).toBe(true);
  const tree = buildTree(await loadSnapshot());
  const chinese = tree.find((n) => n.label === 'Chinese')!;
  expect(chinese.newCount).toBe(2); // Book 1 + HSK 1; Book 2 not started
});
