/**
 * Quick triage on the web: where you are in a flow, what an action did, what can be undone.
 * @req FR:quick-triage/web.stepper @req FR:quick-triage/web.undo @req FR:quick-triage/web.done
 */
import type { AskItem } from './asks';

export interface FlowPos { flow: string; step: number; total: number; done: number }
export function flowOf(a: Pick<AskItem, 'flow' | 'seq' | 'flowTotal' | 'flowDone'>): FlowPos | null {
  if (!a.flow) return null;
  return { flow: a.flow, step: a.seq ?? 1, total: a.flowTotal ?? 1, done: a.flowDone ?? 0 };
}

const PRIORITY: Record<string, string> = { '🚨': 'Critical', '‼️': 'High', '🔺': 'Raised', '🔻': 'Low' };
const STATUS: Record<string, string> = { '🚧': 'In progress', '⏸️': 'Paused', '👀': 'Review', '⏳': 'Waiting', '⛔️': 'Blocked' };
const EFFORT: Record<string, string> = { '🔹': '12 min', '🟢': '30 min', '🟡': '1 hour', '🟠': '2 hours', '🔴': '4 hours', '⚫️': '8 hours' };
const IMPACT: Record<string, string> = { '⬆️': 'High', '↔️': 'Medium', '⬇️': 'Low' };
const NAMES: Record<string, Record<string, string>> = { priority: PRIORITY, status: STATUS, effort: EFFORT, impact: IMPACT };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What an action did, in words: `Priority: Critical · Pay bills`. */
export function changeText(action: string, title: string): string {
  const t = action.trim();
  const [verb, ...rest] = t.split(/\s+/);
  const arg = rest.join(' ');
  let what: string;
  if (t === '-' || t === '') what = 'Answered';
  else if (verb === 'set') {
    what = rest.map((pair) => {
      const [k, v] = pair.split('=');
      if (v === 'None') return `${cap(k)} cleared`;
      return `${cap(k)}: ${NAMES[k]?.[v] ?? v}`;
    }).join(', ');
  } else if (verb === 'due') what = `Due ${arg}`;
  else if (verb === 'suspend') { const m = /^(\d+)([dh])$/.exec(arg); what = m ? `Parked ${m[1]} ${m[2] === 'd' ? (m[1] === '1' ? 'day' : 'days') : (m[1] === '1' ? 'hour' : 'hours')}` : 'Parked'; }
  else if (verb === 'skip') what = 'Skipped';
  else if (verb === 'complete') what = 'Done';
  else if (verb === 'start') what = 'Started';
  else if (verb === 'resume') what = 'Resumed';
  else if (verb === 'note') what = 'Note added';
  else what = cap(verb);
  return `${what} · ${title}`;
}

/** Stack can take these back; skip, due and note stay. @req FR:quick-triage/web.undo */
export const reversible = (action: string): boolean => /^(set |complete$|suspend |start$)/.test(action.trim());
