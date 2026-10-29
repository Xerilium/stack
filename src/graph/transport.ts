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

export interface GraphTransportOptions { token: string | (() => string | Promise<string>); fetch?: typeof fetch }

export function graphTransport(o: GraphTransportOptions): Transport {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async (req: GraphRequest) => {
    let u: URL;
    try { u = new URL(req.url); } catch { throw new GraphHttpError(0, 'BadUrl'); }
    if (u.origin !== 'https://graph.microsoft.com') throw new GraphHttpError(0, 'NotGraph');
    const token = typeof o.token === 'function' ? await o.token() : o.token;
    const res = await get(req.url, {
      method: req.method,
      redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    });
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
