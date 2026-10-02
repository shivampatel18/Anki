// Converting one imported Anki card's scheduling into this app's FSRS card fields. Pure.
import type { ImpCard, ImpRevlog } from './apkg';
import { approximateMemory, replayMemory, type AnswerGrade, type HistoryItem } from '../domain/scheduler';
import { type Card, CardState, type Preset, type ReviewKind, type ReviewLogEntry } from '../domain/types';
import { DAY } from '../domain/time';

export type Schedule = Pick<
  Card,
  'state' | 'due' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses' | 'lastReview' | 'suspended' | 'flag'
>;

interface CardData {
  s?: number;
  d?: number;
  lrt?: number;
}

function parseData(s: string): CardData {
  if (!s || s[0] !== '{') return {};
  try {
    return JSON.parse(s) as CardData;
  } catch {
    return {};
  }
}

/** Revlog entries that represent real answers (not manual reschedules). */
export function gradedHistory(log: ImpRevlog[]): HistoryItem[] {
  return log
    .filter((r) => r.ease >= 1 && r.ease <= 4 && (r.type <= 2 || r.type === 3))
    .map((r) => ({ at: r.id, rating: r.ease as AnswerGrade }));
}

export function deckOf(c: ImpCard): number {
  return c.odid ? c.odid : c.did;
}

export function convertSchedule(c: ImpCard, crt: number, now: number, preset: Preset, log: ImpRevlog[]): Schedule {
  const data = parseData(c.data);
  const due = c.odid ? c.odue : c.due;
  const base = {
    reps: c.reps,
    lapses: c.lapses,
    suspended: c.queue === -1,
    flag: c.flags & 7,
  };
  const dayDue = (d: number) => (crt + d * 86_400) * 1000;

  if (c.type === 0) {
    return { ...base, state: CardState.New, due: now, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, lastReview: undefined };
  }

  const history = gradedHistory(log);
  const lastLog = history.length ? history[history.length - 1].at : undefined;
  let memory: { stability: number; difficulty: number } | null = null;
  if (typeof data.s === 'number' && typeof data.d === 'number' && data.s > 0) memory = { stability: data.s, difficulty: data.d };
  if (!memory) memory = replayMemory(history, preset);
  if (!memory) memory = approximateMemory(Math.max(c.ivl, 0), c.factor / 1000);
  const stability = Math.max(0.1, memory.stability);
  const difficulty = Math.min(10, Math.max(1, memory.difficulty));

  if (c.type === 2) {
    const dueMs = dayDue(due);
    const lastReview = data.lrt ? data.lrt * 1000 : lastLog ?? dueMs - c.ivl * DAY;
    return { ...base, state: CardState.Review, due: dueMs, stability, difficulty, scheduledDays: Math.max(1, c.ivl), learningSteps: 0, lastReview };
  }

  // learning (1) or relearning (3)
  const relearn = c.type === 3;
  const dueMs = due > 1_000_000_000 ? due * 1000 : dayDue(due);
  const steps = relearn ? preset.relearningSteps : preset.learningSteps;
  const remaining = c.left % 1000;
  const learningSteps = Math.max(0, Math.min(steps.length - 1, steps.length - remaining));
  const lastReview = data.lrt ? data.lrt * 1000 : lastLog ?? now;
  return {
    ...base,
    state: relearn ? CardState.Relearning : CardState.Learning,
    due: dueMs,
    stability,
    difficulty,
    scheduledDays: 0,
    learningSteps,
    lastReview,
  };
}

export function convertRevlog(r: ImpRevlog, cardId: number): ReviewLogEntry {
  const kind: ReviewKind =
    r.ease === 0 || r.type >= 4 ? 'manual' : r.type === 0 ? 'learn' : r.type === 2 ? 'relearn' : 'review';
  return {
    id: r.id,
    cardId,
    rating: r.ease,
    kind,
    interval: r.ivl > 0 ? r.ivl : 0,
    lastInterval: r.lastIvl > 0 ? r.lastIvl : 0,
    stability: 0,
    difficulty: 0,
    durationMs: r.time,
  };
}

/** The time a card was last answered, for "newer wins" merges. */
export function lastReviewedAt(c: ImpCard, log: ImpRevlog[]): number {
  const data = parseData(c.data);
  if (data.lrt) return data.lrt * 1000;
  const h = gradedHistory(log);
  return h.length ? h[h.length - 1].at : 0;
}
