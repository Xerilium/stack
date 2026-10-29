/** @req FR:web-shell/state.needs */
import { describe, expect, it } from 'vitest';
import type { AskItem } from '../src/asks';
import { fromDecisions, mergeNeeds } from '../src/needs';
import type { Task } from '../src/types';

const at = new Date(2026, 9, 29, 10, 0);
const T = (ref: string, text: string, project = 'house', depth = 0): Task => ({ ref, text, project, section: '🔄 Active', done: false, depth, notes: [] });
const titles = new Map([['house', 'House'], ['stack', 'Stack']]);
const ask = (key: string, score: number): AskItem => ({ key, state: 'open', ask: key, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: '2026-10-29T08:00:00Z', updated: '2026-10-29T08:00:00Z', score, overdue: false });

describe('fromDecisions', () => {
  it('a 🙋 row with a recommendation is an approve-style ask from the project agent; without one it wants an answer', () => {
    const rows = fromDecisions([
      { task: T('house:46', '🙋 Review ADU option comparison and decide which path to pursue'), context: T('house:40', 'ADU project'), recommendation: 'Studio Shed quote' },
      { task: T('stack:9', '📅 Oct 28: 🙋 Review and merge PR chain', 'stack') },
    ], titles, at);
    expect(rows.map((r) => [r.key, r.kind, r.from, r.source])).toEqual([
      ['task:house:46', 'approve', 'House agent', 'task'],
      ['task:stack:9', 'answer', 'Stack agent', 'task'],
    ]);
    expect(rows[0].ask).toBe('Review ADU option comparison and decide which path to pursue');
    expect(rows[0].why).toBe('ADU project');
    expect(rows[0].recommend).toBe('Studio Shed quote');
    expect(rows[0].ref).toBe('house:46');
    expect(rows[0].project).toBe('house');
    expect(rows[1].overdue).toBe(true);
    expect(rows[1].by).toBeDefined();
  });
});

describe('mergeNeeds', () => {
  it('ranks agent asks and decisions together by score, overdue decisions first', () => {
    const d = fromDecisions([{ task: T('stack:9', '📅 Oct 28: 🙋 Merge PRs', 'stack') }, { task: T('house:46', '🙋 Pick a path') }], titles, at);
    const all = mergeNeeds([ask('pr', 120), ask('low', 10)], d);
    expect(all.map((a) => a.key)).toEqual(['pr', 'task:stack:9', 'task:house:46', 'low']);
    expect(all.map((a) => a.rank)).toEqual([1, 2, 3, 4]);
  });
});
