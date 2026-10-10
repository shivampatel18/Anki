import { describe, expect, it } from 'vitest';
import { buildDictionary, isPinyin, parseNote, pinyinKey, searchDictionary } from '../src/domain/dictionary';
import { STOCK_NOTE_TYPES } from '../src/domain/defaults';
import { CardState, type Card, type Note, type NoteType } from '../src/domain/types';

const vocabType: NoteType = {
  id: 10, name: 'Mandarin vocab', kind: 'normal', css: '', sortField: 0, mtime: 0,
  fields: ['Simplified', 'Pinyin', 'Meaning', 'Traditional', 'Lesson', 'Source', 'Book ref', 'Hint'].map((name, ord) => ({ name, ord })),
  templates: [{ name: 'Card 1', ord: 0, qfmt: '{{Simplified}}', afmt: '{{Pinyin}}' }],
};
const basic: NoteType = { ...STOCK_NOTE_TYPES.find((n) => n.name === 'Basic')!, id: 11, mtime: 0 };
let nid = 1;
const note = (nt: NoteType, fields: string[]): Note => ({ id: nid++, guid: String(nid), noteTypeId: nt.id, fields, tags: [], created: 0, mtime: 0 });
const card = (noteId: number, o: Partial<Card> = {}): Card => ({
  id: noteId * 10, noteId, deckId: 1, ord: 0, created: 0, mtime: 0, position: 0, state: CardState.New, due: 0, stability: 0, difficulty: 0,
  scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, suspended: false, buriedUntil: 0, flag: 0, ...o,
});

describe('parsing notes', () => {
  it('reads named fields', () => {
    const p = parseNote(note(vocabType, ['请问', 'qǐng wèn', 'May I ask you…', '請問', '1', 'textbook', '1-11', '']), vocabType)!;
    expect(p).toEqual({ word: '请问', pinyin: 'qǐng wèn', meaning: 'May I ask you…', traditional: '請問' });
  });
  it('reads a Basic note with a combined back', () => {
    const p = parseNote(note(basic, ['<div>你好</div>', 'nǐ hǎo<br>hello<br>你好']), basic)!;
    expect(p.word).toBe('你好');
    expect(p.pinyin).toBe('nǐ hǎo');
    expect(p.meaning).toBe('hello');
    const q = parseNote(note(basic, ['谢谢', 'xie4 xie5<br>thank you<br>謝謝']), basic)!;
    expect(q).toEqual({ word: '谢谢', pinyin: 'xie4 xie5', meaning: 'thank you', traditional: '謝謝' });
  });
  it('ignores notes without Chinese', () => {
    expect(parseNote(note(basic, ['Capital of France?', 'Paris']), basic)).toBeNull();
  });
  it('recognises pinyin', () => {
    expect(isPinyin('nǐ hǎo')).toBe(true);
    expect(isPinyin('ni3 hao3')).toBe(true);
    expect(isPinyin('hello')).toBe(false);
    expect(pinyinKey('Nǚ’ér')).toBe('nuer');
    expect(pinyinKey('ni3 hao3')).toBe('nihao');
  });
});

describe('dictionary', () => {
  const n1 = note(vocabType, ['家', 'jiā', 'house, home, family', '家', '6', 'textbook', '6-15', '']);
  const n2 = note(vocabType, ['家', 'jiā', 'measure word for restaurant, shop', '家', '9', 'textbook', '9-15', '']);
  const n3 = note(vocabType, ['你好', 'nǐ hǎo', 'hello', '你好', '1', 'textbook', '', '']);
  const n4 = note(vocabType, ['贵姓？', 'guì xìng', 'Polite way to ask someone’s surname', '貴姓？', '1', 'textbook', '', '']);
  const n5 = note(vocabType, ['跑步', 'pǎo bù', 'to run, to jog', '跑步', '6', 'textbook', '', '']);
  const n6 = note(vocabType, ['女儿', "nǚ'ér", 'daughter', '女兒', '3', 'textbook', '', '']);
  const n7 = note(vocabType, ['你好', 'nǐ hǎo', 'hello', '你好', '1', 'duolingo', '', '']); // same word, other deck
  const notes = [n1, n2, n3, n4, n5, n6, n7];
  const cards = new Map(notes.map((n) => [n.id, [card(n.id)]]));
  cards.set(n3.id, [card(n3.id, { state: CardState.Review, stability: 40 })]);
  cards.set(n5.id, [card(n5.id, { state: CardState.Learning, stability: 1 })]);
  const dict = buildDictionary(notes, new Map([[vocabType.id, vocabType]]), cards, new Map([[1, 'Chinese::Book 1::Lesson 06']]));
  const words = (q: string) => searchDictionary(dict, q).map((e) => e.word);

  it('merges a word that appears more than once', () => {
    const jia = dict.find((e) => e.word === '家')!;
    expect(jia.senses.map((s) => s.meaning)).toEqual(['house, home, family', 'measure word for restaurant, shop']);
    expect(dict.filter((e) => e.word === '你好')).toHaveLength(1);
    expect(dict.find((e) => e.word === '你好')!.senses).toHaveLength(1);
  });
  it('tracks how well each word is known', () => {
    expect(dict.find((e) => e.word === '你好')!.status).toBe('known');
    expect(dict.find((e) => e.word === '跑步')!.status).toBe('learning');
    expect(dict.find((e) => e.word === '家')!.status).toBe('new');
  });
  it('finds words by pinyin in any spelling', () => {
    expect(words('nihao')[0]).toBe('你好');
    expect(words('ni hao')[0]).toBe('你好');
    expect(words('nǐ hǎo')[0]).toBe('你好');
    expect(words('ni3hao3')[0]).toBe('你好');
    expect(words('nver')[0]).toBe('女儿');
    expect(words('jia')[0]).toBe('家');
  });
  it('finds words by characters, simplified or traditional', () => {
    expect(words('贵姓')[0]).toBe('贵姓？');
    expect(words('貴姓')[0]).toBe('贵姓？');
    expect(words('女兒')[0]).toBe('女儿');
  });
  it('finds words by English', () => {
    expect(words('hello')[0]).toBe('你好');
    expect(words('run')[0]).toBe('跑步');
    expect(words('restaurant')).toContain('家');
    expect(words('zzz')).toEqual([]);
  });
});
