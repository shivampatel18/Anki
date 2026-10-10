// "My words": a dictionary built from the Chinese notes in the collection. Pure.
// Works with any note type: fields are recognised by name first (Simplified, Pinyin, Meaning,
// Traditional...), then by content, so combined backs like "nǐ hǎo<br>hello" still parse.
import { type Card, CardState, type Note, type NoteType } from './types';
import { decodeEntities } from './template';

export interface WordSense {
  noteId: number;
  pinyin: string;
  meaning: string;
  traditional: string;
  /** Deck of the note's first card. */
  deckName: string;
}

export type WordStatus = 'new' | 'learning' | 'known';

export interface WordEntry {
  /** Simplified characters (the dictionary headword). */
  word: string;
  senses: WordSense[];
  status: WordStatus;
  noteIds: number[];
  /** Search keys, precomputed. */
  keys: { pinyin: string[]; meaning: string[]; chars: string[] };
}

const CJK = /[㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/u;
const TONE_MARKS = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const NUMBERED_PINYIN = /^(?:[a-zü:]+[1-5]\s*)+$/i;

/** Field HTML → plain lines (line breaks, divs and paragraphs become separate lines). */
function lines(html: string): string[] {
  const withBreaks = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]*\]/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const text = (html: string) => lines(html).join(' ');

export function isPinyin(s: string): boolean {
  const t = s.trim();
  if (!t || CJK.test(t)) return false;
  return TONE_MARKS.test(t) || NUMBERED_PINYIN.test(t);
}

type Role = 'word' | 'pinyin' | 'meaning' | 'traditional';

const NAME_RULES: [Role, RegExp][] = [
  ['traditional', /tradit|繁/i],
  ['word', /simplif|hanzi|汉字|简|chinese|character|^word$|vocab|expression/i],
  ['pinyin', /pinyin|reading|拼音|romaniz/i],
  ['meaning', /meaning|english|definition|translation|gloss|意思/i],
];

export interface ParsedWord {
  word: string;
  pinyin: string;
  meaning: string;
  traditional: string;
}

/** Pull simplified / pinyin / meaning / traditional out of a note, or null if it isn't a Chinese word. */
export function parseNote(note: Note, noteType: NoteType): ParsedWord | null {
  const out: Partial<Record<Role, string>> = {};
  const leftovers: string[] = [];
  noteType.fields.forEach((f, i) => {
    const value = note.fields[i] ?? '';
    if (!text(value)) return;
    const rule = NAME_RULES.find(([, re]) => re.test(f.name.trim()));
    if (rule && !out[rule[0]]) out[rule[0]] = text(value);
    else leftovers.push(value); // e.g. Front/Back of a Basic note: parsed by content below
  });
  // Content-based fill for anything not named: CJK lines, pinyin lines, other lines.
  for (const value of leftovers) {
    for (const line of lines(value)) {
      if (CJK.test(line)) {
        if (!out.word) out.word = line;
        else if (!out.traditional && line !== out.word) out.traditional = line;
      } else if (isPinyin(line)) {
        out.pinyin ??= line;
      } else if (!out.meaning) {
        out.meaning = line;
      }
    }
  }
  if (!out.word || !CJK.test(out.word)) return null;
  return { word: out.word.trim(), pinyin: out.pinyin ?? '', meaning: out.meaning ?? '', traditional: out.traditional ?? '' };
}

// ---------- normalisation ----------

/** "Nǐ hǎo" / "ni3 hao3" / "nihao" → "nihao"; ü/v → u. */
export function pinyinKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ü|u:|v/g, 'u')
    .replace(/[^a-z]/g, '');
}

function meaningWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 0);
}

/** Strip punctuation from a headword so 贵姓？ and 贵姓 are the same word. */
export function wordKey(s: string): string {
  return s.replace(/[？?！!。，,、\s]/g, '');
}

// ---------- building ----------

export function cardStatus(cards: Card[]): WordStatus {
  if (cards.some((c) => c.state === CardState.Review && c.stability >= 21)) return 'known';
  if (cards.some((c) => c.state !== CardState.New)) return 'learning';
  return 'new';
}

export function buildDictionary(
  notes: Note[],
  noteTypes: Map<number, NoteType>,
  cardsByNote: Map<number, Card[]>,
  deckNames: Map<number, string>,
): WordEntry[] {
  const byWord = new Map<string, { entry: WordEntry; cards: Card[] }>();
  for (const note of notes) {
    const nt = noteTypes.get(note.noteTypeId);
    if (!nt) continue;
    const parsed = parseNote(note, nt);
    if (!parsed) continue;
    const cards = cardsByNote.get(note.id) ?? [];
    const sense: WordSense = {
      noteId: note.id,
      pinyin: parsed.pinyin,
      meaning: parsed.meaning,
      traditional: parsed.traditional,
      deckName: cards[0] ? (deckNames.get(cards[0].deckId) ?? '') : '',
    };
    const key = wordKey(parsed.word) || parsed.word;
    let slot = byWord.get(key);
    if (!slot) {
      slot = { entry: { word: parsed.word, senses: [], status: 'new', noteIds: [], keys: { pinyin: [], meaning: [], chars: [] } }, cards: [] };
      byWord.set(key, slot);
    }
    // the same word imported twice (e.g. from two decks) with the same meaning is one sense
    const dup = slot.entry.senses.find((s) => s.meaning.toLowerCase() === sense.meaning.toLowerCase() && pinyinKey(s.pinyin) === pinyinKey(sense.pinyin));
    if (!dup) slot.entry.senses.push(sense);
    slot.entry.noteIds.push(note.id);
    slot.cards.push(...cards);
  }
  const entries: WordEntry[] = [];
  for (const { entry, cards } of byWord.values()) {
    entry.status = cardStatus(cards);
    entry.keys = {
      pinyin: [...new Set(entry.senses.map((s) => pinyinKey(s.pinyin)).filter(Boolean))],
      meaning: [...new Set(entry.senses.flatMap((s) => meaningWords(s.meaning)))],
      chars: [...new Set([wordKey(entry.word), ...entry.senses.map((s) => wordKey(s.traditional))].filter(Boolean))],
    };
    entries.push(entry);
  }
  return entries.sort(compareEntries);
}

/** Dictionary order: by pinyin (toneless), then characters. */
export function compareEntries(a: WordEntry, b: WordEntry): number {
  const pa = a.keys.pinyin[0] ?? '￿', pb = b.keys.pinyin[0] ?? '￿';
  return pa.localeCompare(pb) || a.word.localeCompare(b.word, 'zh');
}

// ---------- search ----------

/**
 * Search by characters (simplified or traditional), pinyin (with or without tones, tone
 * numbers or spaces) or English. Best matches first.
 */
export function searchDictionary(entries: WordEntry[], query: string): WordEntry[] {
  const q = query.trim();
  if (!q) return entries;
  const scored: { e: WordEntry; score: number }[] = [];
  if (CJK.test(q)) {
    const k = wordKey(q);
    for (const e of entries) {
      let score = 0;
      for (const c of e.keys.chars) {
        if (c === k) score = Math.max(score, 100);
        else if (c.startsWith(k)) score = Math.max(score, 60);
        else if (c.includes(k)) score = Math.max(score, 40);
      }
      if (score) scored.push({ e, score: score - e.word.length * 0.01 });
    }
  } else {
    const pk = pinyinKey(q);
    const words = meaningWords(q);
    const phrase = q.toLowerCase();
    for (const e of entries) {
      let score = 0;
      for (const p of e.keys.pinyin) {
        if (!pk) break;
        if (p === pk) score = Math.max(score, 100);
        else if (p.startsWith(pk)) score = Math.max(score, 70);
        else if (pk.length >= 3 && p.includes(pk)) score = Math.max(score, 30);
      }
      if (words.length) {
        const allWords = words.every((w) => e.keys.meaning.some((m) => m === w || m.startsWith(w)));
        if (allWords) {
          const exact = e.senses.some((s) => s.meaning.toLowerCase().replace(/\(.*?\)/g, '').split(/[,;/]/).some((part) => part.trim() === phrase || part.trim() === `to ${phrase}`));
          score = Math.max(score, exact ? 90 : words.every((w) => e.keys.meaning.includes(w)) ? 65 : 45);
        }
      }
      if (score) scored.push({ e, score: score - e.word.length * 0.01 });
    }
  }
  return scored.sort((a, b) => b.score - a.score || compareEntries(a.e, b.e)).map((s) => s.e);
}
