/**
 * Honest Graph errors: sign-in vs Microsoft not responding vs throttled, per-account backoff, last good read, and the 8 s cap.
 * @req FR:connect-accounts/acct.health @req FR:connect-accounts/acct.retry @req FR:connect-accounts/acct.timeout
 */
import { GraphSignInError, GraphSignInRequired } from '../../src/graph/auth';
import { AccountHealth, BACKOFF_MS, classifyGraphError } from '../../src/graph/connect';
import { GRAPH_TIMEOUT_MS, graphTransport, GraphHttpError, timedFetch } from '../../src/graph/transport';

describe('classifyGraphError', () => {
  // @req FR:connect-accounts/acct.health
  it('401, 403, consent and refused refresh tokens need sign-in', () => {
    expect(classifyGraphError(new GraphSignInRequired())).toBe('signin');
    expect(classifyGraphError(new GraphHttpError(401, 'InvalidAuthenticationToken'))).toBe('signin');
    expect(classifyGraphError(new GraphHttpError(403, 'ErrorAccessDenied'))).toBe('signin');
    expect(classifyGraphError(new GraphSignInError('interaction_required'))).toBe('signin');
    expect(classifyGraphError(new GraphSignInError('invalid_grant'))).toBe('signin');
  });
  // @req FR:connect-accounts/acct.health
  it('5xx, timeouts, network failures and a token endpoint outage are Microsoft not responding', () => {
    expect(classifyGraphError(new GraphHttpError(502, 'UnknownError'))).toBe('down');
    expect(classifyGraphError(new GraphHttpError(503, 'Error'))).toBe('down');
    expect(classifyGraphError(new GraphHttpError(504, 'Error'))).toBe('down');
    expect(classifyGraphError(new GraphHttpError(0, 'Timeout'))).toBe('down');
    expect(classifyGraphError(new GraphHttpError(0, 'Network'))).toBe('down');
    expect(classifyGraphError(new TypeError('fetch failed'))).toBe('down');
    expect(classifyGraphError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('down');
    expect(classifyGraphError(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe('down');
    expect(classifyGraphError(new GraphSignInError('server_error'))).toBe('down');
    expect(classifyGraphError(new GraphSignInError('temporarily_unavailable'))).toBe('down');
  });
  // @req FR:connect-accounts/acct.health
  it('429 is throttled; anything else is other', () => {
    expect(classifyGraphError(new GraphHttpError(429, 'TooManyRequests'))).toBe('throttled');
    expect(classifyGraphError(new GraphHttpError(400, 'BadRequest'))).toBe('other');
    expect(classifyGraphError(new Error('boom'))).toBe('other');
    expect(classifyGraphError('x')).toBe('other');
  });
});

describe('AccountHealth', () => {
  const T0 = Date.parse('2026-11-12T12:00:00Z');
  // @req FR:connect-accounts/acct.retry
  it('backs off 30 s, 2 min, then 10 min after failures in a row; a good read resets', () => {
    expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000]);
    const h = new AccountHealth();
    expect(h.canTry('a@x.test', T0)).toBe(true);
    h.fail('A@x.test', new GraphHttpError(502, 'UnknownError'), T0);
    expect(h.get('a@x.test')).toBe('down');
    expect(h.retryAt('a@x.test')).toBe(T0 + 30_000);
    expect(h.canTry('a@x.test', T0 + 29_999)).toBe(false);
    expect(h.canTry('a@x.test', T0 + 30_000)).toBe(true);
    h.fail('a@x.test', new GraphHttpError(0, 'Timeout'), T0 + 30_000);
    expect(h.retryAt('a@x.test')).toBe(T0 + 30_000 + 120_000);
    h.fail('a@x.test', new GraphHttpError(503, 'Error'), T0 + 200_000);
    expect(h.retryAt('a@x.test')).toBe(T0 + 200_000 + 600_000);
    h.fail('a@x.test', new GraphHttpError(503, 'Error'), T0 + 900_000);
    expect(h.retryAt('a@x.test')).toBe(T0 + 900_000 + 600_000);
    h.ok('a@x.test', T0 + 2_000_000);
    expect(h.get('a@x.test')).toBeUndefined();
    expect(h.retryAt('a@x.test')).toBeUndefined();
    expect(h.lastOk('a@x.test')).toBe(T0 + 2_000_000);
    h.fail('a@x.test', new GraphHttpError(502, 'UnknownError'), T0 + 3_000_000);
    expect(h.retryAt('a@x.test')).toBe(T0 + 3_000_000 + 30_000);
    // The last good read survives a failure.
    expect(h.lastOk('a@x.test')).toBe(T0 + 2_000_000);
  });
  // @req FR:connect-accounts/acct.health
  it('marks sign-in as expired and others as error', () => {
    const h = new AccountHealth();
    h.fail('a@x.test', new GraphSignInRequired(), T0);
    expect(h.get('a@x.test')).toBe('expired');
    h.fail('b@x.test', new Error('boom'), T0);
    expect(h.get('b@x.test')).toBe('error');
  });
  // @req FR:connect-accounts/acct.retry
  it('429 waits Retry-After (else 30 s), keeps the mark, and does not count as a failure in a row', () => {
    const h = new AccountHealth();
    h.ok('a@x.test', T0);
    h.fail('a@x.test', new GraphHttpError(429, 'TooManyRequests', 90_000), T0);
    expect(h.get('a@x.test')).toBeUndefined();
    expect(h.retryAt('a@x.test')).toBe(T0 + 90_000);
    h.fail('b@x.test', new GraphHttpError(429, 'TooManyRequests'), T0);
    expect(h.retryAt('b@x.test')).toBe(T0 + 30_000);
    // The next real failure is still the first in a row.
    h.fail('a@x.test', new GraphHttpError(502, 'UnknownError'), T0 + 90_000);
    expect(h.retryAt('a@x.test')).toBe(T0 + 90_000 + 30_000);
  });
  // @req FR:connect-accounts/acct.retry
  it('clear (sign-in, disconnect) resets the count and the wait', () => {
    const h = new AccountHealth();
    h.fail('a@x.test', new GraphHttpError(502, 'UnknownError'), T0);
    h.clear('a@x.test');
    expect(h.canTry('a@x.test', T0)).toBe(true);
    expect(h.get('a@x.test')).toBeUndefined();
  });
});

describe('Graph request cap', () => {
  // @req FR:connect-accounts/acct.timeout
  it('the cap is 8 s', () => expect(GRAPH_TIMEOUT_MS).toBe(8000));

  // @req FR:connect-accounts/acct.timeout
  it('aborts a request over the cap as a Timeout', async () => {
    const hang = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_ok, no) => {
      init?.signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as typeof fetch;
    const t = graphTransport({ token: 't', fetch: hang, timeoutMs: 20 });
    const e = (await t({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendarView' }).catch((x: unknown) => x)) as GraphHttpError;
    expect(e).toBeInstanceOf(GraphHttpError);
    expect([e.status, e.code]).toEqual([0, 'Timeout']);
  });

  // @req FR:connect-accounts/acct.timeout
  it('a network failure is a Network error; a 429 carries Retry-After', async () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const e = (await graphTransport({ token: 't', fetch: down })({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me' }).catch((x: unknown) => x)) as GraphHttpError;
    expect([e.status, e.code]).toEqual([0, 'Network']);
    const busy = (async () => new Response('{"error":{"code":"TooManyRequests"}}', { status: 429, headers: { 'retry-after': '12' } })) as typeof fetch;
    const t = (await graphTransport({ token: 't', fetch: busy })({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me' }).catch((x: unknown) => x)) as GraphHttpError;
    expect([t.status, t.code, t.retryAfterMs]).toEqual([429, 'TooManyRequests', 12_000]);
  });

  // @req FR:connect-accounts/acct.timeout
  it('timedFetch caps the token endpoint too', async () => {
    let signal: AbortSignal | undefined;
    const hang = ((_u: string | URL | Request, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>((_ok, no) => signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))); }) as typeof fetch;
    await expect(timedFetch(hang, 20)('https://login.microsoftonline.com/x', { method: 'POST' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
  });
});
