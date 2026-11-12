/**
 * The Now screen: one task from Home's own ranking, and the one line that says why it is next. Pure; the view only draws it.
 * @req FR:now-screen/now.one @req FR:now-screen/now.why
 */
import { topAsksOf, type Home, type HomeItem } from './home';
import { span } from './plan';
import { parseRow } from './row';
import { isWithdrawn, type ThreadItem } from './thread';
import type { Task } from './types';

/** The longest "why now" line. @req FR:now-screen/now.why */
export const WHY_MAX = 60;

export interface NowTask { task: Task; title: string; why: string }

/** The two strongest reasons the task is next, then whether it fits the time left. */
export function whyLine(item: HomeItem, minutesLeft: number, agentHasIt = false): string {
  const r = parseRow(item.task.text);
  const factors: string[] = [];
  if (item.due && item.due.tone !== 'calm') factors.push(item.due.tone === 'late' ? item.due.text : `due ${item.due.text}`);
  else if (item.due) factors.push(`due ${item.due.text}`);
  if (r.priority && /^(🚨|‼)/u.test(r.priority)) factors.push(r.priority.startsWith('🚨') ? 'critical' : 'high priority');
  if (r.status && r.status.startsWith('🚧')) factors.push('in progress');
  if (agentHasIt) factors.push('agent has it');
  const top = factors.slice(0, 2);
  const fit = minutesLeft <= 0 ? null : item.minutes <= minutesLeft ? `fits your ${span(minutesLeft)}` : `needs ${span(item.minutes)}, ${span(minutesLeft)} left`;
  const line = [...(top.length ? top : ['top of your stack']), ...(fit ? [fit] : [])].join(' · ');
  return line.length <= WHY_MAX ? line : top.join(' · ').slice(0, WHY_MAX);
}

/** The one task now: what Home shows as NOW (the task that fits when the first does not). null = nothing to do. */
export function nowOf(h: Home, minutesLeft: number, agentHasIt: (t: Task) => boolean = () => false): NowTask | null {
  const item = topAsksOf(h).top;
  if (!item) return null;
  const r = parseRow(item.task.text);
  return { task: item.task, title: r.title || item.task.text, why: whyLine(item, minutesLeft, agentHasIt(item.task)) };
}

/** Inbox text is one line, at most 1000 characters. @req FR:now-screen/now.compose */
export const TELL_MAX = 1000;
/** The box text as one inbox line: lines trimmed, blank ones dropped, joined with ` / `. */
export const foldLines = (text: string): string => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' / ').slice(0, TELL_MAX);
/** The task's earlier instructions and agent replies, oldest first. @req FR:now-screen/now.thread */
export const tellThread = (items: ThreadItem[]): Extract<ThreadItem, { kind: 'owner' | 'agent' }>[] =>
  items.filter((i): i is Extract<ThreadItem, { kind: 'owner' | 'agent' }> => (i.kind === 'owner' || i.kind === 'agent') && !isWithdrawn(i)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

/** The row once an agent takes it: 🪄 in front; a 🙋 mark goes, since inbox routing reads 🙋 first. @req FR:now-screen/now.compose */
export const agentMark = (text: string): string => `🪄 ${text.includes('🙋') ? text.replace(/\s*🙋\s*/gu, ' ').trim() : text}`;
