/**
 * Graph diagnostics: the failing request id and status go to ~/.stack/graph.log; never a token or a query.
 * @req FR:connect-accounts/acct.diag
 */
import { mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { graphLogger, type GraphFailureRecord } from '../../src/graph/diag';
import { graphTransport } from '../../src/graph/transport';

describe('Graph diagnostics', () => {
  it('records path, status, code and request id of a failed call; sends a client-request-id', async () => {
    const seen: Headers[] = [];
    const fetch = (async (_u: string | URL | Request, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response('{"error":{"code":"UnknownError"}}', { status: 502, headers: { 'request-id': 'rid-1' } }); }) as typeof globalThis.fetch;
    const out: Omit<GraphFailureRecord, 'account'>[] = [];
    let t = 1000;
    const call = graphTransport({ token: 'SECRET-TOKEN', fetch, onFail: (r) => out.push(r), now: () => (t += 500) });
    await expect(call({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-11-12T00:00:00Z' })).rejects.toThrow();
    expect(seen[0].get('client-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0].get('return-client-request-id')).toBe('true');
    expect(out).toEqual([{ at: expect.any(String), method: 'GET', path: '/v1.0/me/calendarView', status: 502, code: 'UnknownError', requestId: 'rid-1', ms: 500 }]);
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
  it('a timeout is logged with the client-request-id Stack sent', async () => {
    let cid = '';
    const hang = ((_u: string | URL | Request, init?: RequestInit) => { cid = new Headers(init?.headers).get('client-request-id') ?? ''; return new Promise<Response>((_ok, no) => init?.signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))); }) as typeof fetch;
    const out: Omit<GraphFailureRecord, 'account'>[] = [];
    await expect(graphTransport({ token: 't', fetch: hang, timeoutMs: 20, onFail: (r) => out.push(r) })({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendar' })).rejects.toThrow();
    expect(out[0]).toMatchObject({ status: 0, code: 'Timeout', requestId: cid, path: '/v1.0/me/calendar' });
  });
  it('a failed token refresh is logged on the token path, then thrown as is', async () => {
    const out: Omit<GraphFailureRecord, 'account'>[] = [];
    const boom = Object.assign(new Error('refresh failed'), { code: 'temporarily_unavailable' });
    const call = graphTransport({ token: async () => { throw boom; }, fetch: (async () => new Response('{}')) as typeof fetch, onFail: (r) => out.push(r) });
    await expect(call({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendar' })).rejects.toBe(boom);
    expect(out).toEqual([expect.objectContaining({ path: '/oauth2/v2.0/token', status: 0, code: 'temporarily_unavailable' })]);
  });
  it('a 401 that a refresh fixes is still logged; each attempt has its own client-request-id', async () => {
    const ids: string[] = [];
    let n = 0;
    const fetch = (async (_u: string | URL | Request, init?: RequestInit) => { ids.push(new Headers(init?.headers).get('client-request-id') ?? ''); return new Response(++n === 1 ? '{"error":{"code":"InvalidAuthenticationToken"}}' : '{}', { status: n === 1 ? 401 : 200 }); }) as typeof globalThis.fetch;
    const out: Omit<GraphFailureRecord, 'account'>[] = [];
    await graphTransport({ token: async () => 't', fetch, onFail: (r) => out.push(r) })({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendar' });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(out).toEqual([expect.objectContaining({ status: 401, code: 'InvalidAuthenticationToken', requestId: ids[0] })]);
  });
  it('the log is one JSON line per failure, mode 0600', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'glog-')), '.stack', 'graph.log');
    const log = graphLogger(file);
    const r: GraphFailureRecord = { at: '2026-11-12T23:46:12Z', account: 'a@x.test', method: 'GET', path: '/v1.0/me/calendar', status: 502, code: 'UnknownError', requestId: 'rid', ms: 21000 };
    log(r); log(r);
    expect(readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))).toEqual([r, r]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
