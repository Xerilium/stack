/** Inbox page types and helpers. @req FR:inbox-page/web.view */
export interface InboxRow {
  id: string; source: 'email' | 'teams' | 'slack' | 'github'; account: string; from: string; subject: string; receivedAt: string; unread: boolean; urgency?: number;
  summary: string; suggested: string; actions: string[]; link?: string; kind?: string;
}
export interface ActionInfo { id: string; label: string; ready: boolean }
export type ActResult = { ok: true; link?: string } | { ok: false; missing: true } | { via: 'issue'; url: string } | { via: 'task' };

export const SOURCE: Record<InboxRow['source'], string> = { email: 'Email', teams: 'Teams', slack: 'Slack', github: 'GitHub' };

/** The actions to show: the suggested one first as the primary, then the rest in catalog order. @req FR:inbox-page/web.view */
export function actionsFor(row: InboxRow, catalog: ActionInfo[]): { primary: ActionInfo | undefined; more: ActionInfo[] } {
  const by = new Map(catalog.map((a) => [a.id, a]));
  const ids = row.actions.filter((id) => by.has(id) && (id !== 'reply-draft' || row.source === 'email'));
  const primary = by.get(row.suggested);
  return { primary, more: ids.filter((id) => id !== row.suggested).map((id) => by.get(id)!) };
}

/** Next 9:00 local, as an ISO date for snooze. */
export const tomorrow = (now = new Date()): string => { const d = new Date(now.getTime() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ------------------------------------------------------------------ sources

export type SourceState = 'not-connected' | 'connecting' | 'ok' | 'error' | 'stale';
/** One inbox source, as the server reports it. `needs`, `command` and `doc` serve the CLI; the page never shows them. @req FR:inbox-page/web.nocmd @req FR:inbox-page/src.shape */
export interface SourceRow {
  kind: InboxRow['source']; account: string; state: SourceState; lastSyncAt?: string; error?: string; needs?: string; command?: string; connect?: boolean; doc?: string; mode?: 'read-only' | 'drafts'; planned?: boolean;
}
/** @req FR:inbox-page/src.summary */
export interface SourcesSummary { connected: number; total: number; fresh: number; attention: boolean; canClaimZero: boolean; headline: string | null }
export interface SourcesReply { sources: SourceRow[]; summary: SourcesSummary }

/** Never "Inbox zero" unless a source synced within its window. @req FR:inbox-page/web.empty */
export function emptyText(s: SourcesSummary | undefined): { zero: boolean; what: string } {
  if (!s) return { zero: false, what: 'Inbox status unknown' };
  if (s.canClaimZero) return { zero: true, what: 'Inbox zero. Nothing needs you.' };
  return { zero: false, what: s.headline ?? 'No inboxes connected' };
}
/** The one quiet line above the list: the headline, or nothing. Setup lives in Settings > Accounts. @req FR:inbox-page/web.status */
export const statusLine = (s: SourcesSummary | undefined): string | null => s?.headline ?? null;
