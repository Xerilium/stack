/** @req FR:qm-plan/ui.sort @req FR:qm-plan/ui.route */
import { describe, expect, it } from 'vitest';
import { isQmHash, sortRows, type QmRow } from '../src/qm';

const row = (project: string, agent: string, n: number, t: number | null, pre: number | null, post: number | null): QmRow => ({
  project, agent: { name: agent }, tasks: Array.from({ length: n }, (_, i) => ({ title: `t${i}` })), weeklyTokens: t, preAckMin: pre, postReviewMin: post,
});
const rows = [row('b', 'z', 2, 5, null, 1), row('A', 'y', 5, null, 3, 2), row('c', 'x', 0, 9, 1, null)];
const names = (r: QmRow[]) => r.map((x) => x.project);

describe('qm page helpers', () => {
  it('sorts by every column; pending last both ways', () => {
    expect(names(sortRows(rows, 'project', 'asc'))).toEqual(['A', 'b', 'c']);
    expect(names(sortRows(rows, 'project', 'desc'))).toEqual(['c', 'b', 'A']);
    expect(names(sortRows(rows, 'agent', 'asc'))).toEqual(['c', 'A', 'b']);
    expect(names(sortRows(rows, 'tasks', 'desc'))).toEqual(['A', 'b', 'c']);
    expect(names(sortRows(rows, 'weeklyTokens', 'asc'))).toEqual(['b', 'c', 'A']);
    expect(names(sortRows(rows, 'weeklyTokens', 'desc'))).toEqual(['c', 'b', 'A']);
    expect(names(sortRows(rows, 'preAckMin', 'asc'))).toEqual(['c', 'A', 'b']);
    expect(names(sortRows(rows, 'postReviewMin', 'desc'))).toEqual(['A', 'b', 'c']);
    expect(names(rows)).toEqual(['b', 'A', 'c']); // input untouched
  });
  it('matches #/qm only', () => {
    expect(isQmHash('#/qm')).toBe(true);
    expect(isQmHash('#/qm?x=1')).toBe(true);
    expect(isQmHash('#/qmx')).toBe(false);
    expect(isQmHash('#/list')).toBe(false);
  });
});
