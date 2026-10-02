// Anki-style search: free text, "phrases", -negation, or, (groups), and key:value filters.
import { type Card, CardState, type Note, type NoteType } from './types';
import { stripHtml } from './template';
import { DAY } from './time';

export interface SearchItem {
  card: Card;
  note: Note;
  noteType: NoteType;
  deckName: string;
}

export interface SearchEnv {
  now: number;
  todayStart: number;
  todayEnd: number;
  today: number; // study day number
}

export type Predicate = (it: SearchItem, env: SearchEnv) => boolean;

type Tok = { k: 'word'; v: string; quoted: boolean } | { k: '(' } | { k: ')' } | { k: '-' };

function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ k: c }); i++; continue; }
    if (c === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { out.push({ k: '-' }); i++; continue; }
    // word, possibly with quoted segments: tag:"a b" or "a b"
    let v = '';
    let quoted = false;
    while (i < q.length && !/\s/.test(q[i]) && q[i] !== ')' && !(q[i] === '(' && v === '')) {
      if (q[i] === '"') {
        quoted = true;
        i++;
        while (i < q.length && q[i] !== '"') {
          if (q[i] === '\\' && i + 1 < q.length) i++;
          v += q[i++];
        }
        i++;
      } else {
        if (q[i] === '\\' && i + 1 < q.length) { v += q[i + 1]; i += 2; continue; }
        v += q[i++];
      }
    }
    out.push({ k: 'word', v, quoted });
  }
  return out;
}

/** Glob with * and _ to a case-insensitive RegExp. */
export function globToRegex(glob: string, whole: boolean): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.');
  return new RegExp(whole ? `^${esc}$` : esc, 'is');
}

const textCache = new WeakMap<Note, string>();
function noteText(n: Note): string {
  let t = textCache.get(n);
  if (t === undefined) {
    t = n.fields.map(stripHtml).join('\u001f');
    textCache.set(n, t);
  }
  return t;
}

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return Math.abs(a - b) < 1e-9;
  }
}

function termPredicate(word: string, quoted: boolean): Predicate {
  const colon = quoted ? -1 : word.indexOf(':');
  if (colon > 0) {
    const key = word.slice(0, colon).toLowerCase();
    const val = word.slice(colon + 1);
    const lv = val.toLowerCase();
    switch (key) {
      case 'deck': {
        const re = globToRegex(val, true);
        const sub = globToRegex(`${val}::*`, true);
        return (it) => re.test(it.deckName) || sub.test(it.deckName);
      }
      case 'tag': {
        if (lv === 'none') return (it) => it.note.tags.length === 0;
        const re = globToRegex(val, true);
        const sub = globToRegex(`${val}::*`, true);
        return (it) => it.note.tags.some((t) => re.test(t) || sub.test(t));
      }
      case 'note': {
        const re = globToRegex(val, true);
        return (it) => re.test(it.noteType.name);
      }
      case 'card': {
        if (/^\d+$/.test(val)) return (it) => it.card.ord === Number(val) - 1;
        const re = globToRegex(val, true);
        return (it) => it.noteType.kind === 'normal' && re.test(it.noteType.templates[it.card.ord]?.name ?? '');
      }
      case 'is':
        switch (lv) {
          case 'new': return (it) => it.card.state === CardState.New;
          case 'learn': return (it) => it.card.state === CardState.Learning || it.card.state === CardState.Relearning;
          case 'review': return (it) => it.card.state === CardState.Review || it.card.state === CardState.Relearning;
          case 'due': return (it, env) => it.card.state !== CardState.New && it.card.due < env.todayEnd;
          case 'suspended': return (it) => it.card.suspended;
          case 'buried': return (it, env) => it.card.buriedUntil > env.today;
          case 'leech': return (it) => it.note.tags.some((t) => t.toLowerCase() === 'leech');
          default: return () => false;
        }
      case 'flag': return (it) => it.card.flag === Number(val);
      case 'nid': { const ids = new Set(val.split(',').map(Number)); return (it) => ids.has(it.note.id); }
      case 'cid': { const ids = new Set(val.split(',').map(Number)); return (it) => ids.has(it.card.id); }
      case 'added': { const n = Number(val) || 1; return (it, env) => it.card.created >= env.todayStart - (n - 1) * DAY; }
      case 'rated': { const n = Number(val.split(':')[0]) || 1; return (it, env) => (it.card.lastReview ?? 0) >= env.todayStart - (n - 1) * DAY; }
      case 'prop': {
        const m = /^(ivl|due|reps|lapses|s|d|pos)(<=|>=|!=|<|>|=)(-?[\d.]+)$/i.exec(val);
        if (!m) return () => false;
        const [, prop, op, numS] = m;
        const num = Number(numS);
        return (it, env) => {
          const c = it.card;
          switch (prop.toLowerCase()) {
            case 'ivl': return c.state === CardState.Review && cmp(op, c.scheduledDays, num);
            case 'due': return c.state !== CardState.New && cmp(op, Math.floor((c.due - env.todayStart) / DAY), num);
            case 'reps': return cmp(op, c.reps, num);
            case 'lapses': return cmp(op, c.lapses, num);
            case 's': return c.state !== CardState.New && cmp(op, c.stability, num);
            case 'd': return c.state !== CardState.New && cmp(op, c.difficulty, num);
            case 'pos': return c.state === CardState.New && cmp(op, c.position, num);
          }
          return false;
        };
      }
      case 're': {
        let re: RegExp;
        try { re = new RegExp(val, 'i'); } catch { return () => false; }
        return (it) => re.test(noteText(it.note));
      }
      default: {
        // field:value — matches the whole field (use * for partial)
        const re = globToRegex(val, true);
        return (it) => {
          const idx = it.noteType.fields.findIndex((f) => f.name.toLowerCase() === key);
          return idx >= 0 && re.test(stripHtml(it.note.fields[idx] ?? ''));
        };
      }
    }
  }
  if (!word) return () => true;
  const re = globToRegex(word, false);
  return (it) => re.test(noteText(it.note));
}

/** Compile a search string into a predicate. Empty query matches everything. */
export function compileSearch(query: string): Predicate {
  const toks = tokenize(query);
  let pos = 0;

  function parseOr(): Predicate {
    const parts = [parseAnd()];
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.k === 'word' && !t.quoted && t.v.toLowerCase() === 'or') {
        pos++;
        parts.push(parseAnd());
      } else break;
    }
    return parts.length === 1 ? parts[0] : (it, env) => parts.some((p) => p(it, env));
  }

  function parseAnd(): Predicate {
    const parts: Predicate[] = [];
    while (pos < toks.length) {
      const t = toks[pos];
      if (t.k === ')') break;
      if (t.k === 'word' && !t.quoted && t.v.toLowerCase() === 'or') break;
      if (t.k === 'word' && !t.quoted && t.v.toLowerCase() === 'and') { pos++; continue; }
      parts.push(parseUnary());
    }
    if (!parts.length) return () => true;
    return parts.length === 1 ? parts[0] : (it, env) => parts.every((p) => p(it, env));
  }

  function parseUnary(): Predicate {
    const t = toks[pos++];
    if (t.k === '-') {
      const inner = parseUnary();
      return (it, env) => !inner(it, env);
    }
    if (t.k === '(') {
      const inner = parseOr();
      if (toks[pos]?.k === ')') pos++;
      return inner;
    }
    if (t.k === 'word') return termPredicate(t.v, t.quoted);
    return () => true;
  }

  const p = parseOr();
  return p;
}
