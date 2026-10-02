// FSRS scheduling. Pure: (card, grade, time, preset) -> (new card, log entry).
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
  type StepUnit,
} from 'ts-fsrs';
import { type Card, CardState, type Preset, type ReviewKind, type ReviewLogEntry } from './types';
import { DAY } from './time';

export { Rating };
export type AnswerGrade = 1 | 2 | 3 | 4;
export const GRADES: AnswerGrade[] = [1, 2, 3, 4];
export const GRADE_NAMES: Record<AnswerGrade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

const STEP_RE = /^\d+(\.\d+)?[mhd]$/;

export function isValidStep(s: string): boolean {
  return STEP_RE.test(s.trim());
}

/** Anki stores steps as minutes; convert to "10m" / "2h" / "1d". */
export function minutesToStep(min: number): string {
  if (min >= 1440 && min % 1440 === 0) return `${min / 1440}d`;
  if (min >= 60 && min % 60 === 0) return `${min / 60}h`;
  return `${Math.round(min * 100) / 100}m`;
}

const cache = new Map<string, FSRS>();

export function schedulerFor(preset: Preset): FSRS {
  const key = JSON.stringify([
    preset.desiredRetention,
    preset.maximumInterval,
    preset.enableFuzz,
    preset.learningSteps,
    preset.relearningSteps,
    preset.fsrsParams,
  ]);
  let f = cache.get(key);
  if (!f) {
    const params = generatorParameters({
      request_retention: clamp(preset.desiredRetention, 0.7, 0.99),
      maximum_interval: Math.max(1, preset.maximumInterval),
      enable_fuzz: preset.enableFuzz,
      enable_short_term: true,
      learning_steps: preset.learningSteps.filter(isValidStep) as StepUnit[],
      relearning_steps: preset.relearningSteps.filter(isValidStep) as StepUnit[],
      ...(validParams(preset.fsrsParams) ? { w: preset.fsrsParams } : {}),
    });
    f = fsrs(params);
    cache.set(key, f);
  }
  return f;
}

function validParams(w: number[]): boolean {
  return [17, 19, 21].includes(w.length) && w.every((x) => Number.isFinite(x));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function toFsrs(card: Card): FsrsCard {
  const last = card.lastReview;
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as unknown as State,
    last_review: last ? new Date(last) : undefined,
  };
}

function fromFsrs(base: Card, f: FsrsCard, now: number): Card {
  return {
    ...base,
    due: f.due.getTime(),
    stability: f.stability,
    difficulty: f.difficulty,
    scheduledDays: f.scheduled_days,
    learningSteps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state as unknown as CardState,
    lastReview: f.last_review ? f.last_review.getTime() : now,
    mtime: now,
  };
}

export interface AnswerPreview {
  grade: AnswerGrade;
  due: number;
  /** ms from now until due */
  delay: number;
}

/** Next due time for each grade, shown on the answer buttons. */
export function preview(card: Card, preset: Preset, now: number): AnswerPreview[] {
  const f = schedulerFor(preset);
  const log = f.repeat(toFsrs(card), new Date(now));
  return GRADES.map((g) => {
    const due = log[g as Grade].card.due.getTime();
    return { grade: g, due, delay: Math.max(0, due - now) };
  });
}

export interface AnswerResult {
  card: Card;
  log: ReviewLogEntry;
  lapsed: boolean;
}

export function answer(card: Card, grade: AnswerGrade, preset: Preset, now: number, durationMs: number): AnswerResult {
  const f = schedulerFor(preset);
  const prev = toFsrs(card);
  const item = f.next(prev, new Date(now), grade as Grade);
  const next = fromFsrs(card, item.card, now);
  const kind: ReviewKind =
    card.state === CardState.Review ? 'review' : card.state === CardState.Relearning ? 'relearn' : 'learn';
  const lapsed = card.state === CardState.Review && grade === 1;
  const lastInterval = card.state === CardState.Review ? card.scheduledDays : 0;
  return {
    card: next,
    lapsed,
    log: {
      id: now,
      cardId: card.id,
      rating: grade,
      kind,
      interval: next.state === CardState.Review ? Math.round((next.due - now) / DAY) : 0,
      lastInterval,
      stability: next.stability,
      difficulty: next.difficulty,
      durationMs,
    },
  };
}

/** Probability of recalling the card right now (0–1); undefined for new cards. */
export function retrievability(card: Card, preset: Preset, now: number): number | undefined {
  if (card.state === CardState.New || !card.lastReview) return undefined;
  const f = schedulerFor(preset);
  return f.get_retrievability(toFsrs(card), new Date(now), false) as number;
}

/** A fresh card in the New state. */
export function emptySchedule(now: number): Pick<
  Card,
  'state' | 'due' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses'
> {
  const c = createEmptyCard(new Date(now));
  return {
    state: CardState.New,
    due: c.due.getTime(),
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
  };
}

/** Reset a card back to New (keeps id, note, deck). */
export function resetCard(card: Card, now: number, position: number): Card {
  return { ...card, ...emptySchedule(now), lastReview: undefined, position, mtime: now };
}

/** Set a review card due on a specific date without touching memory state. */
export function setDue(card: Card, due: number, now: number): Card {
  if (card.state === CardState.New) {
    // Make it a review card: approximate a memory state so FSRS has something to work with.
    const days = Math.max(1, Math.round((due - now) / DAY));
    return {
      ...card,
      state: CardState.Review,
      due,
      stability: days,
      difficulty: 5,
      scheduledDays: days,
      reps: Math.max(card.reps, 1),
      lastReview: now,
      mtime: now,
    };
  }
  return { ...card, due, scheduledDays: Math.max(0, Math.round((due - (card.lastReview ?? now)) / DAY)), mtime: now };
}

export interface HistoryItem {
  at: number;
  rating: AnswerGrade;
}

/**
 * Rebuild a memory state (stability, difficulty) by replaying a review history.
 * Used when importing cards scheduled by SM-2, which has no FSRS state.
 */
export function replayMemory(history: HistoryItem[], preset: Preset): { stability: number; difficulty: number } | null {
  if (!history.length) return null;
  const f = schedulerFor({ ...preset, enableFuzz: false });
  const sorted = [...history].sort((a, b) => a.at - b.at);
  let c = createEmptyCard(new Date(sorted[0].at));
  for (const h of sorted) c = f.next(c, new Date(h.at), h.rating as Grade).card;
  return { stability: c.stability, difficulty: c.difficulty };
}

/** Fallback when there is no usable history: derive from SM-2 interval and ease. */
export function approximateMemory(intervalDays: number, easeFactor: number): { stability: number; difficulty: number } {
  const ease = easeFactor > 0 ? easeFactor : 2.5;
  // ease 1.3 -> D≈10, 2.5 -> D≈5, 3.5+ -> D≈1
  const difficulty = clamp(5 - (ease - 2.5) * 4.2, 1, 10);
  return { stability: Math.max(0.1, intervalDays), difficulty };
}
