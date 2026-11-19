/**
 * The priorities tables on Now: the view the host builds (`GET /priorities`) and the parts the page draws.
 * Rows, order and stamps are built in the core (`src/core/priorities-view.ts`); the page only draws them.
 * @req FR:priorities-tables/web.tables @req FR:priorities-tables/web.links @req FR:priorities-tables/web.tables.head
 */
export interface PriRow { id: string; project: string; agent: { name: string; link: string } | null; action: string; at: string; stale: boolean }
export interface PriTable { at: string; stale: boolean; rows: PriRow[] }
export interface PrRow { project: string; number: number; url: string; title: string; at: string; stale: boolean }
export interface PrTable { at: string; stale: boolean; rows: PrRow[] }
export interface PrioritiesView { at: string; now: PriTable; autopilot: PrTable; today: PriTable; next: PriTable }

/** The four sections, top to bottom, with their columns. @req FR:priorities-tables/web.tables @req FR:priorities-tables/web.tables.cols */
export const TABLES = [
  { key: 'now', title: 'Now', cols: ['Project', 'Agent', 'Next action'] },
  { key: 'autopilot', title: 'Promote to Autopilot', cols: ['Project', 'PR', 'Title'] },
  { key: 'today', title: 'Today', cols: ['Project', 'Agent', 'Next action'] },
  { key: 'next', title: 'Next 3 days', cols: ['Project', 'Agent', 'Next action'] },
] as const;

/** Links the page may draw: the web or a Claude session. @req FR:priorities-tables/web.links */
export const safeHref = (h: string | undefined): h is string => !!h && (/^https?:\/\//i.test(h) || /^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]{1,128}$/.test(h));

/** `as of 11:05 AM`, plus `, stale` when stale. @req FR:priorities-tables/web.tables.head */
export function stampText(t: { at: string; stale: boolean }): string {
  const time = new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ');
  return `as of ${time}${t.stale ? ', stale' : ''}`;
}
