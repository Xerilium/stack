import type { Agent, AgentState, InboxItem, Task } from './types';

/** AI team helpers: labels, recency, and which inbox replies belong to an item. @req FR:web-app/today.agents @req FR:web-app/today.reply */
export const AGENT_LABEL: Record<AgentState, string> = { failing: 'CI failing', waiting: 'Needs you', review: 'Ready for review', merged: 'Merged', ci: 'CI running', working: 'Working', queued: 'Queued' };
const COUNT: [AgentState, string][] = [['waiting', 'need you'], ['failing', 'CI failing'], ['review', 'ready for review'], ['merged', 'merged'], ['ci', 'CI running'], ['working', 'working'], ['queued', 'queued']];

export function ago(iso: string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The newest artifact as one short line. */
export function lastLine(a: Agent, now = new Date()): string {
  const pr = a.prs.map((p) => p.updatedAt).filter((x): x is string => !!x).sort().pop();
  const log = a.last;
  if (pr && (!log || pr > log.at)) return `PR updated ${ago(pr, now)}`;
  if (!log) return '';
  return log.outcome && log.summary ? `${log.outcome}: ${log.summary} · ${ago(log.at, now)}` : `${log.action} ${ago(log.at, now)}`;
}

/** Non-zero counts in attention order. */
export const attention = (items: Agent[]): string[] =>
  COUNT.map(([s, label]) => [items.filter((a) => a.state === s).length, label] as const).filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);

/** Inbox text as the owner typed it: the server stores it markdown-escaped. */
export const unescapeMd = (v: string): string => v.replace(/\\([\\<>[\]`|])/g, '$1');

/** The title's words, without marks, dates, or links. Kept in step with `taskKey` in `src/core/inbox.ts`. */
export const taskKey = (text: string): string =>
  (unescapeMd(text.normalize('NFKC')).replace(/🤖:\S*/gu, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/(?:📅|⏰|💤|🔄)\s*[^:\n]*:/gu, ' ')
    .toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');

/** Open inbox entries for a row: the same title in the same project. Lines move, so the ref alone would land on the wrong row. */
export function repliesFor(items: InboxItem[], t: Pick<Task, 'project' | 'text'>): InboxItem[] {
  const key = taskKey(t.text);
  return key === '' ? [] : items.filter((e) => e.state === 'open' && e.project === t.project && taskKey(e.task) === key);
}
