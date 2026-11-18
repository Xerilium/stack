import type { Pri } from '../../src/core/pris';
import { PRI_SCORE, priAction, priActions, priFirst, type PriLink } from '../../src/core/pris-rank';

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
