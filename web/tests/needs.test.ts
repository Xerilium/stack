/** @req FR:web-shell/state.needs */
import { describe, expect, it } from 'vitest';
import type { AskItem } from '../src/asks';
import { fromDecisions, fromNeeds, mergeNeeds, type NeedItem } from '../src/needs';
import type { Task } from '../src/types';

const at = new Date(2026, 9, 29, 10, 0);
const T = (ref: string, text: string, project = 'house', depth = 0): Task => ({ ref, text, project, section: '🔄 Active', done: false, depth, notes: [] });
const titles = new Map([['house', 'House'], ['stack', 'Stack']]);
const ask = (key: string, score: number): AskItem => ({ key, state: 'open', ask: key, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: '2026-10-29T08:00:00Z', updated: '2026-10-29T08:00:00Z', score, overdue: false });

describe('fromDecisions', () => {
  // @req FR:web-shell/state.needs.row
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

// @req FR:ask-queue/needs.web @req FR:ask-queue/needs.web.card @req FR:ask-queue/$need
describe('fromNeeds', () => {
  const NOW = new Date('2026-11-01T20:00:00Z');
  const n = (id: string, over: Partial<NeedItem> = {}): NeedItem => ({ id, title: `Title ${id}`, recommendation: 'Do it', link: 'https://example.test/x', ...over });
  it('open items become asks from the Chief of Staff, in file order, ahead of everything else', () => {
    const a = fromNeeds([n('one', { default: 'I wait', project: 'finance', ref: 'finance:12' }), n('two')], NOW);
    expect(a.map((x) => x.key)).toEqual(['need:one', 'need:two']);
    expect(a[0]).toMatchObject({ source: 'need', from: 'Chief of Staff', recommend: 'Do it', default: 'I wait', link: 'https://example.test/x', ref: 'finance:12', kind: 'approve' });
    expect(a[0].score).toBeGreaterThan(a[1].score);
    expect(a[1].score).toBeGreaterThan(500); // above any agent ask or 🙋 row
  });
  it('an answered item is gone; a deferred one returns once its time has passed', () => {
    const answered = n('a', { answer: { choice: 'go', at: '2026-11-01T19:00:00Z' } });
    const later = n('b', { answer: { choice: 'defer', until: '2026-11-02T09:00:00Z', at: '2026-11-01T19:00:00Z' } });
    const due = n('c', { answer: { choice: 'defer', until: '2026-11-01T19:30:00Z', at: '2026-11-01T18:00:00Z' } });
    expect(fromNeeds([answered, later, due], NOW).map((x) => x.key)).toEqual(['need:c']);
  });
  it('marks an item overdue when its default time has passed', () => {
    expect(fromNeeds([n('x', { by: '2026-11-01T19:00:00Z' })], NOW)[0].overdue).toBe(true);
    expect(fromNeeds([n('y', { by: '2026-11-02T19:00:00Z' })], NOW)[0].overdue).toBe(false);
  });
});
