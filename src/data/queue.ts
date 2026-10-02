// Daily queues: which cards are due, per-deck counts with limits, and what to show next.
import { db } from './db';
import { getSettings } from './repo';
import { type Card, CardState, type Deck, type Preset, type ReviewLogEntry, type Settings } from '../domain/types';
import { dayEnd, dayNumber, dayStart, MINUTE } from '../domain/time';

export interface DaySnapshot {
  now: number;
  settings: Settings;
  today: number;
  todayStart: number;
  todayEnd: number;
  decks: Deck[];
  presets: Map<number, Preset>;
  /** Unsuspended, unburied cards that are new or due before the end of today. */
  cards: Map<number, Card>;
  /** Per deck: new cards introduced today / review-card reviews done today. */
  doneNew: Map<number, number>;
  doneReview: Map<number, number>;
  /** Cards first studied today (so re-answering doesn't double count). */
  introduced: Set<number>;
}

export async function loadSnapshot(now = Date.now()): Promise<DaySnapshot> {
  const settings = await getSettings();
  const todayStart = dayStart(now, settings.dayStartHour);
  const todayEnd = dayEnd(now, settings.dayStartHour);
  const today = dayNumber(now, settings.dayStartHour);
  const [decks, presets, due, logs] = await Promise.all([
    db.decks.toArray(),
    db.presets.toArray(),
    db.cards.where('due').below(todayEnd).toArray(),
    db.revlog.where('id').aboveOrEqual(todayStart).toArray(),
  ]);
  const cards = new Map<number, Card>();
  for (const c of due) if (isActive(c, today)) cards.set(c.id, c);

  const snap: DaySnapshot = {
    now,
    settings,
    today,
    todayStart,
    todayEnd,
    decks,
    presets: new Map(presets.map((p) => [p.id, p])),
    cards,
    doneNew: new Map(),
    doneReview: new Map(),
    introduced: new Set(),
  };
  await recordTodayLogs(snap, logs);
  return snap;
}

function isActive(c: Card, today: number): boolean {
  return !c.suspended && !(c.buriedUntil > today);
}

async function recordTodayLogs(snap: DaySnapshot, logs: ReviewLogEntry[]) {
  const graded = logs.filter((l) => l.kind !== 'manual');
  const ids = [...new Set(graded.map((l) => l.cardId))];
  if (!ids.length) return;
  const cardRows = await db.cards.bulkGet(ids);
  const deckOf = new Map<number, number>();
  cardRows.forEach((c) => c && deckOf.set(c.id, c.deckId));
  // one query: which of these cards were answered before today?
  const seenBefore = new Set<number>();
  await db.revlog
    .where('cardId')
    .anyOf(ids)
    .each((l) => {
      if (l.id < snap.todayStart && l.kind !== 'manual') seenBefore.add(l.cardId);
    });
  for (const id of ids) {
    const deck = deckOf.get(id);
    if (deck === undefined) continue;
    if (!seenBefore.has(id)) {
      snap.introduced.add(id);
      inc(snap.doneNew, deck);
    }
  }
  for (const l of graded) {
    const deck = deckOf.get(l.cardId);
    if (deck !== undefined && l.kind === 'review') inc(snap.doneReview, deck);
  }
}

function inc(m: Map<number, number>, k: number, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

/** Apply an answer to the snapshot without reloading from disk. */
export function applyToSnapshot(snap: DaySnapshot, before: Card, after: Card, log: ReviewLogEntry, changedSiblings: Card[]) {
  if (before.state === CardState.New && !snap.introduced.has(before.id)) {
    snap.introduced.add(before.id);
    inc(snap.doneNew, before.deckId);
  }
  if (log.kind === 'review') inc(snap.doneReview, before.deckId);
  for (const c of [after, ...changedSiblings]) {
    if (isActive(c, snap.today) && c.due < snap.todayEnd) snap.cards.set(c.id, c);
    else snap.cards.delete(c.id);
  }
}

/** Revert `applyToSnapshot` for undo. */
export function revertInSnapshot(snap: DaySnapshot, restored: Card[], log: ReviewLogEntry, wasIntroduced: boolean) {
  const card = restored[0];
  if (wasIntroduced) {
    snap.introduced.delete(card.id);
    inc(snap.doneNew, card.deckId, -1);
  }
  if (log.kind === 'review') inc(snap.doneReview, card.deckId, -1);
  for (const c of restored) {
    if (isActive(c, snap.today) && c.due < snap.todayEnd) snap.cards.set(c.id, c);
    else snap.cards.delete(c.id);
  }
}

// ---------- deck tree ----------

export interface DeckNode {
  deck: Deck;
  /** Last path component. */
  label: string;
  depth: number;
  children: DeckNode[];
  newCount: number;
  learnCount: number;
  reviewCount: number;
}

interface Pools {
  news: Card[];
  reviews: Card[];
  learning: Card[]; // all (re)learning cards due today, any time
}

function stableRandom(id: number, salt: number): number {
  let x = (id ^ (salt * 2654435761)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function bucket(snap: DaySnapshot): Map<number, Pools> {
  const own = new Map<number, Pools>();
  for (const d of snap.decks) own.set(d.id, { news: [], reviews: [], learning: [] });
  for (const c of snap.cards.values()) {
    const p = own.get(c.deckId);
    if (!p) continue;
    if (c.state === CardState.New) p.news.push(c);
    else if (c.state === CardState.Review) p.reviews.push(c);
    else p.learning.push(c);
  }
  return own;
}

/** A learning card last seen on an earlier day is due for the whole of today. */
function isInterday(c: Card, snap: DaySnapshot): boolean {
  return c.lastReview !== undefined && c.lastReview < snap.todayStart && c.due < snap.todayEnd;
}

export function buildTree(snap: DaySnapshot): DeckNode[] {
  const byName = new Map<string, DeckNode>();
  const roots: DeckNode[] = [];
  const sorted = [...snap.decks].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  for (const deck of sorted) {
    const parts = deck.name.split('::');
    const node: DeckNode = { deck, label: parts[parts.length - 1], depth: parts.length - 1, children: [], newCount: 0, learnCount: 0, reviewCount: 0 };
    byName.set(deck.name.toLowerCase(), node);
    const parent = parts.length > 1 ? byName.get(parts.slice(0, -1).join('::').toLowerCase()) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const own = bucket(snap);

  const learnCutoff = snap.now + snap.settings.learnAheadMinutes * MINUTE;
  const visit = (n: DeckNode): { doneNew: number; doneRev: number } => {
    let doneNew = snap.doneNew.get(n.deck.id) ?? 0;
    let doneRev = snap.doneReview.get(n.deck.id) ?? 0;
    const pools = own.get(n.deck.id)!;
    let newSum = pools.news.length;
    let revSum = pools.reviews.length;
    let learn = pools.learning.filter((c) => c.due <= learnCutoff || isInterday(c, snap)).length;
    for (const ch of n.children) {
      const d = visit(ch);
      doneNew += d.doneNew;
      doneRev += d.doneRev;
      newSum += ch.newCount;
      revSum += ch.reviewCount;
      learn += ch.learnCount;
    }
    const preset = snap.presets.get(n.deck.presetId) ?? [...snap.presets.values()][0];
    n.newCount = Math.max(0, Math.min(newSum, preset.newPerDay - doneNew));
    n.reviewCount = Math.max(0, Math.min(revSum, preset.reviewsPerDay - doneRev));
    n.learnCount = learn;
    return { doneNew, doneRev };
  };
  roots.forEach(visit);
  return roots;
}

export function findNode(roots: DeckNode[], deckId: number): DeckNode | undefined {
  for (const r of roots) {
    if (r.deck.id === deckId) return r;
    const f = findNode(r.children, deckId);
    if (f) return f;
  }
  return undefined;
}

export function flattenTree(roots: DeckNode[], includeCollapsed = true): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (ns: DeckNode[]) => {
    for (const n of ns) {
      out.push(n);
      if (includeCollapsed || !n.deck.collapsed) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

// ---------- next card ----------

export type NextCard =
  | { kind: 'card'; card: Card; queue: 'new' | 'learn' | 'review' }
  | { kind: 'waiting'; until: number }
  | { kind: 'done' };

export interface QueueCounts {
  newCount: number;
  learnCount: number;
  reviewCount: number;
}

/** Gather new/review cards for a subtree, honoring each level's limits. */
function gather(node: DeckNode, snap: DaySnapshot, kind: 'new' | 'review', pools: Map<number, Pools>): Card[] {
  const p = pools.get(node.deck.id);
  const ownCards: Card[] = p ? [...(kind === 'new' ? p.news : p.reviews)] : [];
  const preset = snap.presets.get(node.deck.presetId) ?? [...snap.presets.values()][0];
  if (kind === 'new') {
    if (preset.newOrder === 'random') ownCards.sort((a, b) => stableRandom(a.noteId, snap.today) - stableRandom(b.noteId, snap.today) || a.ord - b.ord);
    else ownCards.sort((a, b) => a.position - b.position || a.noteId - b.noteId || a.ord - b.ord);
  }
  let all = ownCards;
  for (const ch of node.children) all = all.concat(gather(ch, snap, kind, pools));
  const limit = kind === 'new' ? node.newCount : node.reviewCount;
  if (kind === 'review') {
    // due day first, then a stable shuffle so related cards don't cluster
    all.sort((a, b) => Math.floor(a.due / 86_400_000) - Math.floor(b.due / 86_400_000) || stableRandom(a.id, snap.today) - stableRandom(b.id, snap.today));
  }
  return all.slice(0, limit);
}

function subtreeIds(node: DeckNode): Set<number> {
  const ids = new Set<number>();
  const walk = (n: DeckNode) => {
    ids.add(n.deck.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

export function countsFor(snap: DaySnapshot, deckId: number): QueueCounts {
  const node = findNode(buildTree(snap), deckId);
  return node ? { newCount: node.newCount, learnCount: node.learnCount, reviewCount: node.reviewCount } : { newCount: 0, learnCount: 0, reviewCount: 0 };
}

export function nextCard(snap: DaySnapshot, deckId: number, now: number, avoidCardId?: number): NextCard {
  snap.now = now;
  const node = findNode(buildTree(snap), deckId);
  if (!node) return { kind: 'done' };
  const ids = subtreeIds(node);
  const learning = [...snap.cards.values()]
    .filter((c) => ids.has(c.deckId) && (c.state === CardState.Learning || c.state === CardState.Relearning))
    .sort((a, b) => a.due - b.due);

  const dueLearning = learning.filter((c) => c.due <= now || isInterday(c, snap));
  if (dueLearning.length) {
    const pick = dueLearning.find((c) => c.id !== avoidCardId) ?? dueLearning[0];
    return { kind: 'card', card: pick, queue: 'learn' };
  }

  const pools = bucket(snap);
  const reviews = gather(node, snap, 'review', pools).filter((c) => c.id !== avoidCardId);
  const news = gather(node, snap, 'new', pools).filter((c) => c.id !== avoidCardId);
  if (reviews.length || news.length) {
    let doneNew = 0, doneRev = 0;
    for (const id of ids) {
      doneNew += snap.doneNew.get(id) ?? 0;
      doneRev += snap.doneReview.get(id) ?? 0;
    }
    const newProgress = doneNew / (doneNew + news.length || 1);
    const revProgress = doneRev / (doneRev + reviews.length || 1);
    const takeNew = news.length > 0 && (reviews.length === 0 || newProgress <= revProgress);
    return takeNew ? { kind: 'card', card: news[0], queue: 'new' } : { kind: 'card', card: reviews[0], queue: 'review' };
  }

  const cutoff = now + snap.settings.learnAheadMinutes * MINUTE;
  const ahead = learning.filter((c) => c.due <= cutoff);
  if (ahead.length) return { kind: 'card', card: ahead[0], queue: 'learn' };
  const later = learning.find((c) => c.due < snap.todayEnd);
  if (later) return { kind: 'waiting', until: later.due };
  return { kind: 'done' };
}
