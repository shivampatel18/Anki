import { describe, expect, it } from 'vitest';
import { cardOrdsForNote, clozeNumbers, compareTyped, renderCard, stripHtml } from '../src/domain/template';
import { STOCK_NOTE_TYPES, defaultPreset } from '../src/domain/defaults';
import { compileSearch, type SearchItem } from '../src/domain/search';
import { answer, emptySchedule, preview } from '../src/domain/scheduler';
import { CardState, type Card, type NoteType } from '../src/domain/types';
import { dayNumber, dayStart, formatInterval, DAY, HOUR, MINUTE } from '../src/domain/time';

const nt = (name: string): NoteType => ({ ...STOCK_NOTE_TYPES.find((n) => n.name === name)!, id: 1, mtime: 0 });

describe('templates', () => {
  it('generates cards per Anki rules', () => {
    expect(cardOrdsForNote(nt('Basic'), ['q', 'a'])).toEqual([0]);
    expect(cardOrdsForNote(nt('Basic'), ['', 'a'])).toEqual([]);
    expect(cardOrdsForNote(nt('Basic (and reversed card)'), ['q', 'a'])).toEqual([0, 1]);
    expect(cardOrdsForNote(nt('Basic (optional reversed card)'), ['q', 'a', ''])).toEqual([0]);
    expect(cardOrdsForNote(nt('Basic (optional reversed card)'), ['q', 'a', 'y'])).toEqual([0, 1]);
    expect(cardOrdsForNote(nt('Cloze'), ['{{c1::a}} {{c3::b}}', ''])).toEqual([0, 2]);
    expect(cardOrdsForNote(nt('Basic'), ['<img src="x.png">', ''])).toEqual([0]);
    expect(cardOrdsForNote(nt('Basic'), ['<div><br></div>&nbsp;', 'a'])).toEqual([]);
  });

  it('renders basic front/back with FrontSide', () => {
    const r = renderCard({ noteType: nt('Basic'), fields: ['Capital of France?', 'Paris'], tags: [], deckName: 'Geo', cardOrd: 0 });
    expect(r.question).toBe('Capital of France?');
    expect(r.answer).toContain('Capital of France?');
    expect(r.answer).toContain('<hr id=answer>');
    expect(r.answer).toContain('Paris');
  });

  it('renders conditionals, specials and filters', () => {
    const t: NoteType = { ...nt('Basic'), templates: [{ name: 'C', ord: 0, qfmt: '{{#Back}}has {{text:Back}}{{/Back}}{{^Back}}none{{/Back}} {{Deck}}/{{Subdeck}} {{Card}} {{furigana:Front}}', afmt: '{{hint:Back}}' }] };
    const r = renderCard({ noteType: t, fields: ['漢字[かんじ]', '<b>x</b>'], tags: [], deckName: 'A::B', cardOrd: 0 });
    expect(r.question).toContain('has x');
    expect(r.question).toContain('A::B/B');
    expect(r.question).toContain('C');
    expect(r.question).toContain('<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>');
    expect(r.answer).toContain('Show Back');
  });

  it('handles nested clozes and hints', () => {
    const text = '{{c1::outer {{c2::inner}} part}} and {{c3::x::hint}}';
    expect(clozeNumbers(text)).toEqual([1, 2, 3]);
    const q2 = renderCard({ noteType: nt('Cloze'), fields: [text, ''], tags: [], deckName: '', cardOrd: 1 });
    expect(stripHtml(q2.question)).toBe('outer [...] part and x');
    const q3 = renderCard({ noteType: nt('Cloze'), fields: [text, ''], tags: [], deckName: '', cardOrd: 2 });
    expect(stripHtml(q3.question)).toBe('outer inner part and [hint]');
    const q1 = renderCard({ noteType: nt('Cloze'), fields: [text, ''], tags: [], deckName: '', cardOrd: 0 });
    expect(stripHtml(q1.question)).toBe('[...] and x');
    expect(stripHtml(q1.answer)).toContain('outer inner part and x');
  });

  it('type-in answers render an input and compare', () => {
    const r = renderCard({ noteType: nt('Basic (type in the answer)'), fields: ['Longest river?', 'Nile'], tags: [], deckName: '', cardOrd: 0 }, 'Nlie');
    expect(r.question).toContain('<input id="typeans"');
    expect(r.typeExpected).toBe('Nile');
    expect(r.answer).toContain('typeBad');
    expect(compareTyped('Nile', 'Nile')).toContain('typeGood');
  });
});

describe('search', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const env = { now, todayStart: now - 8 * HOUR, todayEnd: now + 16 * HOUR, today: 1 };
  const base: Card = { id: 1, noteId: 1, deckId: 1, ord: 0, created: now - 10 * DAY, mtime: now, position: 1, ...emptySchedule(now), suspended: false, buriedUntil: 0, flag: 0 };
  const item = (o: Partial<Card>, fields = ['Capital of <b>France</b>', 'Paris'], tags = ['geo::europe'], deck = 'Geography::Europe'): SearchItem => ({
    card: { ...base, ...o },
    note: { id: 1, guid: 'g', noteTypeId: 1, fields, tags, created: now, mtime: now },
    noteType: nt('Basic'),
    deckName: deck,
  });
  const m = (q: string, it: SearchItem) => compileSearch(q)(it, env);

  it('matches text, fields, tags and decks', () => {
    const it1 = item({});
    expect(m('france', it1)).toBe(true);
    expect(m('"capital of france"', it1)).toBe(true);
    expect(m('fran*', it1)).toBe(true);
    expect(m('germany', it1)).toBe(false);
    expect(m('back:paris', it1)).toBe(true);
    expect(m('back:par', it1)).toBe(false);
    expect(m('back:par*', it1)).toBe(true);
    expect(m('tag:geo', it1)).toBe(true);
    expect(m('tag:europe', it1)).toBe(false);
    expect(m('deck:Geography', it1)).toBe(true);
    expect(m('deck:Geo', it1)).toBe(false);
    expect(m('-tag:geo', it1)).toBe(false);
    expect(m('germany or france', it1)).toBe(true);
    expect(m('(germany or spain) france', it1)).toBe(false);
    expect(m('note:Basic card:1', it1)).toBe(true);
  });

  it('matches state and properties', () => {
    expect(m('is:new', item({}))).toBe(true);
    expect(m('is:suspended', item({ suspended: true }))).toBe(true);
    const rev = item({ state: CardState.Review, scheduledDays: 40, due: now - HOUR, lastReview: now - 40 * DAY });
    expect(m('is:due', rev)).toBe(true);
    expect(m('is:review prop:ivl>=30', rev)).toBe(true);
    expect(m('prop:ivl<30', rev)).toBe(false);
    expect(m('flag:1', item({ flag: 1 }))).toBe(true);
    expect(m('added:1', item({}))).toBe(false);
    expect(m('added:30', item({}))).toBe(true);
  });
});

describe('scheduler', () => {
  const preset = defaultPreset(1);
  const now = Date.UTC(2026, 9, 1, 12);
  const card: Card = { id: 1, noteId: 1, deckId: 1, ord: 0, created: now, mtime: now, position: 1, ...emptySchedule(now), suspended: false, buriedUntil: 0, flag: 0 };

  it('follows learning steps then graduates', () => {
    const p = preview(card, preset, now);
    expect(p[0].delay).toBe(1 * MINUTE); // Again = first step
    expect(p[2].delay).toBe(10 * MINUTE); // Good = second step
    expect(p[3].delay).toBeGreaterThanOrEqual(DAY); // Easy graduates
    const a = answer(card, 3, preset, now, 4000);
    expect(a.card.state).toBe(CardState.Learning);
    const b = answer(a.card, 3, preset, now + 10 * MINUTE, 3000);
    expect(b.card.state).toBe(CardState.Review);
    expect(b.card.due - (now + 10 * MINUTE)).toBeGreaterThanOrEqual(DAY);
    expect(b.log.kind).toBe('learn');
  });

  it('a lapse goes to relearning and counts', () => {
    let c = answer(card, 4, preset, now, 1000).card;
    const t = c.due;
    const r = answer(c, 1, preset, t, 1000);
    expect(r.lapsed).toBe(true);
    expect(r.card.state).toBe(CardState.Relearning);
    expect(r.card.lapses).toBe(1);
    expect(r.log.kind).toBe('review');
  });

  it('higher retention gives shorter intervals', () => {
    const c = answer(card, 4, preset, now, 1000).card;
    const lo = preview(c, { ...preset, desiredRetention: 0.8, enableFuzz: false }, c.due)[2].delay;
    const hi = preview(c, { ...preset, desiredRetention: 0.95, enableFuzz: false }, c.due)[2].delay;
    expect(hi).toBeLessThan(lo);
  });
});

describe('time', () => {
  it('rolls the day at the start hour', () => {
    const at3am = new Date(2026, 9, 2, 3, 0).getTime();
    const at5am = new Date(2026, 9, 2, 5, 0).getTime();
    expect(dayStart(at3am, 4)).toBe(new Date(2026, 9, 1, 4).getTime());
    expect(dayNumber(at5am, 4) - dayNumber(at3am, 4)).toBe(1);
  });
  it('formats intervals', () => {
    expect(formatInterval(MINUTE)).toBe('1m');
    expect(formatInterval(10 * MINUTE)).toBe('10m');
    expect(formatInterval(3 * DAY)).toBe('3d');
    expect(formatInterval(75 * DAY)).toBe('2.5mo');
    expect(formatInterval(400 * DAY)).toBe('1.1y');
  });
});

import { displayText } from '../src/domain/template';
it('displayText strips cloze markup for lists', () => {
  expect(displayText('The capital of {{c1::Australia}} is {{c2::Canberra::city}}.')).toBe('The capital of Australia is Canberra.');
});

import { mediaRefs } from '../src/domain/template';
it('finds media with spaces in names', () => {
  expect(mediaRefs('<img src="red square.png"> <img src=a.jpg> [sound:x y.mp3]').sort()).toEqual(['a.jpg', 'red square.png', 'x y.mp3']);
});
