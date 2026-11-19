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

/** The result words for the actions the page knows. @req FR:inbox-page/web.toast */
const DONE_TEXT: Record<string, string> = { 'mark-done': 'Marked done', snooze: 'Snoozed until tomorrow', 'ask-me-later': 'Deferred until tomorrow', 'create-task': 'Task created' };
/** The toast after an action ran: the result in plain words, never the button label twice. @req FR:inbox-page/web.toast @req FR:inbox-page/web.toast.other */
export const doneText = (a: ActionInfo): string => DONE_TEXT[a.id] ?? 'Done';

/** Next 9:00 local, as an ISO date for snooze. */
export const tomorrow = (now = new Date()): string => { const d = new Date(now.getTime() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ------------------------------------------------------------------ detail

/** @req FR:inbox-page/detail.api */
export interface Person { name?: string; address: string }
export interface MailMessage { id: string; from: Person; to: Person[]; subject: string; receivedAt: string; body: string; mine: boolean }
export interface DetailReply { item: InboxRow; live: boolean; message?: MailMessage; thread?: MailMessage[] }

/** `Name <address>`, the address alone, or `You` for the owner. @req FR:inbox-page/detail.head @req FR:inbox-page/detail.thread.mine */
export const person = (p: Person, mine = false): string => (mine ? 'You' : p.name && p.name !== p.address ? `${p.name} <${p.address}>` : p.address || p.name || 'Unknown sender');
/** @req FR:inbox-page/detail.offline */
export const openLabel = (source: InboxRow['source']): string => `Open in ${source === 'email' ? 'Outlook' : SOURCE[source]}`;
/** A short local date and time; a value that is not a date stays as it is. */
export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ------------------------------------------------------------------ sources

export type SourceState = 'not-connected' | 'connecting' | 'ok' | 'error' | 'stale';
/** One inbox source, as the server reports it. `needs`, `command` and `doc` serve the CLI; the page never shows them. @req FR:inbox-page/web.nocmd @req FR:inbox-page/src.shape */
export interface SourceRow {
  kind: InboxRow['source']; account: string; state: SourceState; lastSyncAt?: string; error?: string; needs?: string; command?: string; connect?: boolean; doc?: string; mode?: 'read-only' | 'drafts'; planned?: boolean;
}
/** @req FR:inbox-page/src.summary */
export interface SourcesSummary { connected: number; total: number; fresh: number; attention: boolean; canClaimZero: boolean; headline: string | null }
export interface SourcesReply { sources: SourceRow[]; summary: SourcesSummary }

/** Never "Inbox zero" unless every source synced within its window. @req FR:inbox-page/web.empty @req FR:inbox-page/web.empty.headline @req FR:inbox-page/web.empty.unknown */
export function emptyText(s: SourcesSummary | undefined): { zero: boolean; what: string } {
  if (!s) return { zero: false, what: 'Inbox status unknown' };
  if (s.canClaimZero) return { zero: true, what: 'Inbox zero. Nothing needs you.' };
  return { zero: false, what: s.headline ?? 'No inboxes connected' };
}
/** The one quiet line above the list: the headline, or nothing. Setup lives in Settings > Accounts. @req FR:inbox-page/web.status */
export const statusLine = (s: SourcesSummary | undefined): string | null => s?.headline ?? null;
