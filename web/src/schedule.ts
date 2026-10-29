import { DEFAULT_DAY, type Day, type DayBlock } from './plan';
import { wallMinutes } from './wall';

/** `GET /schedule`: the waking day, instants in UTC. @req FR:home/day.frame */
export interface DaySched {
  timezone: string; date: string; wake: string; bed: string; asleep: boolean;
  blocks: { name: string; label?: string; emoji: string; kind: 'focus' | 'personal' | 'sleep'; start: string; end: string }[];
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export { wallMinutes };

const originOf = (s: DaySched) => { const [y, m, d] = s.date.split('-').map(Number); return new Date(y, m - 1, d); };

/** The plan's day from the schedule: wake to bed on the day's own clock; 9-18 today without one. @req FR:home/day.frame @req FR:home/day.asleep */
export function dayFrame(s: DaySched | null): Day {
  if (!s) return DEFAULT_DAY;
  const origin = originOf(s);
  const at = (v: string) => wallMinutes(new Date(v), origin);
  const blocks: DayBlock[] = s.blocks.filter((b) => b.kind !== 'sleep').map((b) => ({ name: b.name, ...(b.label ? { label: b.label } : {}), emoji: b.emoji, kind: b.kind as DayBlock['kind'], start: at(b.start), end: at(b.end) }));
  return { start: at(s.wake), end: at(s.bed), origin, blocks, ...(s.asleep ? { asleep: true } : {}) };
}

/** Range for `GET /calendar`: the waking day, else the calendar day of `now`. @req FR:home/day.calendar */
export function calendarRange(s: DaySched | null, now: Date): { from: string; to: string } {
  if (s) return { from: new Date(s.wake).toISOString(), to: new Date(s.bed).toISOString() };
  const d = midnight(now);
  return { from: d.toISOString(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString() };
}

/** True once the answer is out of date: past bed, before wake on a day you are awake, or past wake on a day you were asleep. @req FR:home/day.refresh */
export function needsRefresh(s: DaySched | null, now: Date): boolean {
  if (!s) return false;
  const t = now.getTime();
  return t >= Date.parse(s.bed) || (s.asleep ? t >= Date.parse(s.wake) : t < Date.parse(s.wake));
}
