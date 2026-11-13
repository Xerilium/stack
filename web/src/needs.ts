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

/** @req FR:web-shell/state.needs.row — a 🙋 row as an ask from its project's agent. Rank order is kept through the score. */
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

/** One escalation from the Chief of Staff (`.stack/needs-you.json`). @req FR:ask-queue/$need */
export interface NeedItem {
  id: string; title: string; recommendation: string; default?: string; by?: string; link: string; project?: string; ref?: string;
  /** A PR priority recommendation: the route that takes accept, edit or reject. No undo, no defer. @req FR:pr-priority/needs.actions */
  decide?: string;
  answer?: { choice: 'go' | 'defer' | 'reply'; text?: string; until?: string; at: string };
}

/**
 * The open escalations as asks from the Chief of Staff, ahead of everything else, in file order.
 * An answered one is gone until a deferral passes its `until`.
 * @req FR:ask-queue/needs.web @req FR:ask-queue/needs.web.card
 */
export function fromNeeds(items: NeedItem[], now: Date): AskItem[] {
  return items.filter((n) => !n.answer || (n.answer.choice === 'defer' && !(Date.parse(n.answer.until ?? '') > now.getTime()))).map((n, i) => ({
    key: `need:${n.id}`, source: 'need' as const, state: 'open' as const, ask: n.title, kind: 'approve' as const, from: 'Chief of Staff', project: n.project, ref: n.ref,
    recommend: n.recommendation, default: n.default, by: n.by, link: n.link, reversible: !n.decide && !n.id.startsWith('lv.'), ...(n.decide ? { decide: n.decide } : {}), priority: 'high' as const, blocks: 0,
    created: '', updated: '', score: 1000 - i, overdue: !!n.by && new Date(n.by).getTime() < now.getTime(),
  }));
}
