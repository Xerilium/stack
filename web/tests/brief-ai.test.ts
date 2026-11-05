/** @req FR:cos-view/brief.ai.web */
import { describe, expect, it } from 'vitest';
import { aiRows } from '../src/briefAi';
import type { AskItem } from '../src/asks';

const ask = (key: string): AskItem => ({ key, state: 'open', ask: key, kind: 'approve', from: 'x', reversible: true, priority: 'normal', blocks: 0, created: '', updated: '', score: 1, overdue: false });

describe('aiRows', () => {
  it('hides lines whose ask is not open, and labels actions', () => {
    const rows = aiRows({ configured: true, headline: 'H', lines: [{ key: 'a', text: 'A', action: 'go' }, { key: 'b', text: 'B', action: 'no' }, { key: 'c', text: 'C', action: 'done' }, { key: 'd', text: 'D', action: 'none' }, { key: 'gone', text: 'G', action: 'go' }] }, [ask('a'), ask('b'), ask('c'), ask('d')]);
    expect(rows!.rows.map((r) => [r.key, r.label])).toEqual([['a', 'Approve'], ['b', 'Reject'], ['c', 'Done'], ['d', undefined]]);
    expect(rows!.rows[0].ask.key).toBe('a');
  });
  it('is empty when not configured, errored, or no headline', () => {
    expect(aiRows({ configured: false }, [])).toBeNull();
    expect(aiRows({ configured: true, error: 'Summary unavailable' }, [])).toBeNull();
  });
});
