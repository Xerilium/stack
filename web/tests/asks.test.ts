/** @req FR:ask-queue/web.home @req FR:ask-queue/web.card @req FR:ask-queue/web.actions @req FR:ask-queue/web.optimistic @req FR:ask-queue/web.empty @req FR:ask-queue/live.quiet */
import { describe, expect, it } from 'vitest';
import { actionsFor, deadline, deferChoices, freshness, ifSilent, keepCursor, newKeys, pageTitle, replyKind, splitTop, type AskItem } from '../src/asks';

const at = (h: number, m = 0, d = 28) => new Date(2026, 9, d, h, m);
const ask = (o: Partial<AskItem> = {}): AskItem => ({
  key: 'a', state: 'open', ask: 'Approve merging PR 879', kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0,
  created: '2026-10-28T10:00:00Z', updated: '2026-10-28T10:00:00Z', score: 30, overdue: false, ...o,
});

describe('deadline', () => {
  it('words the day, the time, and the distance; tone follows urgency', () => {
    expect(deadline(at(15).toISOString(), at(12))).toEqual({ label: 'Today 3:00 pm', rel: 'in 3 h', tone: 'soon' });
    expect(deadline(at(9, 0, 29).toISOString(), at(12))).toEqual({ label: 'Tomorrow 9:00 am', rel: 'in 21 h', tone: 'soon' });
    expect(deadline(at(9, 0, 30).toISOString(), at(12))).toMatchObject({ label: 'Fri 9:00 am', rel: 'in 2 d', tone: 'calm' });
    expect(deadline(at(9, 0, 33).toISOString(), at(12))).toMatchObject({ label: 'Mon 9:00 am', tone: 'calm' });
    expect(deadline(at(11, 30).toISOString(), at(12))).toEqual({ label: 'Today 11:30 am', rel: '30 min overdue', tone: 'late' });
    expect(deadline(at(12, 20).toISOString(), at(12))).toMatchObject({ rel: 'in 20 min', tone: 'soon' });
    expect(deadline(at(9, 0, 25).toISOString(), at(12))).toMatchObject({ rel: '3 d overdue', tone: 'late' });
  });
  it('no deadline gives nothing', () => { expect(deadline(undefined, at(12))).toBeNull(); });
});

describe('if silent', () => {
  it('shows the default only for reversible asks', () => {
    expect(ifSilent(ask({ reversible: true, default: 'Merges Oct 29 8:00am' }))).toEqual({ text: 'If silent: Merges Oct 29 8:00am', waits: false });
    expect(ifSilent(ask({ reversible: false, default: 'Merges' }))).toEqual({ text: 'No default: waits for you', waits: true });
    expect(ifSilent(ask({ reversible: true }))).toEqual({ text: 'No default: waits for you', waits: true });
  });
});

describe('actions by kind', () => {
  it('approve: Approve (Enter) and Reject (n), Open when linked', () => {
    const a = actionsFor(ask({ link: 'https://x.test/1' }));
    expect(a.map((x) => [x.label, x.key, !!x.primary])).toEqual([['Approve', 'Enter', true], ['Reject', 'n', false], ['Open', 'o', false]]);
    expect(a[0].send).toEqual({ answer: 'go' });
    expect(a[1].send).toEqual({ answer: 'no' });
    expect(a[2].open).toBe(true);
  });
  it('approve with a reject recommendation makes Reject primary', () => {
    expect(actionsFor(ask({ recommend: 'Reject' })).find((x) => x.primary)!.label).toBe('Reject');
  });
  it('decide: one numbered button per option, the recommendation primary', () => {
    const a = actionsFor(ask({ kind: 'decide', options: ['Ship Friday', 'Ship Monday'], recommend: 'ship monday' }));
    expect(a.map((x) => [x.label, x.key, !!x.primary])).toEqual([['Ship Friday', '1', false], ['Ship Monday', '2', true]]);
    expect(a[1].send).toEqual({ answer: 'option', text: 'Ship Monday' });
    expect(actionsFor(ask({ kind: 'decide', options: ['A', 'B'] }))[0].primary).toBe(true);
  });
  it('review: Looks good, Needs changes (opens the reply box), Open last', () => {
    const a = actionsFor(ask({ kind: 'review', link: 'https://x.test/draft' }));
    expect(a.map((x) => [x.label, x.key])).toEqual([['Looks good', 'Enter'], ['Needs changes', 'n'], ['Open', 'o']]);
    expect(a[1].reply).toBe(true);
  });
  it('go-do: Done and Open; answer: no buttons, the reply box is the action', () => {
    expect(actionsFor(ask({ kind: 'go-do', link: 'https://x.test' })).map((x) => x.label)).toEqual(['Done', 'Open']);
    expect(actionsFor(ask({ kind: 'go-do' }))[0].send).toEqual({ answer: 'done' });
    expect(actionsFor(ask({ kind: 'answer' }))).toEqual([]);
  });
});

describe('reply kind', () => {
  it('a question goes to the agent as ask; anything else is a reply', () => {
    expect(replyKind('Is CI green?')).toBe('ask');
    expect(replyKind('Is CI green? ')).toBe('ask');
    expect(replyKind('Hold until Monday')).toBe('reply');
  });
});

describe('defer choices', () => {
  it('offers an hour, this evening (only before 4 pm), tomorrow 9 am and Monday 9 am', () => {
    const am = deferChoices(at(10));
    expect(am.map((c) => [c.key, c.label])).toEqual([['1', '1 hour'], ['2', 'This evening'], ['3', 'Tomorrow 9 am'], ['4', 'Monday 9 am']]);
    expect(am[0].at).toEqual(at(11));
    expect(am[1].at).toEqual(at(18));
    expect(am[2].at).toEqual(at(9, 0, 29));
    expect(am[3].at).toEqual(at(9, 0, 33)); // Mon Nov 2
    expect(deferChoices(at(17)).map((c) => c.label)).toEqual(['1 hour', 'Tomorrow 9 am', 'Monday 9 am']);
  });
  it('on a Friday tomorrow is Saturday, so only Monday is offered; on a Sunday tomorrow is Monday', () => {
    const fri = deferChoices(new Date(2026, 9, 30, 10));
    expect(fri.map((c) => c.label)).toEqual(['1 hour', 'This evening', 'Monday 9 am']);
    expect(fri[2].at).toEqual(new Date(2026, 10, 2, 9));
    expect(deferChoices(new Date(2026, 10, 1, 10)).map((c) => c.label)).toEqual(['1 hour', 'This evening', 'Tomorrow 9 am']);
  });
});

describe('list helpers', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => ask({ key: k, rank: i + 1 }));
  it('splitTop shows five and counts the rest', () => {
    expect(splitTop(items, 5)).toEqual({ shown: items.slice(0, 5), more: 2 });
    expect(splitTop(items.slice(0, 3), 5)).toEqual({ shown: items.slice(0, 3), more: 0 });
    expect(splitTop(items, 5, true)).toEqual({ shown: items, more: 0 });
  });
  it('keepCursor stays on the same ask when the order changes; else the nearest rank', () => {
    expect(keepCursor('c', [items[2], items[0], items[1]], 2)).toBe('c');
    expect(keepCursor('x', items, 3)).toBe('d');
    expect(keepCursor('x', items.slice(0, 2), 5)).toBe('b');
    expect(keepCursor('x', [], 0)).toBeNull();
    expect(keepCursor(null, items, 0)).toBe('a');
  });
  it('newKeys finds asks that arrived from elsewhere and skips the first load and own actions', () => {
    expect(newKeys(null, items.slice(0, 2), new Set())).toEqual([]);
    expect(newKeys(['a'], items.slice(0, 3), new Set())).toEqual(['b', 'c']);
    expect(newKeys(['a'], items.slice(0, 3), new Set(['b']))).toEqual(['c']);
  });
  it('pageTitle carries the open count', () => {
    expect(pageTitle(3)).toBe('(3) Stack');
    expect(pageTitle(0)).toBe('Stack');
  });
  it('freshness words the age of the newest agent write', () => {
    const now = at(12);
    expect(freshness(new Date(now.getTime() - 20_000).toISOString(), now)).toBe('just now');
    expect(freshness(new Date(now.getTime() - 4 * 60_000).toISOString(), now)).toBe('4 min ago');
    expect(freshness(new Date(now.getTime() - 3 * 3600_000).toISOString(), now)).toBe('3 h ago');
    expect(freshness(new Date(now.getTime() - 2 * 86400_000).toISOString(), now)).toBe('2 d ago');
    expect(freshness(undefined, now)).toBe('never');
  });
});
