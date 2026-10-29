import { describe, expect, it } from 'vitest';
import { capacityRows, capacityHours } from '../src/capacity';
import type { Project, Task } from '../src/types';

const P = (name: string, metadata: Record<string, string> = {}): Project => ({ name, title: name, open: 0, done: 0, metadata });
const T = (project: string, text: string, done = false, section = 'Active'): Task => ({ ref: `${project}:1`, text, project, section, done, depth: 0, notes: [] });

// @req FR:web-app/capacity.view
describe('capacity', () => {
  it('reads hours from capacity metadata', () => {
    expect(capacityHours({ 'Work capacity': '10h', 'Home capacity': '2.5h', Repository: 'x' })).toBe(12.5);
    expect(capacityHours({ 'Weekly capacity': '8', 'Work capacity': '10h' })).toBe(8);
    expect(capacityHours({})).toBeNull();
  });
  it('sums the effort of active work per project against capacity (the backlog is not load)', () => {
    const rows = capacityRows(
      [P('alpha', { 'Work capacity': '2h' }), P('beta')],
      [T('alpha', 'a 🟠'), T('alpha', 'b 🟡'), T('alpha', 'done 🔴', true), T('alpha', 'someday ⚫️', false, '📋 Backlog'), T('beta', 'c 🟢'), T('beta', 'd')],
    );
    expect(rows).toEqual([
      { project: 'alpha', title: 'alpha', open: 3, hours: 3, capacity: 2, ratio: 1.5, over: true },
      { project: 'beta', title: 'beta', open: 2, hours: 0.5, capacity: null, ratio: null, over: false },
    ]);
  });
});
