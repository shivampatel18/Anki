import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { addNote, DEFAULT_DECK_ID, ensureDeck, listNoteTypes, savePreset, presetForDeck } from '../src/data/repo';
import { buildTree, findNode, loadSnapshot, nextCard } from '../src/data/queue';
import { answerCard, undoAnswer } from '../src/data/review';
import { CardState } from '../src/domain/types';
import { MINUTE } from '../src/domain/time';

async function setup(n: number, typeName = 'Basic') {
  const db = await freshDb();
  const nt = (await listNoteTypes()).find((t) => t.name === typeName)!;
  for (let i = 0; i < n; i++) await addNote(nt.id, DEFAULT_DECK_ID, [`q${i}`, `a${i}`], []);
  return db;
}

describe('study session', () => {
  it('limits new cards per day and counts them', async () => {
    await setup(30);
    const snap = await loadSnapshot();
    const node = findNode(buildTree(snap), DEFAULT_DECK_ID)!;
    expect(node.newCount).toBe(20);
    expect(node.reviewCount).toBe(0);
  });

  it('shows new cards in order, learning cards come back, then done', async () => {
    const db = await setup(2);
    const p = await presetForDeck(DEFAULT_DECK_ID);
    await savePreset({ ...p, newPerDay: 2 });
    let t = Date.now();
    const snap = await loadSnapshot(t);
    const first = nextCard(snap, DEFAULT_DECK_ID, t);
    expect(first.kind === 'card' && first.queue).toBe('new');
    const firstCard = first.kind === 'card' ? first.card : undefined!;
    expect((await db.notes.get(firstCard.noteId))!.fields[0]).toBe('q0');

    await answerCard(snap, firstCard.id, 4, 2000, t); // Easy -> review
    const second = nextCard(snap, DEFAULT_DECK_ID, t);
    expect(second.kind).toBe('card');
    const sc = second.kind === 'card' ? second.card : undefined!;
    await answerCard(snap, sc.id, 1, 2000, t); // Again -> 1m step
    // nothing else due; learning card is within learn-ahead so it shows again
    const third = nextCard(snap, DEFAULT_DECK_ID, t + 1000);
    expect(third.kind === 'card' && third.queue).toBe('learn');
    t += 2 * MINUTE;
    await answerCard(snap, sc.id, 4, 2000, t);
    expect(nextCard(snap, DEFAULT_DECK_ID, t).kind).toBe('done');

    const node = findNode(buildTree(snap), DEFAULT_DECK_ID)!;
    expect(node.newCount).toBe(0);
    const fresh = await loadSnapshot(t);
    expect(findNode(buildTree(fresh), DEFAULT_DECK_ID)!.newCount).toBe(0);
    expect(await db.revlog.count()).toBe(3);
  });

  it('buries siblings and undo restores everything', async () => {
    const db = await setup(1, 'Basic (and reversed card)');
    const t = Date.now();
    const snap = await loadSnapshot(t);
    const n = nextCard(snap, DEFAULT_DECK_ID, t);
    if (n.kind !== 'card') throw new Error('expected card');
    const out = await answerCard(snap, n.card.id, 3, 1000, t);
    const sibling = (await db.cards.toArray()).find((c) => c.id !== n.card.id)!;
    expect(sibling.buriedUntil).toBeGreaterThan(0);
    // the learning card is pending; the sibling must not be offered
    const next = nextCard(snap, DEFAULT_DECK_ID, t);
    expect(next.kind === 'card' ? next.card.id : null).toBe(n.card.id);

    await undoAnswer(snap, out.undo);
    const restored = await db.cards.get(n.card.id);
    expect(restored!.state).toBe(CardState.New);
    expect((await db.cards.get(sibling.id))!.buriedUntil).toBe(0);
    expect(await db.revlog.count()).toBe(0);
    expect(findNode(buildTree(snap), DEFAULT_DECK_ID)!.newCount).toBe(2);
  });

  it('subdeck counts roll up into parents', async () => {
    await freshDb();
    const nt = (await listNoteTypes()).find((t) => t.name === 'Basic')!;
    const a = await ensureDeck('Lang::French');
    const b = await ensureDeck('Lang::German');
    for (let i = 0; i < 3; i++) await addNote(nt.id, a.id, [`f${i}`, 'x'], []);
    for (let i = 0; i < 4; i++) await addNote(nt.id, b.id, [`g${i}`, 'x'], []);
    const tree = buildTree(await loadSnapshot());
    const lang = tree.find((r) => r.label === 'Lang')!;
    expect(lang.newCount).toBe(7);
    expect(lang.children.map((c) => c.newCount)).toEqual([3, 4]);
  });

  it('leeches get tagged after repeated lapses', async () => {
    const db = await setup(1);
    const p = await presetForDeck(DEFAULT_DECK_ID);
    await savePreset({ ...p, leechThreshold: 2, relearningSteps: [] });
    let t = Date.now();
    const snap = await loadSnapshot(t);
    const card = (await db.cards.toArray())[0];
    await answerCard(snap, card.id, 4, 1000, t);
    let leech = false;
    for (let i = 0; i < 2; i++) {
      const c = (await db.cards.get(card.id))!;
      t = Math.max(t + 1000, c.due);
      const out = await answerCard(snap, card.id, 1, 1000, t);
      const c2 = (await db.cards.get(card.id))!;
      if (c2.state !== CardState.Review) {
        t = Math.max(t + 1000, c2.due);
        await answerCard(snap, card.id, 3, 1000, t);
      }
      leech ||= out.becameLeech;
    }
    expect(leech).toBe(true);
    expect((await db.notes.toArray())[0].tags).toContain('leech');
  });
});
