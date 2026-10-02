import { describe, expect, it } from 'vitest';
import { freshDb, fixture, getSql } from './helpers';
import { importPackage } from '../src/import/importer';
import { readPackage } from '../src/import/apkg';
import { CardState } from '../src/domain/types';
import { renderCard } from '../src/domain/template';

describe.each(['modern.apkg', 'legacy.apkg'])('import %s', (file) => {
  it('reads the package structure', async () => {
    const b = await readPackage(fixture(file), await getSql());
    expect(b.notes).toHaveLength(7);
    expect(b.cards).toHaveLength(11);
    expect(b.revlog).toHaveLength(8);
    expect(b.media.map((m) => m.name).sort()).toEqual(['gateau.mp3', 'red square.png']);
    const cloze = b.noteTypes.find((n) => n.name === 'Cloze')!;
    expect(cloze.kind).toBe('cloze');
    expect(cloze.templates[0].qfmt).toBe('{{cloze:Text}}');
    const cfg = b.deckConfigs.find((c) => c.ankiId === 1)!;
    expect(cfg.newPerDay).toBe(20);
    expect(cfg.reviewsPerDay).toBe(200);
    expect(cfg.learnSteps).toEqual(['1m', '10m']);
    expect(cfg.relearnSteps).toEqual(['10m']);
    expect(cfg.desiredRetention).toBeCloseTo(0.9, 5);
    expect(b.decks.map((d) => d.name)).toContain('Languages::French');
  });

  it('imports notes, cards, schedule, history and media', async () => {
    const d = await freshDb();
    const s = await importPackage(fixture(file), await getSql(), { updateExisting: true });
    expect(s.notesAdded).toBe(7);
    expect(s.cardsAdded).toBe(11);
    expect(s.reviewsAdded).toBe(8);
    expect(s.media).toBe(2);
    expect(s.decks.sort()).toEqual(['Geography', 'Languages::French']);

    const cards = await d.cards.toArray();
    const reviews = cards.filter((c) => c.state === CardState.Review);
    expect(reviews).toHaveLength(8);
    for (const c of reviews) {
      expect(c.stability).toBeGreaterThan(1);
      expect(c.difficulty).toBeGreaterThanOrEqual(1);
      expect(c.lastReview).toBeGreaterThan(0);
      expect(c.due).toBeGreaterThan(c.lastReview!);
    }
    expect(cards.filter((c) => c.suspended)).toHaveLength(1);
    const news = cards.filter((c) => c.state === CardState.New);
    expect(new Set(news.map((c) => c.position)).size).toBe(news.length);

    const media = await d.media.get('red square.png');
    expect(media?.size).toBeGreaterThan(50);
    const bytes = new Uint8Array(await media!.blob.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);

    // the imported cloze note renders both cards
    const clozeNt = (await d.noteTypes.toArray()).find((n) => n.kind === 'cloze' && n.ankiId)!;
    expect((await d.noteTypes.toArray()).filter((n) => n.name.startsWith('Basic')).length).toBe(4);
    const note = (await d.notes.toArray()).find((n) => n.noteTypeId === clozeNt.id)!;
    const c2 = renderCard({ noteType: clozeNt, fields: note.fields, tags: note.tags, deckName: 'Geography', cardOrd: 1 });
    expect(c2.question).toContain('[city]');
    expect(c2.question).toContain('Australia');
    expect(c2.answer).toContain('<span class="cloze" data-ordinal="2">Canberra</span>');
  });

  it('re-importing the same file adds nothing', async () => {
    await freshDb();
    const sql = await getSql();
    await importPackage(fixture(file), sql, { updateExisting: true });
    const again = await importPackage(fixture(file), sql, { updateExisting: true });
    expect(again.notesAdded).toBe(0);
    expect(again.cardsAdded).toBe(0);
    expect(again.reviewsAdded).toBe(0);
    expect(again.noteTypesAdded).toBe(0);
  });
});

it('imports a package exported without scheduling as all-new cards', async () => {
  const d = await freshDb();
  const s = await importPackage(fixture('modern-noschedule.apkg'), await getSql(), { updateExisting: true });
  expect(s.cardsAdded).toBe(11);
  const cards = await d.cards.toArray();
  expect(cards.every((c) => c.state === CardState.New)).toBe(true);
});
