import { createApiHandler } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, parseOwners } from '../../src/api/auth';
import { MemoryStorage } from '../../src/core/storage';

export const NOW = new Date('2026-10-22T18:00:00Z');
export const OWNER = { provider: 'github', userId: 'owner-1' };

export const principal = (over: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({
    identityProvider: 'github', userId: 'owner-1', userDetails: 'octocat', userRoles: ['anonymous', 'authenticated'], ...over,
  })).toString('base64');

export function setup(opts: { owners?: string; onEvent?: (e: unknown) => void; pepper?: string } = {}) {
  const store = new MemoryTokenStore();
  const tokens = createTokenService({ store, now: () => NOW, pepper: opts.pepper });
  const auth = createAuth({ owners: parseOwners(opts.owners ?? 'github:owner-1'), tokens, onEvent: opts.onEvent });
  const storage = new MemoryStorage();
  const logs: unknown[] = [];
  const api = createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, onError: (e) => logs.push(e) });
  const handler = auth.wrap(api);
  const call = async (method: string, path: string, o: { body?: unknown; headers?: Record<string, string>; session?: boolean } = {}) => {
    const headers: Record<string, string> = { ...(o.session ? { 'x-ms-client-principal': principal() } : {}), ...(o.headers ?? {}) };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const res = await handler(new Request(`https://stack.test${path}`, {
      method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    }));
    const text = await res.text();
    let json: any; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, headers: res.headers, text, json };
  };
  return { store, tokens, auth, storage, handler, call, logs };
}
