import { parseRow } from './row';
import type { Task, View } from './types';

/** @req FR:web-app/list.filters */
export interface Filters { q: string; project: string; state: 'open' | 'done' | 'all'; status: string; priority: string; effort: string }

export const NO_FILTERS: Filters = { q: '', project: '', state: 'open', status: '', priority: '', effort: '' };
const VIEWS: View[] = ['home', 'asks', 'sessions', 'today', 'projects', 'list'];
const ALIAS: Record<string, View> = { now: 'home', next: 'home', focus: 'home', capacity: 'projects', all: 'list', stack: 'list', agents: 'sessions' };
const STATES = ['open', 'done', 'all'];
const KEYS = ['q', 'project', 'state', 'status', 'priority', 'effort'] as const;

const marker = (want: string, have: string | undefined) => (want === 'None' ? have === undefined : have === want);

export function applyFilters(tasks: Task[], f: Filters): Task[] {
  const q = f.q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.state !== 'all' && (f.state === 'done') !== t.done) return false;
    if (f.project && t.project !== f.project) return false;
    if (q && !t.text.toLowerCase().includes(q)) return false;
    if (!f.status && !f.priority && !f.effort) return true;
    const r = parseRow(t.text);
    return (!f.status || marker(f.status, r.status)) && (!f.priority || marker(f.priority, r.priority)) && (!f.effort || marker(f.effort, r.effort));
  });
}

export function buildHash(view: View, f: Filters): string {
  const p = new URLSearchParams();
  for (const k of KEYS) if (f[k] !== NO_FILTERS[k]) p.set(k, f[k]);
  const qs = p.toString();
  return `#/${view}${qs ? `?${qs}` : ''}`;
}

export function parseHash(hash: string): { view: View; filters: Filters } {
  const m = /^#\/([a-z]+)(?:\?(.*))?$/.exec(hash);
  const name = m?.[1] ?? '';
  const view: View = ALIAS[name] ?? ((VIEWS as string[]).includes(name) ? (name as View) : 'home');
  const filters: Filters = { ...NO_FILTERS };
  if (view === 'list') {
    const p = new URLSearchParams(m?.[2] ?? '');
    for (const k of KEYS) {
      const v = p.get(k);
      if (v === null) continue;
      if (k === 'state') { if (STATES.includes(v)) filters.state = v as Filters['state']; } else filters[k] = v;
    }
  }
  return { view, filters };
}
