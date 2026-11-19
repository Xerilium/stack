/**
 * The priorities report on Now: the view the host builds (`GET /priorities`) and the parts the page draws.
 * Rows, order and stamps are built in the core (`src/core/priorities-view.ts`); the page only draws them.
 * @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.links @req FR:priorities-tables/web.tabs.head
 */
export type AgentStatus = 'working' | 'pairing' | 'done' | 'idle' | 'blocked' | 'queued' | 'unknown';
/** `session`: the id a prompt takes (`POST /sessions/{id}/prompt`), or null. @req FR:priorities-tables/agent.session */
export interface Agent { name: string; link: string | null; file: string | null; session: string | null }
export interface PriRow { id: string; project: string; file: string | null; agent: Agent | null; more: number; status: AgentStatus | null; action: string; gap: boolean; /** Gap rows: the CoS who must add the task, and the text to send to it. */ cos: Agent | null; request: string | null; ref: string | null; at: string; stale: boolean }
export interface PriTable { at: string; stale: boolean; rows: PriRow[] }
export interface QmTable extends PriTable { title: string; today: boolean }
export interface PrRow { emoji: string; number: number; url: string; agent: Agent | null; /** The priority the PR links to. @req FR:priorities-tables/pr.cols.pri */ pri?: string | null; action: string; minutes: number; server: string | null; details: string | null }
export interface PrTable { at: string; stale: boolean; verified: boolean; manager: Agent | null; rows: PrRow[] }
export interface PrioritiesView { at: string; timeZone?: string; qm: QmTable | null; now: PriTable; prs: PrTable; today: PriTable; next: PriTable }

/** @req FR:priorities-tables/web.table */
export const PRI_COLS = ['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action'] as const;
export const PR_COLS = ['PR', 'Agent', '👱‍♂️ Next action', 'Time'] as const;

export type TabKey = 'qm' | 'now' | 'prs' | 'today' | 'next';
export type Section = { key: 'qm' | 'now' | 'today' | 'next'; title: string; t: PriTable } | { key: 'prs'; title: string; t: PrTable };
/** QM (when set), Now, PRs, Today, Next 3 days. @req FR:priorities-tables/web.tabs */
export function sectionsOf(v: PrioritiesView): Section[] {
  return [
    ...(v.qm ? [{ key: 'qm' as const, title: v.qm.title, t: v.qm }] : []),
    { key: 'now', title: 'Now', t: v.now }, { key: 'prs', title: 'PRs', t: v.prs },
    { key: 'today', title: 'Today', t: v.today }, { key: 'next', title: 'Next 3 days', t: v.next },
  ];
}

export const STATUS: Record<AgentStatus, { icon: string; word: string }> = { working: { icon: '🔄', word: 'Working' }, pairing: { icon: '🤝', word: 'Pairing' }, done: { icon: '✅', word: 'Done' }, idle: { icon: '⏸️', word: 'Idle' }, blocked: { icon: '🚫', word: 'Blocked' }, queued: { icon: '🕓', word: 'Queued' }, unknown: { icon: '❓', word: 'Unknown' } };
/** Icon and one word; `--` with no agent. @req FR:priorities-tables/tasks.status */
export const statusText = (s: AgentStatus | null): string => (s ? `${STATUS[s].icon} ${STATUS[s].word}` : '--');

/** Links the page may draw: the web or a Claude session. @req FR:priorities-tables/web.links */
export const safeHref = (h: string | null | undefined): h is string => !!h && (/^https?:\/\//i.test(h) || /^#\/[a-z]+(\?[\w=&%./-]*)?$/.test(h) || /^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]{1,128}$/.test(h));

/** `as of 11:05 AM`, plus `, stale` when stale. @req FR:priorities-tables/web.tabs.head */
export function stampText(t: { at: string; stale: boolean }, timeZone?: string): string {
  const time = new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).replace(/\s/g, ' ');
  return `as of ${time}${t.stale ? ', stale' : ''}`;
}

/** Real rows only: gap rows never count. @req FR:priorities-tables/web.tabs.count */
export const countOf = (s: Section): number => (s.key === 'prs' ? s.t.rows.length : s.t.rows.filter((r) => !r.gap).length);
/** `Now (3)`. @req FR:priorities-tables/web.tabs.count */
export const tabLabel = (s: Section): string => `${s.title} (${countOf(s)})`;
/** QM on QM days, else Now. @req FR:priorities-tables/web.tabs.default */
export const defaultTab = (v: PrioritiesView): TabKey => (v.qm?.today ? 'qm' : 'now');
const KEYS: TabKey[] = ['qm', 'now', 'prs', 'today', 'next'];
/** The tab in the hash (`#/now?pri=prs`), if any. @req FR:priorities-tables/web.tabs.hash */
export function tabFromHash(hash: string): TabKey | undefined {
  const q = hash.indexOf('?');
  const t = q < 0 ? null : new URLSearchParams(hash.slice(q + 1)).get('pri');
  return KEYS.includes(t as TabKey) ? (t as TabKey) : undefined;
}
/** The hash with the tab set, other params kept. @req FR:priorities-tables/web.tabs.hash */
export function hashWithTab(hash: string, tab: TabKey): string {
  const q = hash.indexOf('?');
  const base = (q < 0 ? hash : hash.slice(0, q)) || '#/now';
  const p = new URLSearchParams(q < 0 ? '' : hash.slice(q + 1));
  p.set('pri', tab);
  return `${base}?${p.toString()}`;
}

/** The gap marker for a missing link target. @req FR:priorities-tables/web.links.gap */
export const NO_LINK = '⚠ no link';
/** The project page: the list filtered to the project file. @req FR:priorities-tables/web.links.project */
export const projectHref = (file: string | null): string | null => {
  const m = file ? /^tasks\/([^/]+)\.md$/.exec(file) : null;
  return m ? `#/list?project=${encodeURIComponent(m[1])}` : null;
};
/** The agent: its session, else its agent file in the Agents view. @req FR:priorities-tables/web.links.agent */
export const agentHref = (a: Agent): string | null => a.link ?? (a.file ? `#/agents?file=${encodeURIComponent(a.file)}` : null);
export interface Part { text: string; href?: string; gap?: boolean }
/** Markdown links and URLs become links; the gap marker stays a marker. @req FR:priorities-tables/web.links.refs */
export function linkParts(text: string): Part[] {
  const out: Part[] = [];
  for (const [i, s] of text.split(/(\[[^\]]*\]\([^)\s]*\)|https?:\/\/\S+)/g).entries()) {
    if (!s) continue;
    if (i % 2) {
      const m = /^\[([^\]]*)\]\(([^)\s]*)\)$/.exec(s);
      out.push(m ? { text: m[1], href: m[2] } : { text: s, href: s });
      continue;
    }
    s.split(NO_LINK).forEach((t, j) => { if (j) out.push({ text: NO_LINK, gap: true }); if (t) out.push({ text: t }); });
  }
  return out;
}
