/**
 * The HTTP side of Graph calls: bearer token, JSON, Graph host only. Guards decide what may be asked; this only carries it.
 * @req FR:day-inputs/graph.transport
 */
import type { GraphRequest, Transport } from '../email/guard';

export class GraphHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`Graph request failed: ${status} ${code}`);
    this.name = 'GraphHttpError';
  }
}

/** A token function may be asked to force a refresh after a 401. */
export interface GraphTransportOptions { token: string | ((o?: { force?: boolean }) => string | Promise<string>); fetch?: typeof fetch }

export function graphTransport(o: GraphTransportOptions): Transport {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async (req: GraphRequest) => {
    let u: URL;
    try { u = new URL(req.url); } catch { throw new GraphHttpError(0, 'BadUrl'); }
    if (u.origin !== 'https://graph.microsoft.com') throw new GraphHttpError(0, 'NotGraph');
    const send = async (force: boolean) => {
      const token = typeof o.token === 'function' ? await o.token(force ? { force } : undefined) : o.token;
      return get(req.url, {
        method: req.method,
        redirect: 'error',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
    };
    let res = await send(false);
    // A revoked token: refresh once and retry.
    if (res.status === 401 && typeof o.token === 'function') res = await send(true);
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) {
      const code = (data as { error?: { code?: unknown } } | undefined)?.error?.code;
      throw new GraphHttpError(res.status, typeof code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'Error');
    }
    return data;
  };
}
