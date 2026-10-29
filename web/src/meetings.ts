/**
 * Meetings and the email block for the day plan. Pure; times are minutes after local midnight.
 * @req FR:web-app/today.meetings @req FR:web-app/today.mail
 */
import { wallMinutes } from './wall';
export interface CalEvent {
  id: string; subject: string; start: string; end: string; allDay: boolean;
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'; cancelled: boolean; online: boolean; organizer?: string; webLink?: string; joinUrl?: string;
}
/** Merged busy time with the events inside it. */
export interface Busy { start: number; end: number; titles: string[]; events: CalEvent[] }

const BLOCKING = new Set(['busy', 'tentative', 'oof']);
const DAY_MIN = 24 * 60;

/** Busy, tentative, and out-of-office events that are not cancelled or all-day, clipped to `days` days from `day`'s midnight and merged. @req FR:home/day.calendar */
export function busyIntervals(events: CalEvent[], day: Date, days = 1): Busy[] {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + days).getTime();
  // Wall-clock minutes (what the plan uses), so a DST day does not shift meetings by an hour; later dates count past 24:00.
  const clockMin = (ms: number) => (ms <= from ? 0 : ms >= to ? days * DAY_MIN - 1 : wallMinutes(new Date(ms), day));
  const raw = events
    .filter((e) => BLOCKING.has(e.showAs) && !e.cancelled && !e.allDay)
    .map((e) => ({ e, start: clockMin(Date.parse(e.start)), end: clockMin(Date.parse(e.end)) }))
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

/** Sorted, merged spans (overlaps counted once). */
export function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Busy minutes inside `[from, to)` (spans must not overlap; merge first). */
export const busyWithin = (busy: { start: number; end: number }[], from: number, to: number): number =>
  busy.reduce((m, b) => m + Math.max(0, Math.min(b.end, to) - Math.max(b.start, from)), 0);

/** Minutes the email block takes: 5 per ask, 15 to 60; none without asks. */
export const emailMinutes = (asks: number): number => (asks <= 0 ? 0 : Math.max(15, Math.min(60, asks * 5)));

/** All-day events worth a line above the plan. */
export const allDay = (events: CalEvent[]): CalEvent[] => events.filter((e) => e.allDay && !e.cancelled);

/** The join link of the first meeting (busy, tentative, or out of office; not all-day or free) on now or starting within `lead` minutes, each event checked on its own. */
export function joinable(events: CalEvent[], now: Date, lead = 10): string | undefined {
  const t = now.getTime();
  return events.find((e) => e.joinUrl && !e.cancelled && !e.allDay && BLOCKING.has(e.showAs) && Date.parse(e.start) - lead * 6e4 <= t && t < Date.parse(e.end))?.joinUrl;
}
