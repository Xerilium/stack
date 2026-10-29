/**
 * The owner's waking day from the time blocks: wake, bed, and what each block of time is for. Pure.
 * @req FR:schedule/profile.day @req FR:schedule/profile.wake @req FR:schedule/profile.contain @req FR:schedule/profile.nosleep @req FR:schedule/profile.dst
 */
import type { BlockKind, StackConfig, TimeBlock } from './config';

export interface ScheduleBlock { name: string; label?: string; emoji: string; kind: BlockKind; start: string; end: string }
/** Wake and bed overrides, `HH:mm` local; a bed at or before wake is the next morning. @req FR:schedule/profile.override */
export interface DayTimes { wake?: string; bed?: string }
export interface ScheduleOverrides { dates?: Record<string, DayTimes>; weekdays?: Record<string, DayTimes> }

export interface DaySchedule { date: string; wake: string; bed: string; asleep: boolean; blocks: ScheduleBlock[] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NO_SLEEP_DAY_MIN = 16 * 60;
/** Sleep shorter than this is a nap: it does not start or end the day. */
const MAIN_SLEEP_MIN = 3 * 60;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** A block's kind: set, else sleep by name, label, or 😴, else focus. @req FR:schedule/profile.kind */
export function blockKind(b: TimeBlock): BlockKind {
  if (b.kind) return b.kind;
  return /sleep/i.test(b.name) || /sleep/i.test(b.label ?? '') || b.emoji.replace(/️/g, '') === '😴' ? 'sleep' : 'focus';
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** UTC offset of `tz` at `ms`, in ms. */
function offset(ms: number, tz: string): number {
  let f = formats.get(tz);
  if (!f) formats.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const p = f.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
}

/** A local calendar date: `y-m-d` as a UTC midnight, so day arithmetic is exact. */
type LocalDate = number;
const localDate = (ms: number, tz: string): LocalDate => { const d = new Date(ms + offset(ms, tz)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const addDays = (d: LocalDate, n: number): LocalDate => d + n * 864e5;
const iso = (d: LocalDate) => new Date(d).toISOString().slice(0, 10);

/**
 * The instant of wall-clock `minutes` after local midnight of `d` (may pass 24:00). A time that occurs twice (fall back)
 * is its first occurrence; a time that does not exist (spring forward) moves forward by the gap, so 02:00 is 03:00.
 */
function at(d: LocalDate, minutes: number, tz: string): number {
  const wall = d + minutes * 6e4;
  const before = offset(wall - 12 * 36e5, tz), after = offset(wall + 12 * 36e5, tz);
  const fits = (o: number) => offset(wall - o, tz) === o;
  if (fits(before)) return wall - before;
  if (fits(after)) return wall - after;
  return wall - before;
}

interface Span { start: number; end: number; block: TimeBlock }
/** Occurrences of every block on local dates `from..to` (an overnight block belongs to the date it starts on). */
function occurrences(blocks: TimeBlock[], from: LocalDate, to: LocalDate, tz: string): Span[] {
  const out: Span[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = DAYS[new Date(d).getUTCDay()];
    for (const b of blocks) {
      if (!b.days.includes(dow)) continue;
      const s = mins(b.startTime), e = mins(b.endTime);
      out.push({ start: at(d, s, tz), end: at(d, e > s ? e : e + 24 * 60, tz), block: b });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function merge(spans: Span[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** The waking day that contains `at`, or the next one when `at` is in sleep time. */
export function daySchedule(config: StackConfig, when: Date, overrides: ScheduleOverrides = {}, on?: string): DaySchedule {
  const tz = config.timezone;
  const now = when.getTime();
  const today = localDate(now, tz);
  const spans = occurrences(config.timeBlocks, addDays(today, -3), addDays(today, 3), tz);
  const merged = merge(spans.filter((s) => blockKind(s.block) === 'sleep'));
  const sleep = merged.filter((s) => s.end - s.start >= MAIN_SLEEP_MIN * 6e4);
  const naps = merged.filter((s) => !sleep.includes(s));
  // A day runs from the main sleep that ends on its date to the next main sleep, at most a day later; else 16 hours.
  const windowOf = (d: LocalDate): { wake: number; bed: number } => {
    const ending = sleep.filter((s) => localDate(s.end, tz) === d);
    const wake = ending.length ? ending[ending.length - 1].end : at(d, mins(config.startOfDay), tz);
    const next = sleep.find((s) => s.start >= wake)?.start ?? Infinity;
    const cap = wake + NO_SLEEP_DAY_MIN * 6e4;
    const base = { wake, bed: ending.length && next <= wake + 864e5 ? next : Math.min(next, cap) };
    // Overrides: the date's, then the weekday's, field by field. @req FR:schedule/profile.override
    const o: DayTimes = { ...overrides.weekdays?.[DAYS[new Date(d).getUTCDay()]], ...overrides.dates?.[iso(d)] };
    if (!o.wake && !o.bed) return base;
    const w = o.wake ? at(d, mins(o.wake), tz) : base.wake;
    const wakeMin = Math.round((w + offset(w, tz) - d) / 6e4);
    const bedMin = o.bed ? mins(o.bed) + (mins(o.bed) <= wakeMin ? 1440 : 0) : null;
    return { wake: w, bed: bedMin === null ? base.bed : at(d, bedMin, tz) };
  };
  let date = today, asleep = false;
  let win = windowOf(addDays(today, -1));
  if (on) { date = Date.parse(`${on}T00:00:00Z`); win = windowOf(date); }
  else if (!(win.wake <= now && now < win.bed)) {
    win = windowOf(today);
    if (now < win.wake) asleep = true;
    else if (now >= win.bed) { asleep = true; date = addDays(today, 1); win = windowOf(date); }
  } else date = addDays(today, -1);
  // Naps inside the day are not task time: they come back as personal time.
  const isNap = (s: Span) => naps.some((n) => s.start >= n.start && s.end <= n.end);
  const blocks = spans
    .filter((s) => (blockKind(s.block) !== 'sleep' || isNap(s)) && s.end > win.wake && s.start < win.bed)
    .map((s) => ({
      name: s.block.name, ...(s.block.label ? { label: s.block.label } : {}), emoji: s.block.emoji, kind: blockKind(s.block) === 'sleep' ? 'personal' as const : blockKind(s.block),
      start: new Date(Math.max(s.start, win.wake)).toISOString(), end: new Date(Math.min(s.end, win.bed)).toISOString(),
    }));
  return { date: iso(date), wake: new Date(win.wake).toISOString(), bed: new Date(win.bed).toISOString(), asleep, blocks };
}

/** The waking day that starts on a local date (`YYYY-MM-DD`), whatever the instant. @req FR:schedule/api.override */
export const dayScheduleOn = (config: StackConfig, date: string, overrides: ScheduleOverrides = {}): DaySchedule =>
  daySchedule(config, new Date(`${date}T12:00:00Z`), overrides, date);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
/** Saved overrides with every bad entry dropped (a hand edit never breaks the schedule). @req FR:schedule/profile.override */
export function cleanOverrides(v: unknown): ScheduleOverrides {
  const times = (t: unknown): DayTimes | null => {
    if (!t || typeof t !== 'object') return null;
    const o = t as Record<string, unknown>;
    const out: DayTimes = { ...(typeof o.wake === 'string' && HHMM.test(o.wake) ? { wake: o.wake } : {}), ...(typeof o.bed === 'string' && HHMM.test(o.bed) ? { bed: o.bed } : {}) };
    return out.wake || out.bed ? out : null;
  };
  const pick = (m: unknown, ok: (k: string) => boolean) => {
    const out: Record<string, DayTimes> = {};
    if (m && typeof m === 'object') for (const [k, t] of Object.entries(m)) { const c = times(t); if (ok(k) && c) out[k] = c; }
    return out;
  };
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const dates = pick(o.dates, (k) => DATE.test(k)), weekdays = pick(o.weekdays, (k) => DAYS.includes(k));
  return { ...(Object.keys(dates).length ? { dates } : {}), ...(Object.keys(weekdays).length ? { weekdays } : {}) };
}
