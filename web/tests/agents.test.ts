/** @req FR:web-app/today.agents @req FR:web-app/today.reply */
import { describe, expect, it } from 'vitest';
import { ago, AGENT_LABEL, attention, lastLine, repliesFor } from '../src/agents';
import type { Agent, InboxItem } from '../src/types';

const now = new Date('2026-10-28T18:00:00Z');
const a = (o: Partial<Agent>): Agent => ({ ref: 'alpha:5', project: 'alpha', title: 'T', text: '🪄 T', state: 'queued', prs: [], replies: 0, ...o });

describe('AI team helpers', () => {
  it('labels every state', () => {
    expect(AGENT_LABEL).toEqual({ failing: 'CI failing', waiting: 'Needs you', review: 'Ready for review', merged: 'Merged', ci: 'CI running', working: 'Working', queued: 'Queued' });
  });
  it('says how long ago', () => {
    expect(ago('2026-10-28T17:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-28T17:55:00Z', now)).toBe('5m ago');
    expect(ago('2026-10-28T15:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-10-26T18:00:00Z', now)).toBe('2d ago');
  });
  it('describes the last activity from the newest artifact', () => {
    expect(lastLine(a({ last: { at: '2026-10-28T16:00:00Z', action: 'claimed' } }), now)).toBe('claimed 2h ago');
    expect(lastLine(a({ last: { at: '2026-10-28T16:00:00Z', action: 'result', outcome: 'blocked', summary: 'Needs a key' } }), now)).toBe('blocked: Needs a key · 2h ago');
    expect(lastLine(a({ prs: [{ url: 'u', repo: 'o/r', number: 1, updatedAt: '2026-10-28T17:00:00Z' }], last: { at: '2026-10-28T10:00:00Z', action: 'claimed' } }), now)).toBe('PR updated 1h ago');
    expect(lastLine(a({}), now)).toBe('');
  });
  it('counts what needs attention', () => {
    expect(attention([a({ state: 'waiting' }), a({ state: 'waiting' }), a({ state: 'failing' }), a({ state: 'working' }), a({ state: 'review' })])).toEqual(['2 need you', '1 CI failing', '1 ready for review', '1 working']);
    expect(attention([a({ state: 'queued' })])).toEqual(['1 queued']);
  });
  it('matches open replies by ref or by task title in the project', () => {
    const items: InboxItem[] = [
      { id: '1', at: 'x', project: 'alpha', ref: 'alpha:5', task: 'T', kind: 'reply', to: 'agent', text: 'one', state: 'open' },
      { id: '2', at: 'y', project: 'alpha', ref: 'alpha:9', task: 'T', kind: 'reply', to: 'agent', text: 'moved', state: 'open' },
      { id: '3', at: 'z', project: 'beta', ref: 'beta:5', task: 'T', kind: 'reply', to: 'agent', text: 'other', state: 'open' },
    ];
    expect(repliesFor(items, { ref: 'alpha:5', project: 'alpha', text: '🪄 T' }).map((i) => i.text)).toEqual(['one', 'moved']);
  });
});
