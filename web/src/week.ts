import { dueDays } from './now';
import { DEFAULT_DAY, planCandidates, planStart, type Day } from './plan';
import { effortMinutes, parseRow } from './row';
import type { Task } from './types';

/** Time available vs planned work, day by day through the week. @req FR:web-app/week.days @req FR:web-app/week.plan @req FR:web-app/week.summary */
export interface WeekDay { date: Date; available: number; planned: number; over: number; today: boolean }
export interface Week { days: WeekDay[]; available: number; planned: number; leftover: number }

const CHUNK = 120;
const DEFAULT_MIN = 30;

/** Today through Sunday; on Saturday or Sunday, through next Friday. */
export function weekDates(now: Date): Date[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = start.getDay(); // 0 Sun .. 6 Sat
  const count = dow === 6 ? 7 : dow === 0 ? 6 : 8 - dow;
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const workday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

/** Plans the week: due tasks on their day (overdue on today), then ranked work fills what is left, at most 2 h of a task per day. */
export function planWeek(tasks: Task[], now: Date, todayBudget?: number, day: Day = DEFAULT_DAY): Week {
  const dates = weekDates(now);
  const days: WeekDay[] = dates.map((date, i) => ({
    date, today: i === 0, planned: 0, over: 0,
    available: i === 0 ? (todayBudget ?? (workday(date) ? Math.max(0, day.end - planStart(now, day)) : 0)) : workday(date) ? day.end - day.start : 0,
  }));
  const minutesOf = (t: Task) => effortMinutes(parseRow(t.text).effort) || DEFAULT_MIN;
  const ranked = planCandidates(tasks, now);
  const floating: { t: Task; left: number }[] = [];
  for (const t of ranked) {
    const d = dueDays(parseRow(t.text).due, now);
    if (d !== null && d < days.length && d >= -30) days[Math.max(0, d)].planned += minutesOf(t);
    else floating.push({ t, left: minutesOf(t) });
  }
  let leftover = 0;
  for (const f of floating) {
    for (const d of days) {
      if (f.left <= 0) break;
      const room = d.available - d.planned;
      if (room <= 0) continue;
      const take = Math.min(f.left, CHUNK, room);
      d.planned += take;
      f.left -= take;
    }
    leftover += f.left;
  }
  for (const d of days) d.over = Math.max(0, d.planned - d.available);
  return { days, available: days.reduce((s, d) => s + d.available, 0), planned: days.reduce((s, d) => s + d.planned, 0), leftover };
}
