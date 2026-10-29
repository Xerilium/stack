/**
 * Pure helpers for a task's thread: the item shapes the api returns and how each reads on the page.
 * @req FR:agent-thread/web.expand
 */
import type { AskItem } from './asks';
import type { ReviewItem } from './team';

export type ThreadItem =
  | { at: string; kind: 'owner'; id: string; text: string; state: 'open' | 'handled' }
  | { at: string; kind: 'agent'; id: string; agent: string; text: string }
  | { at: string; kind: 'ask'; ask: AskItem }
  | { at: string; kind: 'review'; verdict: ReviewItem['verdict']; plan: string; estimate?: string; agent: string }
  | { at: string; kind: 'subtask'; ref: string; text: string; done: boolean };
export interface Thread { items: ThreadItem[]; session?: { id: string; title: string; state: string }; review?: ReviewItem }

export const emptyThread = (): Thread => ({ items: [] });

/** `You · 5m ago`, `🎧 Cid Manager · 2m ago`. */
export type Folded = ThreadItem | { at: string; kind: 'subtasks'; count: number; done: number };
export function whoLine(i: Folded, now: Date, agentName: (slug: string) => string): string {
  const when = i.at ? ago(i.at, now) : '';
  if (i.kind === 'subtasks') return `The agent added ${i.count} ${i.count === 1 ? 'subtask' : 'subtasks'}${i.done ? ` · ${i.done} done` : ''}${when ? ` · ${when}` : ''}`;
  if (i.kind === 'owner') return `You${when ? ` · ${when}` : ''}`;
  if (i.kind === 'agent') return `${agentName(i.agent)}${when ? ` · ${when}` : ''}`;
  if (i.kind === 'review') return `${agentName(i.agent)} reviewed${when ? ` · ${when}` : ''}`;
  if (i.kind === 'ask') return `${agentName(i.ask.from)} asks${when ? ` · ${when}` : ''}`;
  return 'Subtask';
}

export function ago(iso: string, now: Date): string {
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The verdict as one line. */
export const verdictLine = (i: Extract<ThreadItem, { kind: 'review' }>): string =>
  `${i.verdict === 'can' ? 'Can do' : i.verdict === 'partial' ? 'Partly' : "Can't"}${i.estimate ? ` · ${i.estimate}` : ''}: ${i.plan}`;

/** Subtasks fold into one line (`The agent added 3 subtasks · 1 done`); everything else stays an entry. */
export function foldSubtasks(items: ThreadItem[]): Folded[] {
  const subs = items.filter((i): i is Extract<ThreadItem, { kind: 'subtask' }> => i.kind === 'subtask');
  const rest = items.filter((i) => i.kind !== 'subtask');
  return subs.length ? [...rest, { at: '', kind: 'subtasks', count: subs.length, done: subs.filter((s) => s.done).length }] : rest;
}

/** What the composer does with the text: a follow-up to the task's idle session, else a new session. */
export const canFollowUp = (t: Thread): boolean => !!t.session && (t.session.state === 'idle' || t.session.state === 'stale');
/** The session a question goes to: the task's idle session when it belongs to the chosen agent (its title starts with the agent's name), else none (a new session starts). @req FR:agent-thread/thread.ask */
export function followUpSession(t: Thread, chosenName?: string): Thread['session'] | undefined {
  if (!canFollowUp(t) || !t.session) return undefined;
  return !chosenName || t.session.title.startsWith(`${chosenName} · `) ? t.session : undefined;
}
