import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePris, PrisInvalid, type Pri } from '../../src/core/pris';
import { PRI_SCORE, priAction, priActions, priFirst, priOrder, type PriLink } from '../../src/core/pris-rank';

const pri = (id: string, note?: string, o: Partial<Pri> = {}): Pri => ({ id, title: id.toUpperCase(), status: 'active', items: [], backlog: [], weekly: note ? [{ week: '2026-W47', text: note }, { week: '2026-W46', text: 'Michael: old action' }] : [], ...o });

describe('priAction', () => {
  // @req FR:pri-first-ranking/action.input @req FR:pri-first-ranking/action.parse
  it('takes the text after the last Michael: in the newest note', () => {
    expect(priAction(pri('p1', 'Status. Michael: first. Michael: live-validate PR 430'))).toBe('live-validate PR 430');
    expect(priAction(pri('p1', 'Michael: buy the gift card; check off patch if done.'))).toBe('buy the gift card; check off patch if done');
    expect(priAction(pri('p1', 'No action named here'))).toBeUndefined();
    expect(priAction(pri('p1'))).toBeUndefined();
  });
  // @req FR:pri-first-ranking/action.parse.none @req FR:pri-first-ranking/action.parse.rest
  it('reads none as no action, and none; as a lead-in to the action', () => {
    expect(priAction(pri('p1', 'Michael: none, agents progressing.'))).toBeUndefined();
    expect(priAction(pri('p1', 'Michael: None.'))).toBeUndefined();
    expect(priAction(pri('p1', 'Michael: none, close pri.'))).toBeUndefined();
    expect(priAction(pri('p1', 'Michael: none; retire pri or undraft PR 296'))).toBe('retire pri or undraft PR 296');
  });
});

describe('priActions', () => {
  // @req FR:pri-first-ranking/action.first @req FR:pri-first-ranking/action.one @req FR:pri-first-ranking/action.output @req FR:pri-first-ranking/$pri-action
  it('gives one row per linking priority with an action, in rank order, scored by boost', () => {
    const pris = [pri('a', 'Michael: none.'), pri('b', 'Michael: do b'), pri('x', 'Michael: paused', { status: 'paused' }), pri('c', 'Michael: do c')];
    expect(priActions(pris)).toEqual([
      { id: 'b', rank: 2, title: 'B', text: 'do b', score: (PRI_SCORE * 2) / 3 },
      { id: 'c', rank: 3, title: 'C', text: 'do c', score: PRI_SCORE / 3 },
    ]);
  });
});

describe('priFirst', () => {
  const l = (rank: number): PriLink => ({ id: `p${rank}`, rank, title: '', via: 'keyword', term: '', boost: 0 });
  const links = new Map<string, PriLink>([['b', l(2)], ['d', l(1)], ['e', l(2)]]);
  // @req FR:pri-first-ranking/order.input @req FR:pri-first-ranking/order.linked @req FR:pri-first-ranking/order.linked.rank @req FR:pri-first-ranking/order.linked.score @req FR:pri-first-ranking/order.unlinked
  it('puts linked rows first by rank, keeps engine order inside a rank and for unlinked rows', () => {
    expect(priFirst(['a', 'b', 'c', 'd', 'e', 'f'], (r) => links.get(r))).toEqual(['d', 'b', 'e', 'a', 'c', 'f']);
  });
  // @req FR:pri-first-ranking/order.none
  it('keeps the engine order when nothing links', () => {
    expect(priFirst(['c', 'a', 'b'], () => undefined)).toEqual(['c', 'a', 'b']);
  });
});

describe('priOrder', () => {
  const current = (): Pri[] => parsePris(JSON.parse(readFileSync(join(__dirname, '../fixtures/pri-first-ranking/pris-current.json'), 'utf8')));
  const ids = (at: string, tz?: string) => priOrder(current(), new Date(at), tz).map((p) => p.id);
  const TAIL = ['personal', 'f4', 'korr', 'printer', 'stack', 'arc', 'catalyst'];
  // @req FR:pri-first-ranking/day.input @req FR:pri-first-ranking/day.slot @req FR:pri-first-ranking/day.slot.day @req FR:pri-first-ranking/day.slot.base @req FR:pri-first-ranking/day.tie @req FR:pri-first-ranking/day.tie.file
  it('orders the current priorities for each weekday', () => {
    expect(ids('2026-11-16T17:00:00Z')).toEqual(['money', 'focus', 'premium', 'fh011', 'ftk16', 'prs', 'qm', ...TAIL]); // Mon
    expect(ids('2026-11-17T17:00:00Z')).toEqual(['money', 'premium', 'ftk16', 'fh011', 'qm', 'focus', 'prs', ...TAIL]); // Tue
    expect(ids('2026-11-18T17:00:00Z')).toEqual(['money', 'qm', 'premium', 'fh011', 'ftk16', 'focus', 'prs', ...TAIL]); // Wed
  });
  // @req FR:pri-first-ranking/day.off
  it('leaves QM out Thu-Sun; FOCUS leads on Thu', () => {
    expect(ids('2026-11-19T17:00:00Z')).toEqual(['money', 'focus', 'premium', 'fh011', 'ftk16', 'prs', ...TAIL]); // Thu
    expect(ids('2026-11-21T17:00:00Z')).toEqual(['money', 'premium', 'fh011', 'ftk16', 'focus', 'prs', ...TAIL]); // Sat
  });
  // @req FR:pri-first-ranking/day.input
  it('reads the weekday in the configured time zone', () => {
    expect(ids('2026-11-19T05:00:00Z', 'America/Los_Angeles')[1]).toBe('qm'); // still Wed in PT
    expect(ids('2026-11-19T05:00:00Z', 'UTC')[1]).toBe('focus'); // Thu in UTC
  });
  // @req FR:pri-first-ranking/day.slot.none
  it('keeps the file order with no slots', () => {
    expect(priOrder([pri('b'), pri('a'), pri('c')], new Date()).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
  // @req FR:pri-first-ranking/day.validate @req FR:pri-first-ranking/day.validate.key @req FR:pri-first-ranking/day.schema @req FR:pri-first-ranking/$pri-day
  it('accepts slot and days; rejects bad values', () => {
    expect(current()[7]).toMatchObject({ slot: 6, days: { wed: 1, thu: 'off' } });
    const bad = (o: Record<string, unknown>) => { try { parsePris([{ ...pri('p1'), ...o }]); return []; } catch (e) { return (e as PrisInvalid).issues.map((i) => i.field); } };
    expect(bad({ slot: 100 })).toEqual(['[0].slot']);
    expect(bad({ slot: 1.5 })).toEqual(['[0].slot']);
    expect(bad({ days: { xyz: 1 } })).toEqual(['[0].days.xyz']);
    expect(bad({ days: { mon: 'maybe' } })).toEqual(['[0].days.mon']);
    expect(bad({ days: [] })).toEqual(['[0].days']);
  });
});
