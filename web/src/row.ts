/** Read the emoji markers in a task row. @req FR:web-app/row.parse @req FR:web-app/row.effort */
export interface Choice { e: string; name: string }

export const STATUS: Choice[] = [
  { e: '🚧', name: 'In progress' }, { e: '⏸️', name: 'Paused' }, { e: '👀', name: 'In review' }, { e: '⏳', name: 'Waiting' }, { e: '⛔️', name: 'Blocked' },
];
export const PRIORITY: Choice[] = [
  { e: '🚨', name: 'Critical' }, { e: '‼️', name: 'High' }, { e: '🔺', name: 'Raised' }, { e: '🔻', name: 'Lowered' },
];
export const EFFORT: Choice[] = [
  { e: '🟢', name: '30 min' }, { e: '🟡', name: '1 hour' }, { e: '🟠', name: '2 hours' }, { e: '🔴', name: '4 hours' }, { e: '⚫️', name: '8+ hours' },
];
export const IMPACT: Choice[] = [
  { e: '⬆️', name: 'High impact' }, { e: '↔️', name: 'Medium impact' }, { e: '⬇️', name: 'Low impact' },
];

const MINUTES: Record<string, number> = { '🔹': 12, '🟢': 30, '🟡': 60, '🟠': 120, '🔴': 240, '⚫️': 480 };
const vs = (s: string) => s.replace(/️/g, '');
const MIN_BY_KEY = new Map(Object.entries(MINUTES).map(([k, v]) => [vs(k), v]));

/** Minutes for an effort emoji; 0 when unknown. */
export const effortMinutes = (e: string | undefined): number => (e ? MIN_BY_KEY.get(vs(e)) ?? 0 : 0);

export interface Row {
  status?: string; priority?: string; effort?: string; impact?: string;
  due?: string; recurrence?: string; suspend?: string; start?: string;
  title: string;
}

function pull(s: string, set: Choice[]): { value?: string; rest: string } {
  let value: string | undefined;
  let rest = s;
  for (const c of set) {
    const k = vs(c.e);
    if (rest.includes(k)) { value ??= c.e; rest = rest.split(k).join(' '); }
  }
  return { value, rest };
}

export function parseRow(text: string): Row {
  let s = vs(text);
  const row: Row = { title: '' };
  const take = (re: RegExp, key: 'due' | 'recurrence' | 'suspend' | 'start') => {
    s = s.replace(re, (_m, v: string) => { row[key] ??= v.trim(); return ' '; });
  };
  take(/💤\s*([A-Za-z]{3}\s+\d{1,2}(?:\s+\d{1,2}:\d{2})?|\d{1,2}:\d{2}):/g, 'suspend');
  take(/⏰\s*([A-Za-z]{3}\s+\d{1,2}):/g, 'start');
  take(/📅\s*([^:]+?):/g, 'due');
  take(/🔄\s*([^:]+?):/g, 'recurrence');
  for (const [key, set] of [['status', STATUS], ['priority', PRIORITY], ['effort', [...EFFORT, { e: '🔹', name: '12 min' }]], ['impact', IMPACT]] as const) {
    const r = pull(s, set as Choice[]);
    s = r.rest;
    if (r.value) row[key] = r.value;
  }
  row.title = s.replace(/\s+/g, ' ').trim();
  return row;
}
