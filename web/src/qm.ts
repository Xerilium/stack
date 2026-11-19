/**
 * The weekly QM (quota-maxxing) plan page: types, sort, and the read client for `/qm`.
 * @req FR:qm-plan/ui.route @req FR:qm-plan/ui.sort @req FR:qm-plan/ui.table
 */
import { fmtTokens } from './sessions';

export interface QmTask { title: string; url?: string }
export interface QmRow { project: string; agent: { name: string; sessionId?: string; url?: string }; tasks: QmTask[]; weeklyTokens: number | null; preAckMin: number | null; postReviewMin: number | null }
export interface QmPlan { version: 1; asOf: string; projects: QmRow[] }
export type QmCol = 'project' | 'agent' | 'tasks' | 'weeklyTokens' | 'preAckMin' | 'postReviewMin';
export type Dir = 'asc' | 'desc';

export const COLS: { id: QmCol; label: string; num: boolean }[] = [
  { id: 'project', label: 'Project', num: false },
  { id: 'agent', label: 'Agent', num: false },
  { id: 'tasks', label: 'Top 5', num: true },
  { id: 'weeklyTokens', label: 'Weekly tokens', num: true },
  { id: 'preAckMin', label: 'Pre-ack min', num: true },
  { id: 'postReviewMin', label: 'Post-review min', num: true },
];

/** `#/qm` (with an optional query) shows the plan page. @req FR:qm-plan/ui.route */
export const isQmHash = (h: string): boolean => /^#\/qm(\?|$)/.test(h);

const key = (r: QmRow, c: QmCol): string | number | null => (c === 'project' ? r.project : c === 'agent' ? r.agent.name : c === 'tasks' ? r.tasks.length : r[c]);

/** A sorted copy; text sorts case-insensitive; pending (null) sorts last in both directions. @req FR:qm-plan/ui.sort */
export function sortRows(rows: QmRow[], col: QmCol, dir: Dir): QmRow[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a, col), y = key(b, col);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return m * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' }));
  });
}

/** `2000000` → `2,000,000`; null → `Pending`. */
export const numText = (v: number | null): string => (v === null ? 'Pending' : v.toLocaleString('en-US'));

/** Compact token count, as the Agents view shows it: `25000000` → `25M`; null → `Pending`. @req FR:qm-plan/ui.table */
export const tokText = (v: number | null): string => (v === null ? 'Pending' : fmtTokens(v));

export async function loadQm(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<{ plan: QmPlan | null; broken?: boolean }> {
  const res = await fetchFn('/api/qm', { credentials: 'same-origin' });
  const t = await res.text();
  const j = t ? JSON.parse(t) : undefined;
  if (!res.ok) throw new Error((j as { error?: { message?: string } } | undefined)?.error?.message ?? `HTTP ${res.status}`);
  return j;
}
