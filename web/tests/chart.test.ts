/** @req FR:agents-team/chart.primary @req FR:agents-team/chart.tree @req FR:agents-team/chat.list @req FR:agents-team/other.hidden */
import { describe, expect, it } from 'vitest';
import { agentStatus, chatsFor, chartOrder, orgChart, otherSessions, type ChartNode } from '../src/chart';
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

describe('orgChart', () => {
  it('shows the whole team: every agent, nested by reportsTo, siblings by project priority', () => {
    const t = [...team, ag('helper', [], { reportsTo: 'arch', projects: [] })];
    expect(orgChart(t, rank).map(shape)).toEqual([['cos', [['allyte-cos', ['meta']], ['xe-cos', [['arch', ['helper']]]], 'sweeper']]]);
  });
  it('an agent whose manager is missing is a root', () => {
    const t = [ag('cos', ['*']), ag('p', ['stack'], { reportsTo: 'gone' })];
    expect(orgChart(t, rank).map(shape)).toEqual(['cos', 'p']);
  });
  it('survives a cycle and an empty team', () => {
    const t = [ag('a', ['stack'], { reportsTo: 'b' }), ag('b', ['stack'], { reportsTo: 'a' })];
    expect(orgChart(t, rank).length).toBeGreaterThan(0);
    expect(orgChart([], rank)).toEqual([]);
  });
  it('chartOrder lists the agents in paint order', () => {
    expect(chartOrder(orgChart(team, rank))).toEqual(['cos', 'allyte-cos', 'meta', 'xe-cos', 'arch', 'sweeper']);
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
  it('other sessions are every session matched to no agent', () => {
    expect(otherSessions(items, team).map((s) => s.id)).toEqual(['f1']);
  });
  it('without a team every session is other', () => {
    expect(otherSessions(items, []).length).toBe(items.length);
  });
});

/** @req FR:agents-team/chart.card */
describe('agentStatus', () => {
  it('is needs you, running, idle with chats, else none', () => {
    expect(agentStatus([sess({ state: 'running' }), sess({ state: 'needs-you' })])).toBe('needs-you');
    expect(agentStatus([sess({ state: 'idle' }), sess({ state: 'running' })])).toBe('running');
    expect(agentStatus([sess({ state: 'stale' })])).toBe('idle');
    expect(agentStatus([])).toBe('none');
  });
});
