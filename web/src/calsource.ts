/**
 * The calendar source as Now sees it: connected, fresh, or what is wrong and how to fix it. Pure.
 * The shape matches the inbox source status (`{kind, account, state, lastSyncAt}`).
 * @req FR:ux-consolidation/cal.status @req FR:ux-consolidation/cal.fresh @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.check @req FR:connect-accounts/web.now
 */
import { freshness } from './asks';

export type SourceState = 'not-connected' | 'ok' | 'error' | 'stale';
/** One source's status: calendar, mail, GitHub. */
export interface SourceStatus { kind: string; account?: string; state: SourceState; lastSyncAt?: string }
export interface CalSource extends SourceStatus { kind: 'calendar'; via?: 'graph' | 'ics' | 'fixture' | 'none'; /** Graph only: why it is in error. */ reason?: 'signin' | 'down' | 'error' }

/** A copy older than this is not fresh. */
export const FRESH_MS = 60 * 60_000;

const STATES: readonly SourceState[] = ['not-connected', 'ok', 'error', 'stale'];
const VIA = ['graph', 'ics', 'fixture', 'none'] as const;
const REASONS = ['signin', 'down', 'error'] as const;

/** The source from a `GET /calendar` reply; an older host without `source` is read from `configured` and `error`. */
export function sourceOf(r: { configured: boolean; items?: unknown[]; error?: string; source?: unknown }, at: Date): CalSource {
  const s = r.source as Record<string, unknown> | undefined;
  if (s && typeof s === 'object' && STATES.includes(s.state as SourceState)) {
    return {
      kind: 'calendar', state: s.state as SourceState,
      ...(VIA.includes(s.via as never) ? { via: s.via as CalSource['via'] } : {}),
      ...(typeof s.account === 'string' && s.account ? { account: s.account } : {}),
      ...(typeof s.lastSyncAt === 'string' && Number.isFinite(Date.parse(s.lastSyncAt)) ? { lastSyncAt: s.lastSyncAt } : {}),
      ...(REASONS.includes(s.reason as never) ? { reason: s.reason as CalSource['reason'] } : {}),
    };
  }
  if (!r.configured) return { kind: 'calendar', state: 'not-connected' };
  return r.error ? { kind: 'calendar', state: 'error' } : { kind: 'calendar', state: 'ok', lastSyncAt: at.toISOString() };
}

/** Only an `ok` source read under an hour ago may say "No meetings". */
export function isFresh(s: CalSource | null, now: Date): boolean {
  if (!s || s.state !== 'ok' || !s.lastSyncAt) return false;
  return now.getTime() - Date.parse(s.lastSyncAt) < FRESH_MS;
}

/** The one quiet line Now shows when the calendar is not fresh; it links to Settings > Accounts. Null when fresh or still loading. @req FR:connect-accounts/web.now */
export function calLine(s: CalSource | null, now: Date): { text: string } | null {
  if (!s || isFresh(s, now)) return null;
  if (s.state === 'not-connected') return { text: 'Calendar not connected' };
  if (s.state === 'error') return { text: s.reason === 'down' ? 'Calendar: Microsoft not responding' : s.reason === 'signin' ? 'Calendar needs sign-in' : 'Calendar unavailable' };
  return { text: s.lastSyncAt ? `Calendar last synced ${freshness(s.lastSyncAt, now)}` : 'Calendar out of date' };
}

/** What `Check connection` found. An outage never says to sign in again. @req FR:ux-consolidation/cal.check */
export function checkText(s: CalSource, now: Date): string {
  if (s.state === 'not-connected') return 'Not connected';
  if (s.state === 'error') {
    if (s.via !== 'graph') return 'Calendar unavailable. Check the link, then try again.';
    return s.reason === 'down' ? 'Microsoft is not responding. Stack retries on its own.' : s.reason === 'signin' ? 'An account needs sign-in. Select Fix on it.' : 'Calendar unavailable.';
  }
  const synced = s.lastSyncAt ? ` · synced ${freshness(s.lastSyncAt, now)}` : '';
  return isFresh(s, now) ? `Connected${s.account ? ` to ${s.account}` : ''}${synced}` : `Out of date${synced}`;
}
