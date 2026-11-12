/**
 * The HTTP side of Graph calls: bearer token, JSON, Graph host only, a hard 8 s cap per request. Guards decide what may be asked; this only carries it.
 * @req FR:day-inputs/graph.transport @req FR:connect-accounts/acct.timeout
 */
import type { GraphRequest, Transport } from '../email/guard';

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
export interface GraphTransportOptions { token: string | ((o?: { force?: boolean }) => string | Promise<string>); fetch?: typeof fetch; timeoutMs?: number }

const retryAfter = (h: string | null): number | undefined => {
  if (!h) return undefined;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s, 3600) * 1000 : undefined;
};

export function graphTransport(o: GraphTransportOptions): Transport {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ms = o.timeoutMs ?? GRAPH_TIMEOUT_MS;
  return async (req: GraphRequest) => {
    let u: URL;
    try { u = new URL(req.url); } catch { throw new GraphHttpError(0, 'BadUrl'); }
    if (u.origin !== 'https://graph.microsoft.com') throw new GraphHttpError(0, 'NotGraph');
    // One cap for the whole call, body included: a 502 that takes 20 s ends at 8 s.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    (timer as { unref?: () => void }).unref?.();
    const noReply = (e: unknown): never => {
      if (e instanceof GraphHttpError) throw e;
      // No reply: over the cap, or no network. Neither is a sign-in problem.
      const name = (e as { name?: string } | null)?.name;
      throw new GraphHttpError(0, ctl.signal.aborted || name === 'AbortError' || name === 'TimeoutError' ? 'Timeout' : 'Network');
    };
    const send = async (force: boolean) => {
      const token = typeof o.token === 'function' ? await o.token(force ? { force } : undefined) : o.token;
      return get(req.url, {
        method: req.method,
        redirect: 'error',
        signal: ctl.signal,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      }).catch(noReply);
    };
    try {
      let res = await send(false);
      // A revoked token: refresh once and retry.
      if (res.status === 401 && typeof o.token === 'function') res = await send(true);
      const text = await res.text().catch(noReply);
      let data: unknown;
      try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
      if (!res.ok) {
        const code = (data as { error?: { code?: unknown } } | undefined)?.error?.code;
        throw new GraphHttpError(res.status, typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'Error', res.status === 429 ? retryAfter(res.headers.get('retry-after')) : undefined);
      }
      return data;
    } finally { clearTimeout(timer); }
  };
}
