/**
 * Needs you = agent asks plus the open 🙋 rows in your task files, one ranked list.
 * @req FR:web-shell/state.needs
 */
import type { AskItem } from './asks';
import { dueDays } from './now';
import type { Decision } from './plan';
import { parseRow } from './row';

const DUE_SCORE = 70; // between a normal agent ask (30-60) and a crit one (120)
const BASE = 45;

/** Date text like `Oct 28` as an ISO deadline (end of that day), relative to `now`'s year. */
function dueIso(due: string | undefined, now: Date): string | undefined {
  if (!due) return undefined;
  const days = dueDays(due, now);
  if (days === null) return undefined;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 17, 0);
  return d.toISOString();
}

/** A 🙋 row as an ask from its project's agent. Rank order is kept through the score. */
export function fromDecisions(decisions: Decision[], titles: Map<string, string>, now: Date): AskItem[] {
  return decisions.map((d, i) => {
    const r = parseRow(d.task.text);
    const days = dueDays(r.due, now);
    const overdue = days !== null && days < 0;
    const dueSoon = days !== null && days <= 0;
    const rec = d.recommendation && !/:$/.test(d.recommendation) ? d.recommendation : undefined;
    return {
      key: `task:${d.task.ref}`, ref: d.task.ref, source: 'task', state: 'open',
      ask: r.title || d.task.text, kind: rec ? 'approve' : 'answer', from: `${titles.get(d.task.project) ?? d.task.project} agent`, project: d.task.project,
      why: d.context ? parseRow(d.context.text).title.replace(/\s--\s/g, ' — ') : undefined,
      recommend: rec, by: dueIso(r.due, now), reversible: true, priority: overdue ? 'high' : 'normal', blocks: 0,
      created: '', updated: '', score: (dueSoon ? DUE_SCORE : BASE) - i * 0.01, overdue,
    };
  });
}

/** One list, highest score first, ranks reassigned. */
export function mergeNeeds(asks: AskItem[], decisions: AskItem[]): AskItem[] {
  return [...asks, ...decisions].sort((a, b) => b.score - a.score).map((a, i) => ({ ...a, rank: i + 1 }));
}
