// Core entities. Pure data — no storage or UI concerns here.

export type Id = number;

export type NoteTypeKind = 'normal' | 'cloze';

export interface FieldDef {
  name: string;
  ord: number;
}

export interface TemplateDef {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
}

export interface NoteType {
  id: Id;
  name: string;
  kind: NoteTypeKind;
  fields: FieldDef[];
  templates: TemplateDef[];
  css: string;
  sortField: number;
  /** Anki's notetype id when imported, used to match on re-import. */
  ankiId?: number;
  mtime: number;
}

export interface Deck {
  id: Id;
  /** Full path, levels joined with "::" (e.g. "Languages::French"). */
  name: string;
  presetId: Id;
  description?: string;
  collapsed?: boolean;
  /** Anki's deck id when imported. */
  ankiId?: number;
  /** A chapter you haven't reached: no new cards from it (or its subdecks) until started. */
  notStarted?: boolean;
  mtime: number;
}

export type LeechAction = 'suspend' | 'tag';

export interface Preset {
  id: Id;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  /** e.g. ["1m", "10m"] */
  learningSteps: string[];
  relearningSteps: string[];
  desiredRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  buryNew: boolean;
  buryReviews: boolean;
  leechThreshold: number;
  leechAction: LeechAction;
  /** FSRS weights; empty = library defaults. */
  fsrsParams: number[];
  newOrder: 'added' | 'random';
  /** Anki's deck-options preset id when imported. */
  ankiId?: number;
  mtime: number;
}

export interface Note {
  id: Id;
  guid: string;
  noteTypeId: Id;
  fields: string[];
  tags: string[];
  created: number;
  mtime: number;
}

/** Matches ts-fsrs State. */
export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export interface Card {
  id: Id;
  noteId: Id;
  deckId: Id;
  /** Template index (normal) or cloze number − 1 (cloze). */
  ord: number;
  created: number;
  mtime: number;
  /** Order among new cards. */
  position: number;

  // FSRS memory + schedule
  state: CardState;
  due: number; // epoch ms
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview?: number; // epoch ms

  // flags
  suspended: boolean;
  /** Study-day number until which the card is hidden; 0 = not buried. */
  buriedUntil: number;
  flag: number; // 0 none, 1 red … 7 purple
}

export type ReviewKind = 'learn' | 'review' | 'relearn' | 'manual';

export interface ReviewLogEntry {
  id: Id; // epoch ms of the review
  cardId: Id;
  rating: number; // 1..4, 0 manual
  kind: ReviewKind;
  /** Interval after this review, days (0 for same-day steps). */
  interval: number;
  /** Interval before this review, days. */
  lastInterval: number;
  stability: number;
  difficulty: number;
  durationMs: number;
}

export interface MediaFile {
  name: string;
  blob: Blob;
  size: number;
}

export interface Settings {
  id: 'settings';
  /** Hour of the day (0–23) at which a new study day starts. */
  dayStartHour: number;
  theme: 'system' | 'light' | 'dark';
  /** Minutes a learning card may be shown early when nothing else is due. */
  learnAheadMinutes: number;
  defaultDeckId: Id;
  lastNoteTypeId?: Id;
  /** Monotonic counter for new-card positions. */
  nextPosition: number;
}

export const FLAG_COLORS = ['', '#C4473B', '#D07A1E', '#3D8A5C', '#2F5FA8', '#B05FA8', '#3A9BA8', '#7356B8'];
export const FLAG_NAMES = ['None', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];
