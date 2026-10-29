import { describe, expect, it } from 'vitest';
import { applyFilters, buildHash, parseHash, type Filters } from '../src/filters';
import type { Task } from '../src/types';

const T = (ref: string, text: string, project = 'alpha', done = false): Task => ({ ref, text, project, section: 'Active', done, depth: 0, notes: [] });
const TASKS = [
  T('alpha:1', '🚧 ‼️ Ship it 🟡'), T('alpha:2', 'Write docs 🟢'), T('beta:1', '🔻 Tidy desk 🔴', 'beta'), T('beta:2', 'Old thing', 'beta', true),
];
const F = (o: Partial<Filters> = {}): Filters => ({ q: '', project: '', state: 'open', status: '', priority: '', effort: '', ...o });

// @req FR:web-app/list.filters
describe('applyFilters', () => {
  it('defaults to open tasks', () => {
    expect(applyFilters(TASKS, F()).map((t) => t.ref)).toEqual(['alpha:1', 'alpha:2', 'beta:1']);
    expect(applyFilters(TASKS, F({ state: 'done' })).map((t) => t.ref)).toEqual(['beta:2']);
    expect(applyFilters(TASKS, F({ state: 'all' }))).toHaveLength(4);
  });
  it('combines filters with AND', () => {
    expect(applyFilters(TASKS, F({ project: 'beta' })).map((t) => t.ref)).toEqual(['beta:1']);
    expect(applyFilters(TASKS, F({ q: 'ship' })).map((t) => t.ref)).toEqual(['alpha:1']);
    expect(applyFilters(TASKS, F({ priority: '‼️', status: '🚧' })).map((t) => t.ref)).toEqual(['alpha:1']);
    expect(applyFilters(TASKS, F({ effort: '🟢' })).map((t) => t.ref)).toEqual(['alpha:2']);
    expect(applyFilters(TASKS, F({ effort: '🟢', project: 'beta' }))).toEqual([]);
  });
  it('supports a "none" marker', () => {
    expect(applyFilters(TASKS, F({ priority: 'None' })).map((t) => t.ref)).toEqual(['alpha:2']);
  });
});

// @req FR:web-app/list.filters
describe('hash state', () => {
  it('round-trips view and filters', () => {
    const f = F({ q: 'a b', project: 'alpha', state: 'all', priority: '‼️' });
    const h = buildHash('list', f);
    expect(h.startsWith('#/list?')).toBe(true);
    expect(parseHash(h)).toEqual({ view: 'list', filters: f });
  });
  it('omits defaults and tolerates junk', () => {
    expect(buildHash('now', F())).toBe('#/now');
    expect(parseHash('')).toEqual({ view: 'asks', filters: F() });
    expect(parseHash('#/today')).toEqual({ view: 'today', filters: F() });
    expect(parseHash('#/nope?state=bogus')).toEqual({ view: 'asks', filters: F() });
    expect(parseHash('#/list?state=done').filters.state).toBe('done');
  });
});
