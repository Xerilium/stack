/**
 * Pure rules for the task detail and the composer: property options and labels, due-date text, agent display names, outcome hints.
 * @req FR:task-detail-design/detail.priority @req FR:task-detail-design/detail.effort @req FR:task-detail-design/detail.due
 * @req FR:task-detail-design/compose.to @req FR:task-detail-design/compose.mode @req FR:task-detail-design/detail.actions
 */
import { effortMinutes, parseRow, PRIORITY, STATUS } from './row';

export interface Option { value: string; name: string }
const vs = (s: string) => s.replace(/️/g, '');

/** `None` clears the marker. */
export const PRIORITY_OPTIONS: Option[] = [
  { value: '🚨', name: 'Critical' }, { value: '‼️', name: 'High' }, { value: 'None', name: 'Normal' }, { value: '🔻', name: 'Low' },
];
const PRIORITY_ALL: Option[] = [...PRIORITY_OPTIONS, { value: '🔺', name: 'Raised' }];
export const EFFORT_OPTIONS: Option[] = [
  { value: '🟢', name: '30 min' }, { value: '🟡', name: '1 hour' }, { value: '🟠', name: '2 hours' }, { value: '🔴', name: '4 hours' }, { value: '⚫️', name: '8+ hours' }, { value: 'None', name: 'None' },
];
const EFFORT_ALL: Option[] = [...EFFORT_OPTIONS, { value: '🔹', name: '12 min' }];

const find = (list: Option[], v: string | undefined, none: Option) => (v ? list.find((o) => vs(o.value) === vs(v)) ?? none : none);
export const priorityOf = (text: string): Option => find(PRIORITY_ALL, parseRow(text).priority, PRIORITY_OPTIONS[2]);
export const effortOf = (text: string): Option => find(EFFORT_ALL, parseRow(text).effort, EFFORT_OPTIONS[5]);

/** The step nearest to `minutes` (30 min at least). */
export function nearestEffort(minutes: number): Option {
  const steps = EFFORT_OPTIONS.filter((o) => o.value !== 'None');
  return steps.reduce((best, o) => (Math.abs(effortMinutes(o.value) - minutes) <= Math.abs(effortMinutes(best.value) - minutes) ? o : best), steps[0]);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DUE_MARK = /📅\s*[A-Za-z]{3}[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\s*(?:-\s*\d{1,2}\s*)?(?:\([^)]*\))?\s*:\s*/u;

/** `Due Nov 2` or `No due date`. The `📅` tag is a due date. */
export const dueLabel = (text: string): string => { const d = parseRow(text).due; return d ? `Due ${d}` : 'No due date'; };

/** The due day as `yyyy-mm-dd` for a date input; '' when absent or unreadable. */
export function dueValue(text: string, now: Date): string {
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(parseRow(text).due ?? '');
  const mo = m ? MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase()) : -1;
  if (!m || mo < 0) return '';
  const y = m[3] ? Number(m[3]) : now.getFullYear();
  return `${y}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Writes `📅 MMM d:` (`, yyyy` when not this year) at the front, or removes the tag with `null`. */
export function withDue(text: string, ymd: string | null, now: Date): string {
  const rest = text.replace(DUE_MARK, '').replace(/\s{2,}/g, ' ').trim();
  if (!ymd) return rest;
  const [y, mo, d] = ymd.split('-').map(Number);
  // After the leading markers (priority, status), as the server writes it: `🚨 📅 Nov 2: Ship it`.
  const marks = new Set([...PRIORITY, ...STATUS].map((c) => vs(c.e)));
  let lead = '';
  for (const m of rest.match(/^(?:\S+\s+)+/u)?.[0].split(/(?<=\s)/) ?? []) { if (!marks.has(vs(m.trim()))) break; lead += m; }
  return `${lead}📅 ${MONTHS[mo - 1]} ${d}${y !== now.getFullYear() ? `, ${y}` : ''}: ${rest.slice(lead.length)}`;
}

/** The name people see: the role when the name is only the slug in another case (`CoS` for `cos`). */
export function displayName(a: { slug: string; name: string; role?: string }): string {
  return a.role && a.name !== a.slug && a.name.toLowerCase() === a.slug.toLowerCase() ? a.role : a.name;
}

export type Mode = 'ask' | 'do';
export const modeHint = (m: Mode, name: string): string =>
  m === 'ask' ? `Ask: ${name} answers here; nothing changes on the task.` : `Do it: ${name} takes the task and starts work; your note goes with it.`;

export const ACTION_HINT = {
  start: 'Start: marks it in progress',
  done: 'Done: checks it off; Undo for 8 s',
  reopen: 'Reopen: marks it not done',
  defer: 'Defer: hides it until a time you pick',
  open: 'Open: shows the full detail',
} as const;
