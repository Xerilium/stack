/**
 * Weekly meetings (`.stack/meetings.md`) as calendar events, and live events enriched with owner and topic. Pure.
 * @req FR:cos-view/meet.expand @req FR:cos-view/meet.enrich
 */
import type { CalEvent } from './meetings';

/** One weekly meeting, as `GET /meetings` returns it. `days` 0 = Sunday; times are local `HH:mm`. */
export interface Rule { title: string; days: number[]; start: string; end: string; biweekly?: boolean; topic?: string; owner?: string; join?: string }

/** ISO 8601 week number of a local date. */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
const at = (day: Date, hhmm: string, plusDays = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + plusDays, h, m);
};

/** Events for `days` local days from `day`, and the spill of the day before (a meeting that crosses midnight). */
export function expandWeekly(rules: Rule[], day: Date, days = 1): CalEvent[] {
  const out: CalEvent[] = [];
  for (let offset = -1; offset < days; offset++) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
    for (const r of rules) {
      if (!r.days.includes(d.getDay()) || (r.biweekly && isoWeek(d) % 2 !== 0)) continue;
      const start = at(d, r.start), end = at(d, r.end, r.end <= r.start ? 1 : 0);
      if (offset === -1 && end.getTime() <= new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) continue;
      out.push({
        id: `weekly:${r.title}:${start.toISOString()}`, subject: r.title, start: start.toISOString(), end: end.toISOString(), allDay: false, showAs: 'busy', cancelled: false,
        online: !!r.join, ...(r.join ? { joinUrl: r.join } : {}), ...(r.owner ? { owner: r.owner } : {}), ...(r.topic ? { topic: r.topic } : {}),
      });
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Adds owner, topic, and (when the event has none) join link from the rule whose title matches. */
export function enrich(events: CalEvent[], rules: Rule[]): CalEvent[] {
  const norm = (s: string) => s.trim().toLowerCase();
  return events.map((e) => {
    const s = norm(e.subject);
    const r = s ? rules.find((x) => { const t = norm(x.title); return s.includes(t) || t.includes(s); }) : undefined;
    if (!r) return e;
    return { ...e, ...(r.owner ? { owner: r.owner } : {}), ...(r.topic ? { topic: r.topic } : {}), ...(!e.joinUrl && r.join ? { joinUrl: r.join } : {}) };
  });
}
