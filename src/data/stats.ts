// Aggregations for the statistics screen.
import { db } from './db';
import { deckAndChildrenIds, getSettings } from './repo';
import { CardState } from '../domain/types';
import { DAY, dayNumber, dayStart } from '../domain/time';

export interface Stats {
  today: { reviews: number; newCards: number; timeMs: number; correct: number; graded: number };
  forecast: { day: number; count: number }[]; // day 0 = today (includes overdue)
  history: { day: number; count: number; timeMs: number }[]; // day 0 = today, negative = past
  counts: { new: number; learning: number; young: number; mature: number; suspended: number; total: number };
  retention: { young: { pass: number; total: number }; mature: { pass: number; total: number } };
  streak: number;
}

export async function computeStats(deckId: number | null, days = 30, now = Date.now()): Promise<Stats> {
  const settings = await getSettings();
  const ids = deckId === null ? null : new Set(await deckAndChildrenIds(deckId));
  const cards = ids ? await db.cards.where('deckId').anyOf([...ids]).toArray() : await db.cards.toArray();
  const cardIds = new Set(cards.map((c) => c.id));
  const todayNum = dayNumber(now, settings.dayStartHour);
  const todayStart = dayStart(now, settings.dayStartHour);
  const since = todayStart - 365 * DAY;
  const logs = (await db.revlog.where('id').aboveOrEqual(since).toArray()).filter((l) => !ids || cardIds.has(l.cardId));

  const counts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, total: cards.length };
  const forecast = Array.from({ length: days }, (_, d) => ({ day: d, count: 0 }));
  for (const c of cards) {
    if (c.suspended) counts.suspended++;
    if (c.state === CardState.New) counts.new++;
    else if (c.state === CardState.Review) (c.scheduledDays >= 21 ? counts.mature++ : counts.young++);
    else counts.learning++;
    if (c.state !== CardState.New && !c.suspended) {
      const d = Math.max(0, dayNumber(c.due, settings.dayStartHour) - todayNum);
      if (d < days) forecast[d].count++;
    }
  }

  const history = Array.from({ length: days }, (_, i) => ({ day: i - days + 1, count: 0, timeMs: 0 }));
  const today = { reviews: 0, newCards: 0, timeMs: 0, correct: 0, graded: 0 };
  const retention = { young: { pass: 0, total: 0 }, mature: { pass: 0, total: 0 } };
  const activeDays = new Set<number>();
  const firstSeen = new Map<number, number>();
  for (const l of logs) {
    if (l.kind === 'manual') continue;
    const d = dayNumber(l.id, settings.dayStartHour) - todayNum;
    activeDays.add(d);
    if (!firstSeen.has(l.cardId) || firstSeen.get(l.cardId)! > l.id) firstSeen.set(l.cardId, l.id);
    const h = history[d + days - 1];
    if (h) (h.count++, (h.timeMs += l.durationMs));
    if (d === 0) {
      today.reviews++;
      today.timeMs += l.durationMs;
      today.graded++;
      if (l.rating > 1) today.correct++;
    }
    if (l.kind === 'review' && d > -days) {
      const bucket = l.lastInterval >= 21 ? retention.mature : retention.young;
      bucket.total++;
      if (l.rating > 1) bucket.pass++;
    }
  }
  // cards whose first-ever answer was today
  const todayCards = [...firstSeen].filter(([, first]) => first >= todayStart).map(([cid]) => cid);
  if (todayCards.length) {
    const before = new Set<number>();
    await db.revlog.where('cardId').anyOf(todayCards).each((l) => {
      if (l.id < todayStart && l.kind !== 'manual') before.add(l.cardId);
    });
    today.newCards = todayCards.length - before.size;
  }
  let streak = 0;
  for (let d = activeDays.has(0) ? 0 : -1; activeDays.has(d); d--) streak++;
  return { today, forecast, history, counts, retention, streak };
}

/** Cheap summary of today's answers for the deck list. */
export async function todaySummary(now = Date.now()): Promise<{ reviews: number; timeMs: number }> {
  const settings = await getSettings();
  let reviews = 0, timeMs = 0;
  await db.revlog.where('id').aboveOrEqual(dayStart(now, settings.dayStartHour)).each((l) => {
    if (l.kind === 'manual') return;
    reviews++;
    timeMs += l.durationMs;
  });
  return { reviews, timeMs };
}
