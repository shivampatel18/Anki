// Chapters you haven't reached yet. A deck marked "not started" introduces no new cards;
// cards already learned in it still come up for review. Starting or stopping a deck always
// applies to its subdecks too, so each deck's own flag is the whole truth (no inheritance). Pure.
import type { Deck } from './types';

/** Deck order used everywhere: alphabetical, with numbers compared as numbers (Book 2 before Book 10). */
export function compareDeckNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function isUnder(name: string, ancestor: string): boolean {
  return name.toLowerCase().startsWith(ancestor.toLowerCase() + '::');
}

/** Ids of decks that are not started. */
export function notStartedIds(decks: Deck[]): Set<number> {
  return new Set(decks.filter((d) => d.notStarted).map((d) => d.id));
}

export type ChapterRange = 'only' | 'upTo' | 'from';

/**
 * Decks affected when starting/stopping a chapter, within the same top-level deck:
 * - only: the deck and its subdecks
 * - upTo: every deck listed before it, the deck, and its subdecks
 * - from: the deck, its subdecks and every deck listed after it
 */
export function chapterRange(decks: Deck[], deckId: number, range: ChapterRange): number[] {
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return [];
  const root = deck.name.split('::')[0];
  const family = decks
    .filter((d) => d.name === root || isUnder(d.name, root) || d.name.toLowerCase() === root.toLowerCase())
    .sort((a, b) => compareDeckNames(a.name, b.name));
  const idx = family.findIndex((d) => d.id === deckId);
  const self = family.filter((d) => d.id === deckId || isUnder(d.name, deck.name));
  if (range === 'only') return self.map((d) => d.id);
  if (range === 'from') return family.slice(idx).map((d) => d.id);
  return [...new Set([...family.slice(0, idx + 1), ...self].map((d) => d.id))];
}
