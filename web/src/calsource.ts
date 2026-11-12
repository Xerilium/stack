/**
 * The calendar source as Now sees it: connected, fresh, or what is wrong and how to fix it. Pure.
 * The shape matches the inbox source status (`{kind, account, state, lastSyncAt}`).
 * @req FR:ux-consolidation/cal.status @req FR:ux-consolidation/cal.fresh @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.check
 */
import { freshness } from './asks';

export type SourceState = 'not-connected' | 'ok' | 'error' | 'stale';
/** One source's status: calendar, mail, GitHub. */
export interface SourceStatus { kind: string; account?: string; state: SourceState; lastSyncAt?: string }
export interface CalSource extends SourceStatus { kind: 'calendar'; via?: 'graph' | 'ics' | 'fixture' | 'none' }

/** A copy older than this is not fresh. */
export const FRESH_MS = 60 * 60_000;
/** The Graph sign-in for the calendar only (read scope). */
export const GRAPH_CMD = 'stack graph login --client-id <app id> --with calendar';

const STATES: readonly SourceState[] = ['not-connected', 'ok', 'error', 'stale'];
const VIA = ['graph', 'ics', 'fixture', 'none'] as const;

/** The source from a `GET /calendar` reply; an older host without `source` is read from `configured` and `error`. */
export function sourceOf(r: { configured: boolean; items?: unknown[]; error?: string; source?: unknown }, at: Date): CalSource {
  const s = r.source as Record<string, unknown> | undefined;
  if (s && typeof s === 'object' && STATES.includes(s.state as SourceState)) {
    return {
      kind: 'calendar', state: s.state as SourceState,
      ...(VIA.includes(s.via as never) ? { via: s.via as CalSource['via'] } : {}),
      ...(typeof s.account === 'string' && s.account ? { account: s.account } : {}),
      ...(typeof s.lastSyncAt === 'string' && Number.isFinite(Date.parse(s.lastSyncAt)) ? { lastSyncAt: s.lastSyncAt } : {}),
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

/** The one line Next shows when the source is not fresh, and its fix; null when fresh. */
export function calLine(s: CalSource | null, now: Date): { text: string; act: 'connect' | 'fix' | 'check' | null } | null {
  if (!s) return { text: 'Checking your calendar…', act: null };
  if (isFresh(s, now)) return null;
  if (s.state === 'not-connected') return { text: 'Calendar not connected', act: 'connect' };
  if (s.state === 'error') return { text: 'Calendar unavailable', act: 'fix' };
  return { text: s.lastSyncAt ? `Calendar last synced ${freshness(s.lastSyncAt, now)}` : 'Calendar out of date', act: 'check' };
}

/** What `Check connection` found. */
export function checkText(s: CalSource, now: Date): string {
  if (s.state === 'not-connected') return 'Not connected';
  if (s.state === 'error') return 'Calendar unavailable. Check the link, then try again.';
  const synced = s.lastSyncAt ? ` · synced ${freshness(s.lastSyncAt, now)}` : '';
  return isFresh(s, now) ? `Connected${s.account ? ` to ${s.account}` : ''}${synced}` : `Out of date${synced}`;
}
