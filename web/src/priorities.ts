/**
 * The priorities report on Now: the view the host builds (`GET /priorities`) and the parts the page draws.
 * Rows, order and stamps are built in the core (`src/core/priorities-view.ts`); the page only draws them.
 * @req FR:priorities-tables/web.sections @req FR:priorities-tables/web.links @req FR:priorities-tables/web.sections.head
 */
export type AgentStatus = 'working' | 'pairing' | 'done' | 'idle' | 'blocked' | 'queued' | 'unknown';
export interface Agent { name: string; link: string | null }
export interface PriRow { id: string; project: string; agent: Agent | null; status: AgentStatus | null; action: string; gap: boolean; ref: string | null; at: string; stale: boolean }
export interface PriTable { at: string; stale: boolean; rows: PriRow[] }
export interface QmTable extends PriTable { title: string }
export interface PrRow { emoji: string; number: number; url: string; agent: Agent | null; action: string; minutes: number; server: string | null; details: string | null }
export interface PrTable { at: string; stale: boolean; verified: boolean; manager: Agent | null; rows: PrRow[] }
export interface PrioritiesView { at: string; qm: QmTable | null; now: PriTable; prs: PrTable; today: PriTable; next: PriTable }

/** @req FR:priorities-tables/web.sections.cols */
export const PRI_COLS = ['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action'] as const;
export const PR_COLS = ['PR', 'Agent', '👱‍♂️ Next action', 'Time'] as const;

export type Section = { key: 'qm' | 'now' | 'today' | 'next'; title: string; t: PriTable } | { key: 'prs'; title: string; t: PrTable };
/** QM (when set), Now, PRs, Today, Next 3 days. @req FR:priorities-tables/web.sections */
export function sectionsOf(v: PrioritiesView): Section[] {
  return [
    ...(v.qm ? [{ key: 'qm' as const, title: v.qm.title, t: v.qm }] : []),
    { key: 'now', title: 'Now', t: v.now }, { key: 'prs', title: 'PRs', t: v.prs },
    { key: 'today', title: 'Today', t: v.today }, { key: 'next', title: 'Next 3 days', t: v.next },
  ];
}

const STATUS: Record<AgentStatus, string> = { working: '🔄 Working', pairing: '🤝 Pairing', done: '✅ Done', idle: '⏸️ Idle', blocked: '🚫 Blocked', queued: '🕓 Queued', unknown: '❓ Unknown' };
/** Icon and one word; `--` with no agent. @req FR:priorities-tables/tasks.status */
export const statusText = (s: AgentStatus | null): string => (s ? STATUS[s] : '--');
/** A gap says so first. @req FR:priorities-tables/web.sections.gap */
export const actionText = (r: Pick<PriRow, 'action' | 'gap'>): string => (r.gap ? `Gap: ${r.action}` : r.action);

/** Links the page may draw: the web or a Claude session. @req FR:priorities-tables/web.links */
export const safeHref = (h: string | null | undefined): h is string => !!h && (/^https?:\/\//i.test(h) || /^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]{1,128}$/.test(h));

/** `as of 11:05 AM`, plus `, stale` when stale. @req FR:priorities-tables/web.sections.head */
export function stampText(t: { at: string; stale: boolean }): string {
  const time = new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ');
  return `as of ${time}${t.stale ? ', stale' : ''}`;
}
