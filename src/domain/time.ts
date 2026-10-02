// Study-day arithmetic. A study day starts at `dayStartHour` local time (default 4 a.m.),
// so late-night reviews count toward the day you're still awake in.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Start (epoch ms) of the study day containing `now`. */
export function dayStart(now: number, dayStartHour: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0, 0).getTime();
  return now >= start ? start : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, dayStartHour).getTime();
}

/** End (exclusive) of the study day containing `now`. */
export function dayEnd(now: number, dayStartHour: number): number {
  const s = new Date(dayStart(now, dayStartHour));
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, dayStartHour).getTime();
}

/** Integer study-day number (days since a fixed local epoch). Stable across DST. */
export function dayNumber(now: number, dayStartHour: number): number {
  const s = new Date(dayStart(now, dayStartHour));
  return Math.round(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()) / DAY);
}

/** Human-friendly interval label used on answer buttons: 1m, 10m, 3h, 4d, 2.5mo, 1.2y. */
export function formatInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
