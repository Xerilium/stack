/**
 * The HTTP side of Graph calls: bearer token, JSON, Graph host only, a hard 8 s cap per request. Guards decide what may be asked; this only carries it.
 * @req FR:day-inputs/graph.transport @req FR:connect-accounts/acct.timeout
 */
import { randomUUID } from 'crypto';
import type { GraphRequest, Transport } from '../email/guard';
import type { GraphFailureRecord } from './diag';

/** `status` 0 is a request that got no reply: `Timeout` (over the cap) or `Network`. `retryAfterMs` is from a 429's `Retry-After`. */
export class GraphHttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfterMs?: number) {
    super(`Graph request failed: ${status} ${code}`);
    this.name = 'GraphHttpError';
  }
}

/** Every Graph and token request for an account read is capped at this. @req FR:connect-accounts/acct.timeout */
export const GRAPH_TIMEOUT_MS = 8000;

/** A fetch that aborts after `ms`; a caller's own signal still works. @req FR:connect-accounts/acct.timeout */
export function timedFetch(base: typeof fetch = (...a) => fetch(...a), ms = GRAPH_TIMEOUT_MS): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    (timer as { unref?: () => void }).unref?.();
    const outer = init.signal;
    const onOuter = () => ctl.abort();
    outer?.addEventListener('abort', onOuter);
    try { return await base(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); outer?.removeEventListener('abort', onOuter); }
  }) as typeof fetch;
}

/** A token function may be asked to force a refresh after a 401. */
export interface GraphTransportOptions {
  token: string | ((o?: { force?: boolean }) => string | Promise<string>); fetch?: typeof fetch; timeoutMs?: number;
  /** Called once per failed call with the path (no query), status, code and request id. Never a token. @req FR:connect-accounts/acct.diag */
  onFail?: (r: Omit<GraphFailureRecord, 'account'>) => void;
  now?: () => number;
}

/** The longest `Retry-After` kept (24 h): Graph's wait is kept in full; only an absurd value is bounded. */
const MAX_RETRY_AFTER_S = 24 * 3600;
const retryAfter = (h: string | null): number | undefined => {
  if (!h) return undefined;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s, MAX_RETRY_AFTER_S) * 1000 : undefined;
};

/** The path logged for a failed token refresh. No tenant, no query. @req FR:connect-accounts/acct.diag */
export const TOKEN_PATH = '/oauth2/v2.0/token';
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,80}$/;
const safe = (v: unknown): string | undefined => (typeof v === 'string' && SAFE_CODE.test(v) ? v : undefined);

export function graphTransport(o: GraphTransportOptions): Transport {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ms = o.timeoutMs ?? GRAPH_TIMEOUT_MS;
  return async (req: GraphRequest) => {
    let u: URL;
    try { u = new URL(req.url); } catch { throw new GraphHttpError(0, 'BadUrl'); }
    if (u.origin !== 'https://graph.microsoft.com') throw new GraphHttpError(0, 'NotGraph');
    const now = o.now ?? (() => Date.now());
    const t0 = now();
    /** One line per failed request; a failure is logged where it happens, once. @req FR:connect-accounts/acct.diag */
    let logged = false;
    const log = (path: string, status: number, code: string, requestId: string) => {
      logged = true;
      try { const end = now(); o.onFail?.({ at: new Date(end).toISOString(), method: req.method, path, status, code, requestId, ms: end - t0 }); } catch { /* never breaks the call */ }
    };
    // One cap for the whole call, token and body included: a 502 that takes 20 s ends at 8 s. @req FR:connect-accounts/acct.timeout
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    (timer as { unref?: () => void }).unref?.();
    const deadline = new Promise<never>((_ok, no) => ctl.signal.addEventListener('abort', () => no(new GraphHttpError(0, 'Timeout')), { once: true }));
    deadline.catch(() => undefined);
    const noReply = (e: unknown): never => {
      if (e instanceof GraphHttpError) throw e;
      // No reply: over the cap, or no network. Neither is a sign-in problem.
      const name = (e as { name?: string } | null)?.name;
      throw new GraphHttpError(0, ctl.signal.aborted || name === 'AbortError' || name === 'TimeoutError' ? 'Timeout' : 'Network');
    };
    /** The token, under the same cap: a stalled refresh ends at the deadline. A failed refresh is logged, then thrown as is. */
    const token = async (force: boolean): Promise<string> => {
      if (typeof o.token !== 'function') return o.token;
      try { return await Promise.race([Promise.resolve(o.token(force ? { force } : undefined)), deadline]); } catch (e) {
        const x = e as { status?: unknown; code?: unknown; name?: unknown } | null;
        log(TOKEN_PATH, typeof x?.status === 'number' ? x.status : 0, safe(x?.code) ?? safe(x?.name) ?? 'Error', randomUUID());
        throw e;
      }
    };
    // A fresh correlation id on every HTTP attempt, so each one can be traced, a timeout too. @req FR:connect-accounts/acct.diag
    const send = async (force: boolean): Promise<{ res: Response; rid: string }> => {
      const auth = await token(force);
      const cid = randomUUID();
      try {
        const res = await get(req.url, {
          method: req.method,
          redirect: 'error',
          signal: ctl.signal,
          headers: { authorization: `Bearer ${auth}`, accept: 'application/json', 'client-request-id': cid, 'return-client-request-id': 'true', ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        });
        return { res, rid: res.headers?.get?.('request-id') ?? cid };
      } catch (e) {
        try { return noReply(e); } catch (x) { if (x instanceof GraphHttpError) log(u.pathname, x.status, x.code, cid); throw x; }
      }
    };
    const body = async (res: Response): Promise<unknown> => {
      const text = await res.text().catch(noReply);
      try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
    };
    const codeOf = (data: unknown) => safe((data as { error?: { code?: unknown } } | undefined)?.error?.code) ?? 'Error';
    let rid = '';
    try {
      let r = await send(false);
      rid = r.rid;
      // A revoked token: log the failed call, refresh once and retry.
      if (r.res.status === 401 && typeof o.token === 'function') {
        log(u.pathname, 401, codeOf(await body(r.res).catch(() => undefined)), rid);
        logged = false;
        r = await send(true);
        rid = r.rid;
      }
      const data = await body(r.res);
      if (!r.res.ok) throw new GraphHttpError(r.res.status, codeOf(data), r.res.status === 429 ? retryAfter(r.res.headers?.get?.('retry-after') ?? null) : undefined);
      return data;
    } catch (e) {
      if (e instanceof GraphHttpError && !logged) log(u.pathname, e.status, e.code, rid);
      throw e;
    } finally { clearTimeout(timer); }
  };
}
