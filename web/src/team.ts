/**
 * Pure helpers for the agent team: who covers a task, how a row's chip reads, which session belongs to a task, the quick prompts.
 * @req FR:agent-team/web.chip @req FR:agent-team/web.talk @req FR:agent-team/web.review
 */
import type { SessionItem } from './sessions';

export interface TeamAgent { slug: string; name: string; role?: string; scope: string[]; model?: string; mode: 'long-running' | 'ad-hoc'; prompt: string; defined: boolean; projects: string[] }
export interface ReviewItem { ref: string; at: string; verdict: 'can' | 'partial' | 'cannot'; plan: string; estimate?: string; agent: string; needs: string[] }
export type Talk = { ref: string; project: string; about: string; askKey?: never } | { ref?: never; project: string; about: string; askKey?: string };

export const QUICK: { id: 'review' | 'do' | 'plan'; label: string; text: string }[] = [
  { id: 'review', label: 'Review', text: '' },
  { id: 'do', label: 'Do it', text: 'Do this task. Bring me anything you need as an ask (`stack asks put`, see docs/asks.md); never wait in chat.' },
  { id: 'plan', label: 'Plan', text: 'Plan this task in steps with a rough estimate each; do not start it.' },
];

/** How specific a scope entry is for a task: 3 project/section, 2 project, 1 everything, 0 no match (mirrors the server). */
function specificity(scope: string, project: string, section?: string): number {
  if (scope === '*') return 1;
  const [p, ...rest] = scope.split('/');
  if (p !== project) return 0;
  if (rest.length === 0) return 2;
  const words = (h: string) => h.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').split(/\s+/).filter(Boolean);
  const a = words(rest.join('/')), b = section === undefined ? [] : words(section);
  return a.length > 0 && a.length <= b.length && a.every((w, i) => w === b[i]) ? 3 : 0;
}

/** Agents covering a task, most specific first; the first is the active agent. @req FR:agent-team/web.chip */
export function agentsFor(team: TeamAgent[], project: string, section?: string): TeamAgent[] {
  return team
    .map((a, i) => ({ a, i, s: Math.max(0, ...a.scope.map((x) => specificity(x, project, section))) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

/** The newest session started for a task from the page: its title ends with ` · <ref>`. */
export function sessionFor(items: SessionItem[], ref: string): SessionItem | undefined {
  const tail = ` · ${ref}`;
  return items.filter((s) => s.title.endsWith(tail)).sort((a, b) => b.lastActive.localeCompare(a.lastActive))[0];
}

/** `Can · 2h`, `Partial · needs 2`, `Can't`. */
export function verdictLabel(r: ReviewItem): string {
  if (r.verdict === 'cannot') return "Can't";
  const head = r.verdict === 'can' ? 'Can' : 'Partial';
  if (r.needs.length) return `${head} · needs ${r.needs.length}`;
  return r.estimate ? `${head} · ${r.estimate}` : head;
}

export interface ChipView { text: string; tone: 'muted' | 'ok' | 'warn' | 'accent' | 'plain'; title: string; needs?: number; /** Carries state (a verdict or a live session): always visible, not only on hover. */ state?: boolean }
/** What the row's agent chip says: a live session first, then a review, then the agent. @req FR:agent-team/web.chip */
export function chipFor(o: { agent?: TeamAgent; review?: ReviewItem; session?: SessionItem; reviewing?: boolean }): ChipView {
  if (o.reviewing) return { text: 'Reviewing…', tone: 'accent', title: `${o.agent?.name ?? 'Agent'} is reviewing this task`, state: true };
  if (o.session?.state === 'needs-you') return { text: 'Needs you', tone: 'warn', title: `${o.session.title}: waiting for a permission. Answer in Asks`, state: true };
  if (o.session?.state === 'running') return { text: 'Working', tone: 'accent', title: o.session.title, state: true };
  if (o.review) {
    // A verdict is state the owner must read: partial with needs is a warning, otherwise it reads as done.
    const tone = o.review.verdict === 'cannot' ? 'warn' : o.review.verdict === 'can' ? 'ok' : o.review.needs.length ? 'warn' : 'ok';
    return { text: verdictLabel(o.review), tone, title: `${o.review.agent}: ${o.review.plan}${o.review.estimate ? ` (${o.review.estimate})` : ''}`, state: true, ...(o.review.needs.length ? { needs: o.review.needs.length } : {}) };
  }
  if (!o.agent) return { text: 'No agent', tone: 'muted', title: 'No agent covers this task. Add one in tasks/agents/ or the project Agents line' };
  return { text: o.agent.name, tone: 'plain', title: `${o.agent.name}${o.agent.role ? `: ${o.agent.role}` : ''}. Talk to it (a)` };
}

/** The ask's agent when it is a team member, else the project's active agent. @req FR:agent-team/web.anything */
export function agentForAsk(team: TeamAgent[], ask: { from: string; project?: string }): TeamAgent | undefined {
  return team.find((a) => a.slug === ask.from || a.name === ask.from) ?? (ask.project ? agentsFor(team, ask.project)[0] : undefined);
}
