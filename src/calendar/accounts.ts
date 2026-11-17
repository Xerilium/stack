/**
 * The live calendar over every connected Microsoft account: Graph `calendarView` per account, a 3 minute copy each,
 * merged and de-duplicated; the ICS feeds when no account has a calendar. Never logs a token.
 * @req FR:connect-accounts/cal.live @req FR:connect-accounts/cal.ttl @req FR:connect-accounts/cal.fallback @req FR:connect-accounts/cal.info @req FR:connect-accounts/acct.health
 * @req FR:connect-accounts/cal.account @req FR:connect-accounts/cal.isolate @req FR:connect-accounts/acct.retry @req FR:connect-accounts/acct.timeout
 */
import { basename } from 'path';
import { cacheDir as defaultCacheDir, cachePathsWith, FileTokenCache, graphToken, hasScope } from '../graph/auth';
import { GRAPH_TIMEOUT_MS, GraphHttpError, graphTransport, timedFetch } from '../graph/transport';
import { AccountHealth, type GraphFailure } from '../graph/connect';
import { graphLogger, type GraphFailureRecord } from '../graph/diag';
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
  /** Failure records for `~/.stack/graph.log`; default writes there. @req FR:connect-accounts/acct.diag */
  log?: (r: GraphFailureRecord) => void;
  /** The most one account read may take, every page included; default 8 s. @req FR:connect-accounts/cal.isolate */
  accountMs?: number;
}

/** Ends a read at `ms` as a timeout (`down`); a late answer is dropped. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_ok, no) => { timer = setTimeout(() => no(new GraphHttpError(0, 'Timeout')), ms); (timer as { unref?: () => void }).unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export function createAccountsCalendar(o: AccountsCalendarOptions = {}): CalendarProvider {
  const now = o.now ?? (() => Date.now());
  const ttl = o.ttlMs ?? ACCOUNT_TTL_MS;
  const accountMs = o.accountMs ?? GRAPH_TIMEOUT_MS;
  const providers = new Map<string, CalendarProvider>();
  const copies = new Map<string, { at: number; events: CalendarEvent[] }>();
  let last: CalendarInfo | undefined;
  // Health is always tracked, so the backoff works even when no shared health is passed.
  const health = o.health ?? new AccountHealth();
  const log = o.log ?? graphLogger();
  // The token refresh gets the same 8 s cap as the Graph read. @req FR:connect-accounts/acct.timeout
  const make = o.provider ?? ((_a: string, cache: FileTokenCache) => createGraphCalendar({ transport: graphTransport({ token: graphToken(cache, { fetch: timedFetch(o.fetch) }), ...(o.fetch ? { fetch: o.fetch } : {}), onFail: (r) => log({ ...r, ...(_a ? { account: _a } : {}) }) }) }));

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
      const failed: GraphFailure[] = [];
      let oldest = Infinity;
      let any = false;
      // One slot per account, in list order, so a meeting on two calendars always keeps the same account.
      const slots: CalendarEvent[][] = list.map(() => []);
      await Promise.all(list.map(async ({ account, cache }, i) => {
        const key = `${account}|${from}|${to}`;
        let c = copies.get(key);
        // The health key: an unnamed cache uses its file. @req FR:connect-accounts/acct.retry
        const who = account || cache.path;
        if (!c || now() - c.at >= ttl) {
          if (!health.canTry(who, now())) {
            // Waiting for the retry time: no call, the last copy (if any) serves. A throttled account keeps its state.
            const m = health.get(who);
            if (m) { partial = true; failed.push(m === 'expired' ? 'signin' : m === 'down' ? 'down' : 'other'); }
            // Throttled with no copy yet: its meetings are missing, so the source is not ok.
            else if (!c) { partial = true; failed.push('down'); }
          } else {
            // By file: a sign-in that moves an account to its own file gets a new provider.
            const p = providers.get(cache.path) ?? make(account, cache);
            providers.set(cache.path, p);
            try {
              // A slow account (many pages, or a stall) never holds the others past the cap.
              const list = await within(p.events(from, to), accountMs);
              c = { at: now(), events: account ? list.map((e) => ({ ...e, account })) : list };
              copies.set(key, c);
              health.ok(who, now());
            } catch (e) {
              const kind = health.fail(who, e, now());
              // A 429 with a copy backs off silently; with no copy the meetings are missing.
              if (kind !== 'throttled' || !c) { partial = true; failed.push(kind === 'throttled' ? 'down' : kind); }
            }
          }
        }
        if (!c) return;
        any = true;
        oldest = Math.min(oldest, c.at);
        slots[i] = c.events;
      }));
      const all = slots.flat();
      // Copies for other ranges age out with the day; keep the map small.
      for (const [k, v] of copies) if (now() - v.at > ttl * 20) copies.delete(k);
      const reason = failed.includes('signin') ? 'signin' : failed.includes('down') ? 'down' : failed.length ? 'error' : undefined;
      if (!any) { last = { via: 'graph', partial: true, ...(reason ? { reason } : {}) }; throw new Error('Calendar unavailable'); }
      const names = list.map((x) => x.account).filter(Boolean).sort();
      last = { via: 'graph', account: names.length > MAX_SHOWN ? `${names.slice(0, MAX_SHOWN).join(', ')} +${names.length - MAX_SHOWN}` : names.join(', '), syncedAt: oldest, partial, ...(partial && reason ? { reason } : {}) };
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
