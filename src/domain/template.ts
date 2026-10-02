// Anki-compatible card template rendering and card generation rules.
// Supports {{Field}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}}, chained filters
// (cloze, type, text, hint, furigana, kana, kanji, tts, edit), special fields and cloze deletions.
import type { NoteType } from './types';

// ---------- tokenizing ----------

type Node =
  | { t: 'text'; v: string }
  | { t: 'field'; name: string; filters: string[] }
  | { t: 'cond'; name: string; neg: boolean; body: Node[] };

const TAG_RE = /\{\{([\s\S]*?)\}\}/g;

function parse(tpl: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; nodes: Node[] }[] = [{ name: '', nodes: root }];
  let last = 0;
  for (const m of tpl.matchAll(TAG_RE)) {
    const cur = stack[stack.length - 1].nodes;
    if (m.index! > last) cur.push({ t: 'text', v: tpl.slice(last, m.index) });
    last = m.index! + m[0].length;
    const inner = m[1].trim();
    if (inner.startsWith('#') || inner.startsWith('^')) {
      const node: Node = { t: 'cond', name: inner.slice(1).trim(), neg: inner[0] === '^', body: [] };
      cur.push(node);
      stack.push({ name: node.name, nodes: node.body });
    } else if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      // close the matching section; tolerate mismatches by unwinding to it
      const idx = findLastIndex(stack, (s) => s.name === name);
      if (idx > 0) stack.length = idx;
    } else if (inner.startsWith('!')) {
      // comment
    } else {
      const parts = inner.split(':');
      const name = parts.pop()!.trim();
      cur.push({ t: 'field', name, filters: parts.map((p) => p.trim()) });
    }
  }
  const cur = stack[stack.length - 1].nodes;
  if (last < tpl.length) cur.push({ t: 'text', v: tpl.slice(last) });
  return root;
}

function findLastIndex<T>(a: T[], p: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (p(a[i])) return i;
  return -1;
}

// ---------- helpers ----------

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(div|p|li)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A field is empty if it has no visible text and no media. */
export function fieldIsEmpty(html: string): boolean {
  if (/<(img|audio|video|object|iframe|svg)\b/i.test(html) || /\[sound:/.test(html)) return false;
  return stripHtml(html) === '';
}

// ---------- cloze ----------

interface ClozeSpan {
  t: 'cloze';
  num: number;
  body: ClozePart[];
  hint?: string;
}
type ClozePart = string | ClozeSpan;

const OPEN_RE = /\{\{c(\d+)::/y;

/** Parse text containing (possibly nested) cloze deletions. */
export function parseCloze(text: string): ClozePart[] {
  let i = 0;
  function parseUntilClose(inCloze: boolean): ClozePart[] {
    const out: ClozePart[] = [];
    let buf = '';
    while (i < text.length) {
      OPEN_RE.lastIndex = i;
      const m = OPEN_RE.exec(text);
      if (m) {
        if (buf) out.push(buf), (buf = '');
        i += m[0].length;
        const body = parseUntilClose(true);
        // split hint: last top-level string part containing "::"
        let hint: string | undefined;
        const lastIdx = body.length - 1;
        if (lastIdx >= 0 && typeof body[lastIdx] === 'string') {
          const s = body[lastIdx] as string;
          const k = s.indexOf('::');
          if (k >= 0) {
            hint = s.slice(k + 2);
            body[lastIdx] = s.slice(0, k);
          }
        }
        out.push({ t: 'cloze', num: Number(m[1]), body, hint });
        continue;
      }
      if (inCloze && text.startsWith('}}', i)) {
        i += 2;
        if (buf) out.push(buf);
        return out;
      }
      buf += text[i++];
    }
    if (buf) out.push(buf);
    return out;
  }
  return parseUntilClose(false);
}

export function clozeNumbers(text: string): number[] {
  const nums = new Set<number>();
  const walk = (parts: ClozePart[]) => {
    for (const p of parts) if (typeof p !== 'string') nums.add(p.num), walk(p.body);
  };
  walk(parseCloze(text));
  return [...nums].sort((a, b) => a - b);
}

function renderClozeParts(parts: ClozePart[], num: number, side: 'q' | 'a'): string {
  return parts
    .map((p) => {
      if (typeof p === 'string') return p;
      const inner = renderClozeParts(p.body, num, side);
      if (p.num === num) {
        if (side === 'q') {
          const label = p.hint ? `[${p.hint}]` : '[...]';
          return `<span class="cloze" data-ordinal="${p.num}">${label}</span>`;
        }
        return `<span class="cloze" data-ordinal="${p.num}">${inner}</span>`;
      }
      return `<span class="cloze-inactive" data-ordinal="${p.num}">${inner}</span>`;
    })
    .join('');
}

function clozeAnswers(parts: ClozePart[], num: number): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') continue;
    if (p.num === num) out.push(stripHtml(renderClozeParts(p.body, -1, 'a')));
    else out.push(...clozeAnswers(p.body, num));
  }
  return out;
}

// ---------- furigana ----------

const RUBY_RE = / ?([^ >]+?)\[(.+?)\]/g;
const furigana = (s: string) => s.replace(RUBY_RE, (_m, base, ruby) => (ruby.startsWith('sound:') ? _m : `<ruby><rb>${base}</rb><rt>${ruby}</rt></ruby>`));
const kana = (s: string) => s.replace(RUBY_RE, (_m, _b, ruby) => (ruby.startsWith('sound:') ? _m : ruby));
const kanji = (s: string) => s.replace(RUBY_RE, (_m, base, ruby) => (ruby.startsWith('sound:') ? _m : base));

// ---------- type-in answers ----------

/** Character-level comparison, shown on the answer side. */
export function compareTyped(typed: string, expected: string): string {
  const a = typed.trim();
  const b = expected.trim();
  if (!a) return `<code id="typeans"><span class="typeMissed">${escapeHtml(b)}</span></code>`;
  if (a === b) return `<code id="typeans"><span class="typeGood">${escapeHtml(b)}</span></code>`;
  // LCS-based diff
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  let typedOut = '', expectedOut = '';
  const span = (cls: string, s: string) => (s ? `<span class="${cls}">${escapeHtml(s)}</span>` : '');
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      typedOut += span('typeGood', a[i]);
      expectedOut += span('typeGood', b[j]);
      i++, j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      typedOut += span('typeMissed', '-');
      expectedOut += span('typeMissed', b[j]);
      j++;
    } else {
      typedOut += span('typeBad', a[i]);
      i++;
    }
  }
  return `<code id="typeans">${typedOut}<br><span id="typearrow">&darr;</span><br>${expectedOut}</code>`;
}

// ---------- rendering ----------

export interface RenderContext {
  noteType: NoteType;
  fields: string[];
  tags: string[];
  deckName: string;
  cardOrd: number;
  flag?: number;
}

interface RenderState {
  ctx: RenderContext;
  side: 'q' | 'a';
  frontSide: string;
  typed?: string;
  nonEmptyField: boolean;
  typeExpected?: string;
}

function fieldValue(st: RenderState, name: string): string | undefined {
  const { ctx } = st;
  const idx = ctx.noteType.fields.findIndex((f) => f.name === name);
  if (idx >= 0) return ctx.fields[idx] ?? '';
  switch (name) {
    case 'FrontSide':
      return st.frontSide;
    case 'Tags':
      return ctx.tags.join(' ');
    case 'Type':
      return ctx.noteType.name;
    case 'Deck':
      return ctx.deckName;
    case 'Subdeck':
      return ctx.deckName.split('::').pop() ?? '';
    case 'Card': {
      if (ctx.noteType.kind === 'cloze') return `Cloze ${ctx.cardOrd + 1}`;
      return ctx.noteType.templates[ctx.cardOrd]?.name ?? '';
    }
    case 'CardFlag':
      return ctx.flag ? `flag${ctx.flag}` : '';
  }
  return undefined;
}

function applyFilter(st: RenderState, filter: string, value: string, fieldName: string): string {
  const f = filter.toLowerCase();
  if (f === 'text') return escapeHtml(stripHtml(value));
  if (f === 'cloze') {
    const parts = parseCloze(value);
    return renderClozeParts(parts, st.ctx.cardOrd + 1, st.side);
  }
  if (f === 'hint') {
    if (fieldIsEmpty(value)) return '';
    return `<a class="hint" href="#" onclick="this.style.display='none';this.nextElementSibling.style.display='block';return false;">Show ${escapeHtml(fieldName)}</a><div class="hint" style="display:none">${value}</div>`;
  }
  if (f === 'furigana') return furigana(value);
  if (f === 'kana') return kana(value);
  if (f === 'kanji') return kanji(value);
  if (f.startsWith('tts') || f === 'edit' || f === 'nc') return value;
  return value;
}

function renderNodes(nodes: Node[], st: RenderState): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'cond') {
      const v = fieldValue(st, n.name);
      const present = v !== undefined && !fieldIsEmpty(v);
      if (present !== n.neg) out += renderNodes(n.body, st);
    } else {
      const raw = fieldValue(st, n.name);
      if (raw === undefined) {
        out += `<span class="unknown-field">{unknown field ${escapeHtml(n.name)}}</span>`;
        continue;
      }
      if (n.name !== 'FrontSide' && !n.filters.length && !fieldIsEmpty(raw)) st.nonEmptyField = true;
      const filters = n.filters.map((x) => x.toLowerCase());
      if (filters[0] === 'type') {
        // {{type:Field}} or {{type:cloze:Field}}
        const isCloze = filters[1] === 'cloze';
        const expected = isCloze
          ? clozeAnswers(parseCloze(raw), st.ctx.cardOrd + 1).join(', ')
          : stripHtml(raw);
        st.typeExpected = expected;
        if (!fieldIsEmpty(raw)) st.nonEmptyField = true;
        out += st.side === 'q' ? '[[type-input]]' : compareTyped(st.typed ?? '', expected);
        continue;
      }
      let v = raw;
      for (let i = n.filters.length - 1; i >= 0; i--) v = applyFilter(st, n.filters[i], v, n.name);
      if (n.filters.length && !fieldIsEmpty(raw) && n.name !== 'FrontSide') st.nonEmptyField = true;
      out += v;
    }
  }
  return out;
}

export interface RenderedCard {
  question: string;
  answer: string;
  /** Expected text for a type-in answer, if the card has one. */
  typeExpected?: string;
  css: string;
}

const TYPE_INPUT = '<input id="typeans" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type your answer">';

export function renderCard(ctx: RenderContext, typed?: string): RenderedCard {
  const { noteType } = ctx;
  const tpl = noteType.kind === 'cloze' ? noteType.templates[0] : noteType.templates[ctx.cardOrd];
  if (!tpl) return { question: '<p>Missing card template.</p>', answer: '', css: noteType.css };
  const qState: RenderState = { ctx, side: 'q', frontSide: '', nonEmptyField: false };
  const qRaw = renderNodes(parse(tpl.qfmt), qState);
  const question = qRaw.replace('[[type-input]]', TYPE_INPUT).replace(/\[\[type-input\]\]/g, '');
  const aState: RenderState = { ctx, side: 'a', frontSide: qRaw.replace(/\[\[type-input\]\]/g, ''), typed, nonEmptyField: false };
  const answer = renderNodes(parse(tpl.afmt), aState);
  return { question, answer, typeExpected: qState.typeExpected ?? aState.typeExpected, css: noteType.css };
}

/** Which card ordinals a note should have, per Anki's generation rules. */
export function cardOrdsForNote(noteType: NoteType, fields: string[]): number[] {
  if (noteType.kind === 'cloze') {
    // numbers from fields referenced with the cloze filter in the question template
    const tpl = noteType.templates[0]?.qfmt ?? '';
    const clozeFields = new Set<string>();
    for (const m of tpl.matchAll(/\{\{([^}]*?)cloze:([^}:]+)\}\}/g)) clozeFields.add(m[2].trim());
    const nums = new Set<number>();
    noteType.fields.forEach((f, i) => {
      if (clozeFields.has(f.name)) for (const n of clozeNumbers(fields[i] ?? '')) nums.add(n);
    });
    return [...nums].sort((a, b) => a - b).map((n) => n - 1);
  }
  const ords: number[] = [];
  for (const t of noteType.templates) {
    const st: RenderState = {
      ctx: { noteType, fields, tags: [], deckName: '', cardOrd: t.ord },
      side: 'q',
      frontSide: '',
      nonEmptyField: false,
    };
    renderNodes(parse(t.qfmt), st);
    if (st.nonEmptyField) ords.push(t.ord);
  }
  return ords;
}

/** Media filenames referenced by field HTML. */
export function mediaRefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+?\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) out.add(decodeEntities(m[1] ?? m[2] ?? m[3]));
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) out.add(m[1]);
  return [...out].filter((n) => !/^(https?:|data:|blob:)/.test(n));
}

/** Plain text of a field for lists: HTML removed and cloze markup reduced to its answer. */
export function displayText(html: string): string {
  return stripHtml(html.replace(/\{\{c\d+::/g, '').replace(/::[^{}]*?\}\}/g, '').replace(/\}\}/g, ''));
}
