/**
 * The live calendar over every connected Microsoft account: Graph `calendarView` per account, a 3 minute copy each,
 * merged and de-duplicated; the ICS feeds when no account has a calendar. Never logs a token.
 * @req FR:connect-accounts/cal.live @req FR:connect-accounts/cal.ttl @req FR:connect-accounts/cal.fallback @req FR:connect-accounts/cal.info @req FR:connect-accounts/acct.health
 */
import { basename } from 'path';
import { cacheDir as defaultCacheDir, cachePathsWith, FileTokenCache, graphToken, GraphSignInRequired, hasScope } from '../graph/auth';
import { graphTransport } from '../graph/transport';
import type { AccountHealth } from '../graph/connect';
import { createGraphCalendar, type CalendarEvent, type CalendarInfo, type CalendarProvider } from './index';

/** No account with a calendar and no fallback: the source is not connected. */
export class CalendarNotConnected extends Error {
  constructor() { super('Calendar not connected'); this.name = 'CalendarNotConnected'; }
}

export const ACCOUNT_TTL_MS = 3 * 60_000;
const MAX_SHOWN = 3;

export interface AccountsCalendarOptions {
  /** Token cache folder; default `~/.config/stack` (or beside `STACK_GRAPH_CACHE`). */
  dir?: string;
  /** An explicit cache file (`STACK_GRAPH_CACHE`), read even when its name is not `graph-token*.json`. */
  cachePath?: string;
  fallback?: CalendarProvider;
  health?: AccountHealth;
  now?: () => number;
  ttlMs?: number;
  fetch?: typeof fetch;
  /** A provider for one account; tests replace it. */
  provider?: (account: string, cache: FileTokenCache) => CalendarProvider;
}

export function createAccountsCalendar(o: AccountsCalendarOptions = {}): CalendarProvider {
  const now = o.now ?? (() => Date.now());
  const ttl = o.ttlMs ?? ACCOUNT_TTL_MS;
  const providers = new Map<string, CalendarProvider>();
  const copies = new Map<string, { at: number; events: CalendarEvent[] }>();
  let last: CalendarInfo | undefined;
  const make = o.provider ?? ((_a: string, cache: FileTokenCache) => createGraphCalendar({ transport: graphTransport({ token: graphToken(cache, o.fetch ? { fetch: o.fetch } : {}), ...(o.fetch ? { fetch: o.fetch } : {}) }) }));

  /** Every cache with Calendars.Read, by account (an unnamed cache uses its file name). */
  async function calendars(): Promise<{ account: string; cache: FileTokenCache }[]> {
    const out: { account: string; cache: FileTokenCache }[] = [];
    for (const p of cachePathsWith(o.dir ?? defaultCacheDir(), o.cachePath)) {
      const cache = new FileTokenCache(p);
      const t = await cache.read().catch(() => null);
      if (!t || !hasScope(t.scopes, 'Calendars.Read')) continue;
      out.push({ account: (t.account ?? /^graph-token-(.+)\.json$/.exec(basename(p))?.[1] ?? '').toLowerCase(), cache });
    }
    return out;
  }

  return {
    info: () => (last ? { ...last } : o.fallback?.info?.() ?? { via: 'graph' }),
    async events(from, to) {
      const list = await calendars();
      if (!list.length) {
        if (!o.fallback) { last = undefined; throw new CalendarNotConnected(); }
        const ev = await o.fallback.events(from, to);
        last = o.fallback.info?.();
        return ev;
      }
      let partial = false;
      let oldest = Infinity;
      let any = false;
      const all: CalendarEvent[] = [];
      await Promise.all(list.map(async ({ account, cache }) => {
        const key = `${account}|${from}|${to}`;
        let c = copies.get(key);
        if (!c || now() - c.at >= ttl) {
          // By file: a sign-in that moves an account to its own file gets a new provider.
          const p = providers.get(cache.path) ?? make(account, cache);
          providers.set(cache.path, p);
          try {
            c = { at: now(), events: await p.events(from, to) };
            copies.set(key, c);
            if (account) o.health?.clear(account);
          } catch (e) {
            partial = true;
            if (account) o.health?.mark(account, e instanceof GraphSignInRequired ? 'expired' : 'error');
          }
        }
        if (!c) return;
        any = true;
        oldest = Math.min(oldest, c.at);
        all.push(...c.events);
      }));
      // Copies for other ranges age out with the day; keep the map small.
      for (const [k, v] of copies) if (now() - v.at > ttl * 20) copies.delete(k);
      if (!any) { last = { via: 'graph', partial: true }; throw new Error('Calendar unavailable'); }
      const names = list.map((x) => x.account).filter(Boolean).sort();
      last = { via: 'graph', account: names.length > MAX_SHOWN ? `${names.slice(0, MAX_SHOWN).join(', ')} +${names.length - MAX_SHOWN}` : names.join(', '), syncedAt: oldest, partial };
      // The same meeting on two calendars shows once.
      const seen = new Set<string>();
      return all.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).filter((e) => {
        const k = `${e.subject}|${e.start}|${e.end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  };
}
