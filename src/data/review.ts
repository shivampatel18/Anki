// Recording answers: schedule the card, log it, bury siblings, handle leeches. Supports undo.
import { db } from './db';
import { presetForDeck, normalizeTags } from './repo';
import { answer, type AnswerGrade } from '../domain/scheduler';
import { dayNumber } from '../domain/time';
import { type Card, CardState, type Note, type ReviewLogEntry } from '../domain/types';
import { applyToSnapshot, revertInSnapshot, type DaySnapshot } from './queue';

export interface UndoEntry {
  cardBefore: Card;
  siblingsBefore: Card[];
  noteBefore?: Note;
  log: ReviewLogEntry;
  wasIntroduced: boolean;
}

export interface AnswerOutcome {
  card: Card;
  log: ReviewLogEntry;
  undo: UndoEntry;
  becameLeech: boolean;
}

export async function answerCard(
  snap: DaySnapshot,
  cardId: number,
  grade: AnswerGrade,
  durationMs: number,
  now = Date.now(),
): Promise<AnswerOutcome> {
  const card = await db.cards.get(cardId);
  if (!card) throw new Error('Card not found.');
  const preset = await presetForDeck(card.deckId);
  const res = answer(card, grade, preset, now, Math.min(durationMs, 60_000));
  // never reuse a log id (two answers in the same millisecond)
  while (await db.revlog.get(res.log.id)) res.log.id++;
  const today = dayNumber(now, snap.settings.dayStartHour);
  let next = res.card;
  let becameLeech = false;
  let noteBefore: Note | undefined;

  const siblings = (await db.cards.where('noteId').equals(card.noteId).toArray()).filter((c) => c.id !== card.id);
  const toBury = siblings.filter(
    (s) =>
      !s.suspended &&
      s.buriedUntil <= today &&
      ((preset.buryNew && s.state === CardState.New) || (preset.buryReviews && s.state === CardState.Review && s.due < snap.todayEnd)),
  );

  await db.transaction('rw', [db.cards, db.revlog, db.notes], async () => {
    if (res.lapsed && preset.leechThreshold > 0) {
      const lapses = next.lapses;
      const half = Math.max(1, Math.ceil(preset.leechThreshold / 2));
      if (lapses >= preset.leechThreshold && (lapses - preset.leechThreshold) % half === 0) {
        becameLeech = true;
        const note = await db.notes.get(card.noteId);
        if (note) {
          noteBefore = note;
          await db.notes.put({ ...note, tags: normalizeTags([...note.tags, 'leech']), mtime: now });
        }
        if (preset.leechAction === 'suspend') next = { ...next, suspended: true };
      }
    }
    await db.cards.put(next);
    await db.revlog.add(res.log);
    if (toBury.length) await db.cards.bulkPut(toBury.map((s) => ({ ...s, buriedUntil: today + 1, mtime: now })));
  });

  const wasIntroduced = card.state === CardState.New && !snap.introduced.has(card.id);
  const buried = toBury.map((s) => ({ ...s, buriedUntil: today + 1 }));
  applyToSnapshot(snap, card, next, res.log, buried);

  return {
    card: next,
    log: res.log,
    becameLeech,
    undo: { cardBefore: card, siblingsBefore: toBury, noteBefore, log: res.log, wasIntroduced },
  };
}

export async function undoAnswer(snap: DaySnapshot, u: UndoEntry): Promise<Card> {
  await db.transaction('rw', [db.cards, db.revlog, db.notes], async () => {
    await db.cards.put(u.cardBefore);
    if (u.siblingsBefore.length) await db.cards.bulkPut(u.siblingsBefore);
    await db.revlog.delete(u.log.id);
    if (u.noteBefore) await db.notes.put(u.noteBefore);
  });
  revertInSnapshot(snap, [u.cardBefore, ...u.siblingsBefore], u.log, u.wasIntroduced);
  return u.cardBefore;
}
