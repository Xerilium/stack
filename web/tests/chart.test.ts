/** @req FR:agents-team/chart.primary @req FR:agents-team/chart.tree @req FR:agents-team/chat.list @req FR:agents-team/other.hidden */
import { describe, expect, it } from 'vitest';
import { chatsFor, chartOrder, isPrimary, orgChart, otherSessions, type ChartNode } from '../src/chart';
import type { SessionItem } from '../src/sessions';
import type { TeamAgent } from '../src/team';

const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: scope.filter((x) => x !== '*'), ...o });
const now = Date.parse('2026-11-01T10:00:00Z');
const at = (min: number) => new Date(now - min * 60_000).toISOString();
const sess = (o: Partial<SessionItem>): SessionItem => ({ id: 'x', title: 't', project: 'stack', owner: 'stack', cwd: '/x', lastActive: at(10), state: 'idle', cost: { usd: 0, tokens: 1 }, prs: [], ...o } as SessionItem);
const team = [
  ag('cos', ['*'], { name: 'CoS', projects: ['allyte', 'stack'] }),
  ag('arch', [], { name: 'Architect', projects: [], reportsTo: 'xe-cos' }),
  ag('xe-cos', ['stack'], { name: 'Xe CoS', reportsTo: 'cos' }),
  ag('allyte-cos', ['allyte'], { name: 'Allyte CoS', reportsTo: 'cos' }),
  ag('sweeper', [], { name: 'Sweep worker', projects: [], reportsTo: 'cos' }),
  ag('meta', ['allyte'], { name: 'Meta agent', defined: false, source: 'metadata', reportsTo: 'allyte-cos' }),
];
const rank = new Map([['allyte', 0], ['stack', 1]]);
const shape = (n: ChartNode): unknown => (n.children.length ? [n.agent.slug, n.children.map(shape)] : n.agent.slug);

describe('isPrimary', () => {
  it('is the roll-up, or a defined agent with a project or a report; not metadata-only or scopeless workers', () => {
    expect(team.filter((a) => isPrimary(a, team)).map((a) => a.slug)).toEqual(['cos', 'xe-cos', 'allyte-cos']);
  });
  it('keeps an architect that has a report', () => {
    const t = [...team, ag('helper', [], { reportsTo: 'arch', projects: [] })];
    expect(isPrimary(t[1], t)).toBe(true);
  });
});

describe('orgChart', () => {
  it('nests primary agents under the roll-up by project priority; non-primary agents are dropped', () => {
    const t = [...team, ag('helper', [], { reportsTo: 'arch', projects: [] })];
    expect(orgChart(t, rank).map(shape)).toEqual([['cos', ['allyte-cos', ['xe-cos', ['arch']]]]]);
  });
  it('moves an agent under its nearest primary ancestor when its manager is not primary', () => {
    const t = [ag('cos', ['*']), ag('w', [], { reportsTo: 'cos', defined: false }), ag('p', ['stack'], { reportsTo: 'w' })];
    expect(orgChart(t, rank).map(shape)).toEqual([['cos', ['p']]]);
  });
  it('survives a cycle and an empty team', () => {
    const t = [ag('a', ['stack'], { reportsTo: 'b' }), ag('b', ['stack'], { reportsTo: 'a' })];
    expect(orgChart(t, rank).length).toBeGreaterThan(0);
    expect(orgChart([], rank)).toEqual([]);
  });
  it('chartOrder lists the agents in paint order', () => {
    expect(chartOrder(orgChart(team, rank))).toEqual(['cos', 'allyte-cos', 'xe-cos']);
  });
});

describe('chatsFor / otherSessions', () => {
  const items = [
    sess({ id: 'c1', title: 'CoS · brief', lastActive: at(60) }),
    sess({ id: 'c2', title: 'cos: today', lastActive: at(5) }),
    sess({ id: 'm1', title: 'Meta agent · x' }),
    sess({ id: 'w1', title: 'Sweep worker · PRs' }),
    sess({ id: 'f1', title: 'fix a bug' }),
    sess({ id: 'x1', title: 'Xe CoS · plan' }),
  ];
  it('lists an agent\'s chats newest first', () => {
    expect(chatsFor(team[0], items, team).map((s) => s.id)).toEqual(['c2', 'c1']);
  });
  it('other sessions are every session not matched to a primary agent', () => {
    expect(otherSessions(items, team).map((s) => s.id)).toEqual(['m1', 'w1', 'f1']);
  });
  it('without a team every session is other', () => {
    expect(otherSessions(items, []).length).toBe(items.length);
  });
});
