/** @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.row @req FR:pris-sessions-ui/sessions.line @req FR:pris-sessions-ui/sessions.name @req FR:pris-sessions-ui/sessions.link @req FR:pris-sessions-ui/sessions.reason @req FR:pris-sessions-ui/sessions.archive */
import { describe, expect, it } from 'vitest';
import { ago, groupNeeds, idsText, PROJECT_LABEL, reasonText, rowLine, safeLink, sessionLabel, stateChip, type SessionItem } from '../src/inventory';

const S = (id: string, project: SessionItem['project'], o: Partial<SessionItem> = {}): SessionItem => ({
  id, title: `Session ${id}`, project, state: 'waiting', reason: 'question', pinned: false, lastActivityAt: '2026-11-11T10:00:00.000Z', link: `claude://claude.ai/epitaxy/${id}`, prs: [], ...o,
});
const now = new Date('2026-11-11T10:30:00.000Z');

describe('groupNeeds', () => {
  // @req FR:pris-sessions-ui/sessions.list
  it('keeps server project order; inside a project the oldest wait is first', () => {
    const at = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
    const g = groupNeeds([S('a', 'allyte', { lastActivityAt: at(5) }), S('b', 'allyte', { state: 'stuck', lastActivityAt: at(90) }), S('c', 'xerilium'), S('d', 'other'), S('e', 'allyte', { lastActivityAt: at(30) })]);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([['Allyte', ['b', 'e', 'a']], ['Xerilium', ['c']], ['Other', ['d']]]);
    expect(PROJECT_LABEL).toEqual({ allyte: 'Allyte', ftk: 'FTK', focus: 'FOCUS', f4: 'F4', xerilium: 'Xerilium', other: 'Other' });
  });
});

describe('row text', () => {
  // @req FR:pris-sessions-ui/sessions.reason
  it('names each reason in plain words', () => {
    expect(['question', 'permission', 'needs-user', 'blocked', 'error', 'cut-short', 'api-error', 'dead-turn', 'pr-merged'].map((r) => reasonText(r as SessionItem['reason']))).toEqual([
      'Asked a question', 'Waiting for permission', 'Needs you', 'Blocked', 'Error', 'Cut short', 'API error', 'No activity for 30 min', 'PR merged',
    ]);
  });
  // @req FR:pris-sessions-ui/sessions.row
  it('prefers the ask, else the reason; state is a sentence-case chip; the accessible name reads title, state, reason, time', () => {
    expect(rowLine(S('a', 'ftk', { ask: 'Approve the plan' }))).toBe('Approve the plan');
    expect(rowLine(S('a', 'ftk', { reason: 'permission' }))).toBe('Waiting for permission');
    expect(stateChip('waiting')).toEqual({ word: 'Waiting', tone: 'neutral' });
    expect(stateChip('stuck')).toEqual({ word: 'Stuck', tone: 'warn' });
    expect(stateChip('idle')).toEqual({ word: 'Idle', tone: 'neutral' });
    expect(stateChip('running')).toEqual({ word: 'Running', tone: 'neutral' });
    expect(stateChip('turn-open' as SessionItem['state'])).toEqual({ word: 'Turn open', tone: 'neutral' });
    expect(sessionLabel(S('a', 'ftk', { reason: 'dead-turn', state: 'stuck' }), now)).toBe('Session a, Stuck, No activity for 30 min, 30m ago');
    expect(sessionLabel(S('a', 'ftk', { ask: 'Anything else, **done**, or **next** to the `finops-pmm` review?' }), now)).toBe('Session a, Waiting, Anything else, done, or next to the finops-pmm review?, 30m ago');
  });
  // @req FR:pris-sessions-ui/sessions.row
  it('time since last activity is short and relative', () => {
    expect(ago('2026-11-11T10:29:40.000Z', now)).toBe('now');
    expect(ago('2026-11-11T10:25:00.000Z', now)).toBe('5m');
    expect(ago('2026-11-11T07:30:00.000Z', now)).toBe('3h');
    expect(ago('2026-11-08T10:30:00.000Z', now)).toBe('3d');
    expect(ago('nope', now)).toBe('');
  });
  // @req FR:pris-sessions-ui/sessions.link @req FR:pris-sessions-ui/tray.link
  it('only an epitaxy link is a link', () => {
    expect(safeLink('claude://claude.ai/epitaxy/local_ab-12_CD')).toBe('claude://claude.ai/epitaxy/local_ab-12_CD');
    for (const bad of ['javascript:alert(1)', 'claude://evil.example/epitaxy/x', 'claude://claude.ai/epitaxy/../x', 'claude://claude.ai/epitaxy/', 'https://claude.ai/epitaxy/x', `claude://claude.ai/epitaxy/${'a'.repeat(129)}`]) expect(safeLink(bad)).toBeUndefined();
  });
});

describe('idsText', () => {
  // @req FR:pris-sessions-ui/sessions.archive
  it('one id per line', () => expect(idsText([S('a', 'ftk'), S('b', 'other')])).toBe('a\nb'));
});
