/** Parts of the priorities report: tabs, counts, hash, columns, status words, links and the stamp. */
import { describe, expect, it } from 'vitest';
import { actionText, countOf, defaultTab, hashWithTab, PR_COLS, PRI_COLS, safeHref, sectionsOf, stampText, statusText, tabFromHash, tabLabel, type PrioritiesView, type PriRow } from '../src/priorities';

const r = (gap: boolean): PriRow => ({ id: 'a', project: 'A', agent: null, status: null, action: 'x', gap, ref: null, at: '2026-11-18T19:00:00Z', stale: false });
const t = (rows: PriRow[] = []) => ({ at: '2026-11-18T19:00:00Z', stale: false, rows });
const v = (qm: PrioritiesView['qm'], now = t()): PrioritiesView => ({ at: '2026-11-18T19:00:00Z', qm, now, today: t(), next: t(), prs: { at: '2026-11-18T19:00:00Z', stale: false, verified: true, manager: null, rows: [] } });

describe('priorities report', () => {
  // @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.table
  it('has QM (when set), Now, PRs, Today, Next 3 days, with their columns', () => {
    expect(sectionsOf(v({ ...t(), title: 'QM', today: true })).map((s) => [s.key, s.title])).toEqual([['qm', 'QM'], ['now', 'Now'], ['prs', 'PRs'], ['today', 'Today'], ['next', 'Next 3 days']]);
    expect(sectionsOf(v(null)).map((s) => s.key)).toEqual(['now', 'prs', 'today', 'next']);
    expect(PRI_COLS).toEqual(['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action']);
    expect(PR_COLS).toEqual(['PR', 'Agent', '👱‍♂️ Next action', 'Time']);
  });
  // @req FR:priorities-tables/web.tabs.count
  it('counts real rows only in the tab title', () => {
    const now = sectionsOf(v(null, t([r(false), r(true), r(false)])))[0];
    expect(countOf(now)).toBe(2);
    expect(tabLabel(now)).toBe('Now (2)');
  });
  // @req FR:priorities-tables/web.tabs.default
  it('opens QM on QM days, else Now', () => {
    expect(defaultTab(v({ ...t(), title: 'QM', today: true }))).toBe('qm');
    expect(defaultTab(v({ ...t(), title: 'QM', today: false }))).toBe('now');
    expect(defaultTab(v(null))).toBe('now');
  });
  // @req FR:priorities-tables/web.tabs.hash
  it('keeps the tab in the hash', () => {
    expect(tabFromHash('#/now?pri=prs')).toBe('prs');
    expect(tabFromHash('#/now?pri=bad')).toBeUndefined();
    expect(tabFromHash('#/now')).toBeUndefined();
    expect(hashWithTab('#/now', 'today')).toBe('#/now?pri=today');
    expect(hashWithTab('#/now?x=1&pri=qm', 'prs')).toBe('#/now?x=1&pri=prs');
    expect(hashWithTab('', 'now')).toBe('#/now?pri=now');
  });
  // @req FR:priorities-tables/tasks.status
  it('shows each status as an icon and one word', () => {
    expect(['working', 'pairing', 'done', 'idle', 'blocked', 'queued', 'unknown', null].map((s) => statusText(s as never))).toEqual(['🔄 Working', '🤝 Pairing', '✅ Done', '⏸️ Idle', '🚫 Blocked', '🕓 Queued', '❓ Unknown', '--']);
  });
  // @req FR:priorities-tables/web.table.gap
  it('starts a gap action with Gap:', () => {
    expect(actionText({ action: 'No tiered task in tasks/', gap: true })).toBe('Gap: No tiered task in tasks/');
    expect(actionText({ action: 'Ship', gap: false })).toBe('Ship');
  });
  // @req FR:priorities-tables/web.links
  it('links only the web and Claude sessions', () => {
    expect(safeHref('https://github.com/o/r/pull/7')).toBe(true);
    expect(safeHref('claude://claude.ai/epitaxy/s1')).toBe(true);
    expect(safeHref('javascript:alert(1)')).toBe(false);
    expect(safeHref(null)).toBe(false);
  });
  // @req FR:priorities-tables/web.tabs.head
  it('stamps a panel with its time and stale flag', () => {
    expect(stampText({ at: '2026-11-18T19:05:00Z', stale: false })).toBe('as of 11:05 AM');
    expect(stampText({ at: '2026-11-18T19:05:00Z', stale: true })).toBe('as of 11:05 AM, stale');
  });
});
