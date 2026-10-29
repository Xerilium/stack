/** @req FR:web-app/today.agents @req FR:web-app/today.reply */
import { describe, expect, it } from 'vitest';
import { ago, AGENT_LABEL, attention, lastLine, repliesFor, unescapeMd } from '../src/agents';
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
  it('matches open replies by task title in the project, not by line', () => {
    const e = (id: string, project: string, ref: string, task: string): InboxItem => ({ id, at: id, project, ref, task, kind: 'reply', to: 'agent', text: id, state: 'open' });
    const items = [
      e('stored', 'alpha', 'tasks/alpha.md:6', 'Pick a vendor \\[A\\|B\\] 🔺 📅 Oct 30: https://github.com/o/r/pull/7'),
      e('other-row', 'alpha', 'tasks/alpha.md:4', 'Something else'),
      e('other-project', 'beta', 'tasks/beta.md:6', 'Pick a vendor [A|B]'),
    ];
    // The row moved to line 9 and gained status, effort, and a new due date.
    expect(repliesFor(items, { project: 'alpha', text: '🙋 🚧 Pick a vendor [A|B] 🟡 📅 Nov 2: https://github.com/o/r/pull/7' }).map((i) => i.id)).toEqual(['stored']);
    // A different row now sitting on the stored line gets nothing.
    expect(repliesFor(items, { project: 'alpha', text: '🙋 Approve budget' })).toEqual([]);
    expect(repliesFor(items, { project: 'alpha', text: '🙋 🔺' })).toEqual([]);
  });
  it('shows inbox text as typed', () => {
    expect(unescapeMd('Use A\\|B, see \\[draft\\] and \\\\n')).toBe('Use A|B, see [draft] and \\n');
  });
});
