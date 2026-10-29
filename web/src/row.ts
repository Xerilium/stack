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
  /** 🎯 outcome row. */ outcome?: boolean;
  /** Who does it: 🤖/🪄 an agent, 🙋 the human. */ who?: 'agent' | 'human';
  /** Links lifted out of the title. */ links: { href: string; label: string }[];
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
  const row: Row = { title: '', links: [] };
  const take = (re: RegExp, key: 'due' | 'recurrence' | 'suspend' | 'start') => {
    s = s.replace(re, (_m, v: string) => { row[key] ??= v.trim(); return ' '; });
  };
  take(/💤\s*([A-Za-z]{3}\s+\d{1,2}(?:\s+\d{1,2}:\d{2})?|\d{1,2}:\d{2}):/g, 'suspend');
  take(/⏰\s*([A-Za-z]{3}\s+\d{1,2}(?:,\s*\d{4})?):/g, 'start');
  take(/📅\s*([^:]+?):/g, 'due');
  take(/🔄\s*([^:]+?):/g, 'recurrence');
  for (const [key, set] of [['status', STATUS], ['priority', PRIORITY], ['effort', [...EFFORT, { e: '🔹', name: '12 min' }]], ['impact', IMPACT]] as const) {
    const r = pull(s, set as Choice[]);
    s = r.rest;
    if (r.value) row[key] = r.value;
  }
  if (/🎯/u.test(s)) { row.outcome = true; s = s.replace(/🎯/gu, ' '); }
  if (/[🤖🪄]/u.test(s)) { row.who = 'agent'; s = s.replace(/[🤖🪄]/gu, ' '); } else if (/🙋/u.test(s)) { row.who = 'human'; s = s.replace(/🙋/gu, ' '); }
  s = s.replace(/\((?:is|label|author|state|milestone|-?reviewed-by):[^)]*\)/g, ' '); // saved GitHub queries
  s = s.replace(/[💰⚠😊⏱🌱🏃🌟]/gu, ' '); // project-value marks feed ranking; they are noise in a row
  const md: string[] = []; // markdown links stay in the title as written
  s = s.replace(/\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\)/g, (m) => `\uE000${md.push(m) - 1}\uE000`);
  const lift = (href: string): boolean => { try { row.links.push({ href, label: new URL(href).hostname.replace(/^www\./, '') }); return true; } catch { return false; } };
  s = s.replace(/\(\s*(https?:\/\/[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)\s*\)/g, (m, href: string) => (lift(href) ? ' ' : m)); // a link alone in parens takes them along
  s = s.replace(/(?:@\s*)?<?(https?:\/\/[^\s<>\]]+)>?/g, (m, raw: string) => {
    let href = raw, tail = '';
    const count = (c: string) => href.split(c).length - 1;
    for (;;) { // trailing punctuation, and a ) the URL did not open, are text
      if (/[,.;:!?]$/.test(href)) { tail = href.slice(-1) + tail; href = href.slice(0, -1); } else if (href.endsWith(')') && count(')') > count('(')) { href = href.slice(0, -1); tail = `)${tail}`; } else break;
    }
    return lift(href) ? ` ${tail}` : m;
  });
  s = s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => md[Number(i)]);
  row.title = s.replace(/🔎/gu, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();
  return row;
}
