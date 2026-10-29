/**
 * Meetings and the email block for the day plan. Pure; times are minutes after local midnight.
 * @req FR:web-app/today.meetings @req FR:web-app/today.mail
 */
export interface CalEvent {
  id: string; subject: string; start: string; end: string; allDay: boolean;
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'; cancelled: boolean; online: boolean; organizer?: string; webLink?: string;
}
/** Merged busy time with the events inside it. */
export interface Busy { start: number; end: number; titles: string[]; events: CalEvent[] }

const BLOCKING = new Set(['busy', 'tentative', 'oof']);
const DAY_MIN = 24 * 60;

/** Busy, tentative, and out-of-office events that are not cancelled or all-day, clipped to `day` and merged. */
export function busyIntervals(events: CalEvent[], day: Date): Busy[] {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const raw = events
    .filter((e) => BLOCKING.has(e.showAs) && !e.cancelled && !e.allDay)
    .map((e) => ({ e, start: Math.max(0, Math.round((Date.parse(e.start) - midnight) / 6e4)), end: Math.min(DAY_MIN - 1, Math.round((Date.parse(e.end) - midnight) / 6e4)) }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Busy[] = [];
  for (const x of raw) {
    const last = out[out.length - 1];
    if (last && x.start < last.end) { last.end = Math.max(last.end, x.end); last.titles.push(x.e.subject); last.events.push(x.e); }
    else out.push({ start: x.start, end: x.end, titles: [x.e.subject], events: [x.e] });
  }
  return out;
}

/** Busy minutes inside `[from, to)`. */
export const busyWithin = (busy: Busy[], from: number, to: number): number =>
  busy.reduce((m, b) => m + Math.max(0, Math.min(b.end, to) - Math.max(b.start, from)), 0);

/** Minutes the email block takes: 5 per ask, 15 to 60; none without asks. */
export const emailMinutes = (asks: number): number => (asks <= 0 ? 0 : Math.max(15, Math.min(60, asks * 5)));

/** All-day events worth a line above the plan. */
export const allDay = (events: CalEvent[]): CalEvent[] => events.filter((e) => e.allDay && !e.cancelled);
