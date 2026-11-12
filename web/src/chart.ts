/**
 * The My team chart: the whole team as an org chart, an agent's chats and status, and the sessions that belong to no agent.
 * @req FR:agents-team/chart.primary @req FR:agents-team/chart.tree @req FR:agents-team/chart.card @req FR:agents-team/chat.list @req FR:agents-team/other.hidden
 */
import type { SessionItem } from './sessions';
import { matchAgent, rollupOf, type TeamAgent } from './team';

export interface ChartNode { agent: TeamAgent; children: ChartNode[] }

/** Every agent as a forest: the roll-up first; siblings by project priority, then team order. @req FR:agents-team/chart.primary @req FR:agents-team/chart.tree */
export function orgChart(team: TeamAgent[], rank: Map<string, number>): ChartNode[] {
  const prim = team;
  const bySlug = new Map(team.map((a) => [a.slug, a]));
  const r = (a: TeamAgent) => { const rs = a.projects.map((p) => rank.get(p) ?? rank.size); return rs.length ? Math.min(...rs) : Infinity; };
  const order = (xs: TeamAgent[]) => xs.map((a, i) => ({ a, i })).sort((x, y) => r(x.a) - r(y.a) || x.i - y.i).map((x) => x.a);
  /** The manager when it is on the team, or undefined; a cycle ends the walk. */
  const parent = (a: TeamAgent): TeamAgent | undefined => {
    const seen = new Set([a.slug]);
    let m = a.reportsTo ? bySlug.get(a.reportsTo) : undefined;
    while (m && !seen.has(m.slug)) { if (prim.includes(m)) return m; seen.add(m.slug); m = m.reportsTo ? bySlug.get(m.reportsTo) : undefined; }
    return undefined;
  };
  const rollup = rollupOf(team);
  const placed = new Set<string>();
  const build = (a: TeamAgent): ChartNode => {
    placed.add(a.slug);
    return { agent: a, children: order(prim.filter((c) => c !== a && !placed.has(c.slug) && parent(c) === a)).map((c) => (placed.has(c.slug) ? null : build(c))).filter((n): n is ChartNode => !!n) };
  };
  const roots = [...(rollup && prim.includes(rollup) ? [rollup] : []), ...order(prim.filter((a) => a !== rollup && !parent(a)))];
  const out = roots.map((a) => build(a));
  // Agents in a cycle have a parent but no root reaches them: they still paint, once, as roots.
  for (const a of order(prim.filter((x) => !placed.has(x.slug)))) if (!placed.has(a.slug)) out.push(build(a));
  return out;
}

/** Agent slugs in paint order (depth first). */
export const chartOrder = (nodes: ChartNode[]): string[] => nodes.flatMap((n) => [n.agent.slug, ...chartOrder(n.children)]);

/** The agent's sessions, newest first. @req FR:agents-team/chat.list */
export function chatsFor(agent: TeamAgent, items: SessionItem[], team: TeamAgent[]): SessionItem[] {
  return items.filter((s) => matchAgent(s, team) === agent).sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

/** Every session matched to no agent. @req FR:agents-team/other.hidden */
export function otherSessions(items: SessionItem[], team: TeamAgent[]): SessionItem[] {
  return items.filter((s) => !matchAgent(s, team));
}

export type AgentStatus = 'needs-you' | 'running' | 'idle' | 'none';
/** An agent's status from its chats: needs you, running, idle (has chats), none. @req FR:agents-team/chart.card */
export const agentStatus = (chats: Pick<SessionItem, 'state'>[]): AgentStatus =>
  chats.some((c) => c.state === 'needs-you') ? 'needs-you' : chats.some((c) => c.state === 'running') ? 'running' : chats.length ? 'idle' : 'none';
