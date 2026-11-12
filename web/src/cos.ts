/**
 * The Chief of Staff view model. Pure: it picks from data the shared hooks already hold and keeps nothing of its own.
 * @req FR:cos-base-of-ops/state.none @req FR:cos-base-of-ops/state.report @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale
 * @req FR:cos-base-of-ops/state.line @req FR:cos-base-of-ops/msg.anchor @req FR:cos-base-of-ops/compose.prs @req FR:cos-base-of-ops/route.view
 */
import { countOf, TAB_LABEL, tabsOf, type EscEntry, type PrBoard, type PrGroup, type Tab } from './prs';
import { agentsFor, ownerOf, rollupOf, type TeamAgent } from './team';
import type { Task } from './types';

/** One stored report (`GET /reports`, `docs/report.md`). */
export interface CosItem { text: string; link?: string }
export interface CosReport { agent: string; project: string; at: string; top: CosItem[]; asks: { key: string; ask: string }[]; blockers: CosItem[]; progress: CosItem[] }

const STALE_MS = 24 * 3_600_000;
export const COS_DEFAULT = 'Chief of Staff';
export const ASK_REPORT = 'Send your status report now (docs/cos-reporting.md).';

/** The CoS's display name: the roll-up agent's, else `Chief of Staff`. @req FR:cos-base-of-ops/route.nav */
export const cosName = (team: TeamAgent[]): string => rollupOf(team)?.name ?? COS_DEFAULT;

/** The newest report by `slug`; a report for project `all` wins over a newer single-project one. @req FR:cos-base-of-ops/state.report */
export function cosReport(list: CosReport[] | null, slug: string): CosReport | undefined {
  const mine = (list ?? []).filter((r) => r.agent === slug).sort((a, b) => b.at.localeCompare(a.at));
  return mine.find((r) => r.project === 'all') ?? mine[0];
}

const ageWord = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};

/** The header line about the report. @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale */
export function reportState(r: CosReport | undefined, now: Date): { kind: 'none' | 'fresh' | 'stale'; text: string; title?: string; age?: string } {
  if (!r) return { kind: 'none', text: 'CoS has not reported yet' };
  const at = new Date(r.at);
  const ms = now.getTime() - at.getTime();
  const title = at.toLocaleString();
  if (ms > STALE_MS) {
    const when = at.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { kind: 'stale', text: `CoS has not reported since ${when}`, title, age: ageWord(ms) };
  }
  return { kind: 'fresh', text: `Last report ${ageWord(ms)}`, title };
}

/** `3 need you, 2 blocked, 11 moving`: only the parts whose source loaded. @req FR:cos-base-of-ops/state.line */
export function stateLine(o: { open?: number; blockers?: number; running?: number }): string | null {
  const parts = [o.open !== undefined && `${o.open} need you`, o.blockers !== undefined && `${o.blockers} blocked`, o.running !== undefined && `${o.running} moving`].filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : null;
}

const active = (t: Task) => /active/i.test(t.section) || t.section.includes('🔄');
/** The row a message to `slug` attaches to: its first open top-level task, Active first; else the first open one. @req FR:cos-base-of-ops/msg.anchor */
export function anchorFor(tasks: Task[], team: TeamAgent[], slug: string): Task | undefined {
  const open = tasks.filter((t) => !t.done && t.depth === 0);
  const ordered = [...open.filter(active), ...open.filter((t) => !active(t))];
  return ordered.find((t) => ownerOf(agentsFor(team, t.project, t.section), t)?.slug === slug) ?? ordered[0];
}

export type EscKind = 'blocked' | 'enable' | 'live';
/** Counts per group as the flyout tabs count them, and up to 3 escalation PRs (blocked, enable, live). @req FR:cos-base-of-ops/compose.prs */
export function prSummary(b: PrBoard | null): { counts: { tab: PrGroup; label: string; n: number }[]; esc: (EscEntry & { kind: EscKind })[] } {
  if (!b) return { counts: [], esc: [] };
  const counts = tabsOf(b).filter((t): t is PrGroup => t !== 'escalations').map((tab) => ({ tab, label: TAB_LABEL[tab], n: countOf(b, tab, []) }));
  const e = b.escalations;
  const esc = e ? [...e.blocked.map((x) => ({ ...x, kind: 'blocked' as const })), ...e.enable.map((x) => ({ ...x, kind: 'enable' as const })), ...e.live.map((x) => ({ ...x, kind: 'live' as const }))].slice(0, 3) : [];
  return { counts, esc };
}

const TABS: Tab[] = ['escalations', 'blocked', 'waiting', 'processing', 'pending', 'paused'];
/** The flyout tab a `#/prs` hash names (`default` when none or unknown); null for any other hash. @req FR:cos-base-of-ops/route.view */
export function prsTab(hash: string): Tab | 'default' | null {
  const m = /^#\/prs(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  const t = new URLSearchParams(m[1] ?? '').get('tab');
  return t && (TABS as string[]).includes(t) ? (t as Tab) : 'default';
}
