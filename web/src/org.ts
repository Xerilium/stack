/**
 * The team on the Agents page: agents ordered by project priority under their manager, each with its sessions; owned sessions no agent
 * claims under Unassigned; the defaults of the agent-first composer.
 * @req FR:agent-team/org.tree @req FR:agent-team/org.tree.row @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched
 * @req FR:agent-team/org.tree.pinned @req FR:agent-team/org.order @req FR:agent-team/org.order.scope @req FR:agent-team/compose.agent.default @req FR:agent-team/compose.folder
 */
import { orderSessions, type SessionItem } from './sessions';
import { matchAgent, rollupOf, type TeamAgent } from './team';

export const UNASSIGNED = 'Unassigned';
export type OrgRow =
  | { kind: 'agent'; key: string; level: number; agent: TeamAgent; /** Sessions in the window. */ count: number; tokens: number; hidden: number }
  | { kind: 'session'; key: string; level: number; s: SessionItem; pinned: boolean }
  | { kind: 'more'; key: string; level: number; agent: TeamAgent; n: number }
  | { kind: 'project'; key: string; level: number; project: string }
  /** Agents under one manager with no session and no reports of their own, folded into one quiet line. @req FR:agent-team/org.tree.fold */
  | { kind: 'also'; key: string; level: number; agents: TeamAgent[] };
export interface OrgOptions { now: Date; /** Agents whose session list is fully open. */ more?: Set<string>; showAll?: boolean; /** Sessions shown per agent before `n more`. */ top?: number }
const TOP = 3;
const ATTENTION = new Set(['needs-you', 'running']);

/** Agents by the priority of their first project, then team order; an agent with no project only with Show all or when `keep` has it. @req FR:agent-team/org.order @req FR:agent-team/org.order.scope */
export function orderAgents(agents: TeamAgent[], rank: Map<string, number>, keep: Set<string>, showAll = false): TeamAgent[] {
  const r = (a: TeamAgent) => { const rs = a.projects.map((p) => rank.get(p) ?? rank.size); return rs.length ? Math.min(...rs) : Infinity; };
  return agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => showAll || a.projects.length > 0 || keep.has(a.slug))
    .sort((x, y) => r(x.a) - r(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/** The whole page as rows in paint order. @req FR:agent-team/org.tree */
export function orgTree(team: TeamAgent[], items: SessionItem[], rank: Map<string, number>, pins: string[], o: OrgOptions): OrgRow[] {
  const top = o.top ?? TOP;
  const byAgent = new Map<string, SessionItem[]>();
  const free: SessionItem[] = [];
  for (const s of items) { const a = matchAgent(s, team); if (a) byAgent.set(a.slug, [...(byAgent.get(a.slug) ?? []), s]); else free.push(s); }
  // Agents with no project still show when a session of theirs is pinned or needs attention. @req FR:agent-team/org.order.scope
  // Owned work always shows (`FR:agent-sessions/web.scope`), so an agent with an owned session shows with it.
  const keep = new Set(team.filter((a) => (byAgent.get(a.slug) ?? []).some((s) => pins.includes(s.id) || ATTENTION.has(s.state) || !!s.owner)).map((a) => a.slug));
  // A manager stays while any agent under it shows: a branch must not vanish because its manager declares no scope.
  for (const a of team.filter((x) => x.projects.length > 0 || keep.has(x.slug))) { const seen = new Set<string>(); let m = team.find((t) => t.slug === a.reportsTo); while (m && !seen.has(m.slug)) { seen.add(m.slug); keep.add(m.slug); m = team.find((t) => t.slug === m!.reportsTo); } }
  const rollup = rollupOf(team);
  const out: OrgRow[] = [];
  const seen = new Set<string>();
  const visit = (a: TeamAgent, level: number) => {
    if (seen.has(a.slug)) return; seen.add(a.slug); // the server breaks cycles; a stale payload must not recurse forever
    const mine = orderSessions(byAgent.get(a.slug) ?? [], rank);
    const open = o.more?.has(a.slug);
    const shown = open ? mine : mine.slice(0, top);
    out.push({ kind: 'agent', key: `agent:${a.slug}`, level, agent: a, count: mine.length, tokens: mine.reduce((n, s) => n + s.cost.tokens, 0), hidden: mine.length - shown.length });
    for (const s of shown) out.push({ kind: 'session', key: s.id, level: level + 1, s, pinned: pins.includes(s.id) });
    if (mine.length > shown.length) out.push({ kind: 'more', key: `more:${a.slug}`, level: level + 1, agent: a, n: mine.length - shown.length });
    const kids = orderAgents(team.filter((t) => t !== a && t.reportsTo === a.slug), rank, keep, o.showAll);
    // Quiet leaves (no session, no reports) fold into one `Also` line so the tree stays readable. @req FR:agent-team/org.tree.fold
    const quiet = kids.filter((c) => !(byAgent.get(c.slug) ?? []).length && !team.some((t) => t.reportsTo === c.slug && t !== c));
    for (const c of kids.filter((c) => !quiet.includes(c))) visit(c, level + 1);
    if (quiet.length) { quiet.forEach((c) => seen.add(c.slug)); out.push({ kind: 'also', key: `also:${a.slug}`, level: level + 1, agents: quiet }); }
  };
  // Roots: the roll-up, then anyone whose manager is missing (ordered like siblings).
  const roots = team.filter((a) => a === rollup || !a.reportsTo || !team.some((t) => t.slug === a.reportsTo));
  for (const a of [...(rollup ? [rollup] : []), ...orderAgents(roots.filter((a) => a !== rollup), rank, keep, o.showAll)]) visit(a, 0);
  // Agents no root reaches (a cycle in a stale payload) still paint, once, as roots.
  for (const a of orderAgents(team.filter((x) => !seen.has(x.slug)), rank, keep, o.showAll)) visit(a, 0);
  // Unassigned: owned (or pinned, or every with Show all) sessions no agent claims, by project in priority order. @req FR:agent-team/org.tree.unmatched
  const loose = orderSessions(free.filter((s) => !!s.owner || pins.includes(s.id) || o.showAll), rank);
  const groups = new Map<string, SessionItem[]>();
  for (const s of loose) { const k = s.owner ?? s.project; groups.set(k, [...(groups.get(k) ?? []), s]); }
  for (const [project, list] of groups) {
    out.push({ kind: 'project', key: `project:${project}`, level: 0, project });
    for (const s of list) out.push({ kind: 'session', key: s.id, level: 1, s, pinned: pins.includes(s.id) });
  }
  return out;
}

/** The agent the composer preselects: the cursor session's agent, the cursor agent row, else the roll-up, else the first agent. @req FR:agent-team/compose.agent.default */
export function composeDefault(cursor: string | null, team: TeamAgent[], items: SessionItem[]): string {
  if (cursor?.startsWith('agent:')) { const slug = cursor.slice(6); if (team.some((a) => a.slug === slug)) return slug; }
  const s = cursor ? items.find((x) => x.id === cursor) : undefined;
  const hit = s ? matchAgent(s, team) : undefined;
  return (hit ?? rollupOf(team) ?? team[0])?.slug ?? '';
}

/** A session folder trimmed to its repo: `<repo>/.claude/worktrees/<x>` → `<repo>`, `<dir>/<repo>.worktrees/<x>` → `<dir>/<repo>`, `<repo>-wt-<x>/…` → `<repo>`; each form resolves from any depth. */
export function repoRoot(cwd: string): string {
  const parts = cwd.split('/');
  const i = parts.indexOf('.claude');
  if (i > 0 && parts[i + 1] === 'worktrees') return parts.slice(0, i).join('/');
  const wt = parts.findIndex((p) => p.endsWith('.worktrees'));
  if (wt >= 0) return [...parts.slice(0, wt), parts[wt].slice(0, -'.worktrees'.length)].join('/');
  const wtd = parts.findIndex((p) => /-wt-[^/]+$/.test(p));
  if (wtd >= 0) return [...parts.slice(0, wtd), parts[wtd].replace(/-wt-[^/]+$/, '')].join('/');
  return cwd;
}

/** Where the agent last ran (its newest matched session), else the repo of its first project with one; `''` means the served folder. @req FR:agent-team/compose.folder */
export function folderFor(agent: TeamAgent, items: SessionItem[], team: TeamAgent[] = [agent]): string {
  const mine = items.filter((s) => matchAgent(s, team) === agent).sort((a, b) => b.lastActive.localeCompare(a.lastActive))[0];
  if (mine) return repoRoot(mine.cwd);
  for (const p of agent.projects) {
    const s = items.filter((x) => x.owner === p).sort((a, b) => b.lastActive.localeCompare(a.lastActive))[0];
    if (s) return repoRoot(s.cwd);
  }
  return '';
}
