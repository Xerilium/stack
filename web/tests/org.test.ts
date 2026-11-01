/** @req FR:agent-team/org.tree @req FR:agent-team/org.tree.row @req FR:agent-team/org.tree.fold @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched @req FR:agent-team/org.tree.pinned @req FR:agent-team/org.order @req FR:agent-team/org.order.scope @req FR:agent-team/compose.agent @req FR:agent-team/compose.agent.default @req FR:agent-team/compose.folder */
import { describe, expect, it } from 'vitest';
import { composeDefault, folderFor, orderAgents, orgTree, type OrgRow } from '../src/org';
import type { SessionItem } from '../src/sessions';
import type { TeamAgent } from '../src/team';

const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: scope.filter((x) => x !== '*'), ...o });
const now = new Date('2026-11-01T10:00:00Z');
const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const sess = (o: Partial<SessionItem>): SessionItem => ({ id: 'x', title: 't', project: 'stack', owner: 'stack', cwd: '/x/stack', lastActive: at(10), state: 'idle', cost: { usd: 0, tokens: 1000 }, prs: [], ...o });
const team = [
  ag('cos', ['*'], { name: '👔 CoS', role: 'Chief of Staff', projects: ['allyte', 'stack', 'f4'] }),
  ag('xe-cos', ['stack'], { name: 'Xe CoS', reportsTo: 'cos' }),
  ag('allyte-cos', ['allyte'], { name: 'Allyte CoS', reportsTo: 'cos' }),
  ag('cid', ['f4'], { name: '🎧 Cid Manager', reportsTo: 'cos' }),
  ag('worker', ['allyte'], { name: 'PR sweep worker: finops-hubs', defined: false, source: 'metadata', reportsTo: 'allyte-cos' }),
  ag('lonely', [], { name: 'Lonely', projects: [], reportsTo: 'cos' }),
];
const rank = new Map([['allyte', 0], ['stack', 1], ['f4', 2]]);
const rows = (t: OrgRow[]) => t.map((r) => (r.kind === 'agent' ? `${'  '.repeat(r.level)}@${r.agent.slug}` : r.kind === 'session' ? `${'  '.repeat(r.level)}${r.s.id}` : r.kind === 'more' ? `${'  '.repeat(r.level)}+${r.n}` : r.kind === 'also' ? `${'  '.repeat(r.level)}also:${r.agents.map((a) => a.slug).join(',')}` : `${'  '.repeat(r.level)}#${r.project}`));

// @req FR:agent-team/org.order @req FR:agent-team/org.order.scope
describe('orderAgents', () => {
  it('orders by the priority of the first project, then team order; agents with no project are hidden unless Show all', () => {
    expect(orderAgents(team.slice(1), rank, new Set()).map((a) => a.slug)).toEqual(['allyte-cos', 'worker', 'xe-cos', 'cid']);
    expect(orderAgents(team.slice(1), rank, new Set(['lonely'])).map((a) => a.slug)).toEqual(['allyte-cos', 'worker', 'xe-cos', 'cid', 'lonely']);
    expect(orderAgents(team.slice(1), rank, new Set(), true).map((a) => a.slug)).toEqual(['allyte-cos', 'worker', 'xe-cos', 'cid', 'lonely']);
  });
});

// @req FR:agent-team/org.tree @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched @req FR:agent-team/org.tree.pinned
describe('orgTree', () => {
  const items = [
    sess({ id: 'cos-1', title: '👔 CoS · morning', owner: null, project: 'todo', cwd: '/x/todo', cost: { usd: 0, tokens: 500 } }),
    sess({ id: 'cid-1', title: 'Cid manager', owner: 'f4', project: 'f4-music', lastActive: at(1) }),
    sess({ id: 'cid-2', title: '🎧 Cid Manager · Release · f4:7', owner: 'f4', project: 'f4-music', lastActive: at(60) }),
    sess({ id: 'cid-3', title: 'cid manager: labels', owner: 'f4', project: 'f4-music', lastActive: at(120) }),
    sess({ id: 'cid-4', title: 'cid manager: old', owner: 'f4', project: 'f4-music', lastActive: at(180), state: 'stale' }),
    sess({ id: 'free-1', title: 'fix the parser', owner: 'stack', project: 'stack', lastActive: at(30) }),
    sess({ id: 'free-2', title: 'landing page', owner: 'allyte', project: 'allyte-web', lastActive: at(40), state: 'running' }),
    sess({ id: 'maen', title: 'maenifold', owner: null, project: 'maenifold-rs' }),
    sess({ id: 'lonely-1', title: 'Lonely · test', owner: null, project: 'prime', state: 'needs-you' }),
  ];
  it('nests agents under their manager with their sessions (attention order, 3 shown), quiet leaves folded, unassigned owned sessions by project, hidden repos out', () => {
    const t = orgTree(team, items, rank, [], { now });
    expect(rows(t)).toEqual([
      '@cos', '  cos-1',
      '  @allyte-cos', '    also:worker', // no session, no reports: one quiet line
      '  @cid', '    cid-1', '    cid-2', '    cid-3', '    +1',
      '  @lonely', '    lonely-1', // an attention-state session shows its agent even without projects
      '  also:xe-cos',
      '#allyte', '  free-2',
      '#stack', '  free-1',
    ]);
    const cos = t[0] as Extract<OrgRow, { kind: 'agent' }>;
    expect(cos).toMatchObject({ tokens: 500, count: 1 });
    expect((t.find((r) => r.kind === 'agent' && r.agent.slug === 'cid') as Extract<OrgRow, { kind: 'agent' }>)).toMatchObject({ tokens: 4000, count: 4 });
    expect(t.some((r) => r.kind === 'agent' && r.agent.slug === 'xe-cos')).toBe(false);
  });
  it('a pinned session keeps its place and is marked; more opens the rest; Show all reveals other repos under Unassigned', () => {
    const t = orgTree(team, items, rank, ['cid-4', 'maen'], { now, more: new Set(['cid']), showAll: true });
    expect(rows(t)).toContain('    cid-4');
    expect(rows(t)).not.toContain('    +1');
    expect((t.find((r) => r.kind === 'session' && r.s.id === 'cid-4') as Extract<OrgRow, { kind: 'session' }>).pinned).toBe(true);
    expect(rows(t).slice(-2)).toEqual(['#maenifold-rs', '  maen']);
  });
  it('a pinned session from an unowned repo shows without Show all; ids walk the rows in paint order', () => {
    const t = orgTree(team, items, rank, ['maen'], { now });
    expect(rows(t).slice(-2)).toEqual(['#maenifold-rs', '  maen']);
    expect(t.map((r) => r.key).slice(0, 4)).toEqual(['agent:cos', 'cos-1', 'agent:allyte-cos', 'also:allyte-cos']);
  });
});

// @req FR:agent-team/compose.agent.default @req FR:agent-team/compose.folder
describe('compose defaults', () => {
  const items = [sess({ id: 'a', title: 'Cid manager', owner: 'f4', cwd: '/x/f4-music/.claude/worktrees/zany-fox-1a2b3c', lastActive: at(1) }), sess({ id: 'b', title: 'other', owner: 'f4', cwd: '/x/f4-site', lastActive: at(50) }), sess({ id: 'c', title: 'x', owner: 'allyte', cwd: '/x/allyte-web.worktrees/pr-1', lastActive: at(2) })];
  it('the cursor row picks the agent: its session agent, the agent row itself, else the roll-up', () => {
    expect(composeDefault('a', team, items)).toBe('cid');
    expect(composeDefault('agent:xe-cos', team, items)).toBe('xe-cos');
    expect(composeDefault('b', team, items)).toBe('cos');
    expect(composeDefault(null, team, items)).toBe('cos');
    expect(composeDefault(null, team.slice(1), items)).toBe('xe-cos');
  });
  it('the folder follows the agent: where it last ran, else the newest session repo of its first project, worktrees resolved; else none (the served folder)', () => {
    expect(folderFor(team[3], items, team)).toBe('/x/f4-music'); // its own newest session (a worktree)
    expect(folderFor(team[2], items, team)).toBe('/x/allyte-web');
    expect(folderFor(team[1], items, team)).toBe('');
    expect(folderFor(team[0], items, team)).toBe('/x/allyte-web'); // no session of its own: the first project in its list with a repo
    const mine = [...items, sess({ id: 'c0', title: '👔 CoS · brief', owner: null, cwd: '/x/todo', lastActive: at(0) })];
    expect(folderFor(team[0], mine, team)).toBe('/x/todo');
  });
});
