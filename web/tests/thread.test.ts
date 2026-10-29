/** @req FR:agent-thread/web.expand */
import { describe, expect, it } from 'vitest';
import { ago, canFollowUp, emptyThread, foldSubtasks, verdictLine, whoLine, type ThreadItem } from '../src/thread';

const now = new Date('2026-10-29T12:00:00Z');
const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const name = (s: string) => (s === 'cid' ? '🎧 Cid Manager' : s);

describe('thread helpers', () => {
  it('who lines name you, the agent, a review, an ask, with the age', () => {
    expect(whoLine({ at: at(5), kind: 'owner', id: 'a', text: 'x', state: 'open' }, now, name)).toBe('You · 5m ago');
    expect(whoLine({ at: at(2), kind: 'agent', id: 'b', agent: 'cid', text: 'y' }, now, name)).toBe('🎧 Cid Manager · 2m ago');
    expect(whoLine({ at: at(120), kind: 'review', verdict: 'can', plan: 'p', agent: 'cid' }, now, name)).toBe('🎧 Cid Manager reviewed · 2h ago');
    expect(whoLine({ at: '', kind: 'subtask', ref: 'a:1', text: 't', done: false }, now, name)).toBe('Subtask');
    expect(whoLine({ at: '', kind: 'subtasks', count: 2, done: 1 }, now, name)).toBe('The agent added 2 subtasks · 1 done');
    expect(whoLine({ at: '', kind: 'subtasks', count: 1, done: 0 }, now, name)).toBe('The agent added 1 subtask');
    expect(ago(at(0.5), now)).toBe('just now');
    expect(ago(at(60 * 48), now)).toBe('2d ago');
  });
  it('verdict lines and subtask folding', () => {
    expect(verdictLine({ at: '', kind: 'review', verdict: 'partial', plan: 'Cover first', estimate: '1h', agent: 'cid' })).toBe('Partly · 1h: Cover first');
    expect(verdictLine({ at: '', kind: 'review', verdict: 'cannot', plan: 'Needs you', agent: 'cid' })).toBe("Can't: Needs you");
    const items: ThreadItem[] = [{ at: at(1), kind: 'owner', id: 'a', text: 'x', state: 'open' }, { at: '', kind: 'subtask', ref: 'a:2', text: 's1', done: true }, { at: '', kind: 'subtask', ref: 'a:3', text: 's2', done: false }];
    expect(foldSubtasks(items).map((i) => i.kind)).toEqual(['owner', 'subtasks']);
    expect(foldSubtasks(items)[1]).toMatchObject({ count: 2, done: 1 });
    expect(foldSubtasks([items[0]])).toHaveLength(1);
  });
  it('a follow-up goes to an idle or stale task session only', () => {
    expect(canFollowUp(emptyThread())).toBe(false);
    expect(canFollowUp({ items: [], session: { id: 's', title: 't', state: 'idle' } })).toBe(true);
    expect(canFollowUp({ items: [], session: { id: 's', title: 't', state: 'running' } })).toBe(false);
  });
});
