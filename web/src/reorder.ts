import type { Position } from './types';

/** Visible row, in display order. @req FR:web-app/reorder.plan */
export interface RowPos { ref: string; project: string; depth: number }
export interface MovePlan { target: string; position: Position }

function subtreeEnd(rows: RowPos[], i: number): number {
  let j = i + 1;
  while (j < rows.length && rows[j].project === rows[i].project && rows[j].depth > rows[i].depth) j++;
  return j;
}

/** Plan a drop of `from` on the top or bottom half of `to`. */
export function moveTarget(rows: RowPos[], from: string, to: string, half: 'top' | 'bottom'): MovePlan | null {
  const i = rows.findIndex((r) => r.ref === from);
  const j = rows.findIndex((r) => r.ref === to);
  if (i < 0 || j < 0 || i === j || rows[i].project !== rows[j].project) return null;
  if (j > i && j < subtreeEnd(rows, i)) return null;
  return { target: to, position: half === 'top' ? 'before' : 'after' };
}

/** Plan a one-row keyboard move. @req FR:web-app/reorder.keys */
export function keyboardMove(rows: RowPos[], ref: string, dir: 'up' | 'down'): MovePlan | null {
  const i = rows.findIndex((r) => r.ref === ref);
  if (i < 0) return null;
  if (dir === 'up') {
    const p = rows[i - 1];
    return p && p.project === rows[i].project ? { target: p.ref, position: 'before' } : null;
  }
  const n = rows[subtreeEnd(rows, i)];
  return n && n.project === rows[i].project ? { target: n.ref, position: 'after' } : null;
}
