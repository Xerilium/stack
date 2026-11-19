/** Parts of the priorities report: sections, columns, status words, links and the stamp. */
import { describe, expect, it } from 'vitest';
import { actionText, PR_COLS, PRI_COLS, safeHref, sectionsOf, stampText, statusText, type PrioritiesView } from '../src/priorities';

const t = (rows: never[] = []) => ({ at: '2026-11-18T19:00:00Z', stale: false, rows });
const v = (qm: PrioritiesView['qm']): PrioritiesView => ({ at: '2026-11-18T19:00:00Z', qm, now: t(), today: t(), next: t(), prs: { ...t(), verified: true, manager: null } });

describe('priorities report', () => {
  // @req FR:priorities-tables/web.sections @req FR:priorities-tables/web.sections.cols
  it('has QM (when set), Now, PRs, Today, Next 3 days, with their columns', () => {
    expect(sectionsOf(v({ ...t(), title: 'QM' })).map((s) => [s.key, s.title])).toEqual([['qm', 'QM'], ['now', 'Now'], ['prs', 'PRs'], ['today', 'Today'], ['next', 'Next 3 days']]);
    expect(sectionsOf(v(null)).map((s) => s.key)).toEqual(['now', 'prs', 'today', 'next']);
    expect(PRI_COLS).toEqual(['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action']);
    expect(PR_COLS).toEqual(['PR', 'Agent', '👱‍♂️ Next action', 'Time']);
  });
  // @req FR:priorities-tables/tasks.status
  it('shows each status as an icon and one word', () => {
    expect(['working', 'pairing', 'done', 'idle', 'blocked', 'queued', 'unknown', null].map((s) => statusText(s as never))).toEqual(['🔄 Working', '🤝 Pairing', '✅ Done', '⏸️ Idle', '🚫 Blocked', '🕓 Queued', '❓ Unknown', '--']);
  });
  // @req FR:priorities-tables/web.sections.gap
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
  // @req FR:priorities-tables/web.sections.head
  it('stamps a section with its time and stale flag', () => {
    expect(stampText({ at: '2026-11-18T19:05:00Z', stale: false })).toBe('as of 11:05 AM');
    expect(stampText({ at: '2026-11-18T19:05:00Z', stale: true })).toBe('as of 11:05 AM, stale');
  });
});
