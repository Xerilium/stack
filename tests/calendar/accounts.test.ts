/**
 * The live calendar over every connected account: merged, de-duplicated, a 3 minute copy, ICS fallback, health marks.
 * @req FR:connect-accounts/cal.live @req FR:connect-accounts/cal.ttl @req FR:connect-accounts/cal.fallback @req FR:connect-accounts/cal.info @req FR:connect-accounts/acct.health
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CalendarNotConnected, createAccountsCalendar } from '../../src/calendar/accounts';
import { fixtureCalendar, type CalendarEvent, type CalendarProvider } from '../../src/calendar';
import { accountCachePath, FileTokenCache, GraphSignInRequired } from '../../src/graph/auth';
import { AccountHealth } from '../../src/graph/connect';
import { GraphHttpError } from '../../src/graph/transport';

const CLIENT = '11111111-2222-3333-4444-555555555555';
const R = ['2026-11-12T00:00:00.000Z', '2026-11-13T00:00:00.000Z'] as const;
const ev = (id: string, subject: string, h: number): CalendarEvent => ({ id, subject, start: `2026-11-12T${String(h).padStart(2, '0')}:00:00.000Z`, end: `2026-11-12T${String(h).padStart(2, '0')}:30:00.000Z`, allDay: false, showAs: 'busy', cancelled: false, online: false });
const seed = (dir: string, account: string, scopes: string[]) =>
  new FileTokenCache(accountCachePath(account, dir)).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes, refreshToken: 'RT', account });

function mk(o: { fallback?: CalendarProvider; by?: Record<string, () => Promise<CalendarEvent[]>>; accountMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acal-'));
  let now = Date.parse('2026-11-12T12:00:00Z');
  const reads: string[] = [];
  const health = new AccountHealth();
  const cal = createAccountsCalendar({
    dir, health, now: () => now, ...(o.fallback ? { fallback: o.fallback } : {}), ...(o.accountMs ? { accountMs: o.accountMs } : {}),
    provider: (account) => ({ events: async () => { reads.push(account); return (o.by?.[account] ?? (async () => []))(); } }),
  });
  return { cal, dir, reads, health, tick: (ms: number) => { now += ms; } };
}

describe('accounts calendar', () => {
  // @req FR:connect-accounts/cal.live @req FR:connect-accounts/cal.info
  it('reads every calendar account at each read, merges by start, drops the same meeting seen twice', async () => {
    const { cal, dir, reads } = mk({ by: { 'me@outlook.com': async () => [ev('1', 'Gym', 9), ev('2', 'Standup', 15)], 'w@contoso.test': async () => [ev('x', 'Standup', 15), ev('3', '1:1', 11)] } });
    await expect(cal.events(...R)).rejects.toBeInstanceOf(CalendarNotConnected);
    await seed(dir, 'me@outlook.com', ['Calendars.Read', 'offline_access']);
    await seed(dir, 'mail@outlook.com', ['Mail.Read', 'offline_access']);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym', 'Standup']);
    // Connected after start: shows on the next read, no restart.
    await seed(dir, 'w@contoso.test', ['https://graph.microsoft.com/calendars.read']);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym', '1:1', 'Standup']);
    expect(reads.sort()).toEqual(['me@outlook.com', 'w@contoso.test']);
    expect(cal.info?.()).toEqual({ via: 'graph', account: 'me@outlook.com, w@contoso.test', syncedAt: Date.parse('2026-11-12T12:00:00Z'), partial: false });
  });

  // @req FR:connect-accounts/cal.ttl
  it('keeps each account copy 3 minutes, then reads again', async () => {
    const { cal, dir, reads, tick } = mk();
    await seed(dir, 'me@outlook.com', ['Calendars.Read']);
    await cal.events(...R); await cal.events(...R);
    expect(reads).toHaveLength(1);
    tick(3 * 60_000 + 1);
    await cal.events(...R);
    expect(reads).toHaveLength(2);
  });

  // @req FR:connect-accounts/acct.health @req FR:connect-accounts/cal.ttl
  it('a failed read serves the last copy, sets partial, and marks the account', async () => {
    let fail: Error | null = null;
    const { cal, dir, health, tick } = mk({ by: { 'me@outlook.com': async () => { if (fail) throw fail; return [ev('1', 'Gym', 9)]; } } });
    await seed(dir, 'me@outlook.com', ['Calendars.Read']);
    await cal.events(...R);
    fail = new GraphSignInRequired(); tick(4 * 60_000);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(cal.info?.()).toMatchObject({ partial: true, syncedAt: Date.parse('2026-11-12T12:00:00Z') });
    expect(health.get('me@outlook.com')).toBe('expired');
    fail = new Error('boom'); tick(4 * 60_000);
    await cal.events(...R);
    expect(health.get('me@outlook.com')).toBe('error');
    fail = null; tick(4 * 60_000);
    await cal.events(...R);
    expect(health.get('me@outlook.com')).toBeUndefined();
    expect(cal.info?.()).toMatchObject({ partial: false });
  });

  it('every account failing with no copy is an error', async () => {
    const { cal, dir } = mk({ by: { 'me@outlook.com': async () => { throw new Error('boom'); } } });
    await seed(dir, 'me@outlook.com', ['Calendars.Read']);
    await expect(cal.events(...R)).rejects.toThrow();
  });

  // @req FR:connect-accounts/cal.fallback
  it('no calendar account: the ICS fallback answers with its own info', async () => {
    const fb = { ...fixtureCalendar([ev('f', 'Feed', 10)]), info: () => ({ via: 'ics' as const, account: 'a.test' }) };
    const { cal, dir } = mk({ fallback: fb });
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Feed']);
    expect(cal.info?.()).toEqual({ via: 'ics', account: 'a.test' });
    await seed(dir, 'me@outlook.com', ['Calendars.Read']);
    await cal.events(...R);
    expect(cal.info?.()).toMatchObject({ via: 'graph' });
  });
});

describe('accounts calendar: cache files', () => {
  // @req FR:connect-accounts/cal.live @req FR:connect-accounts/acct.remove
  it('an account moved from the default file to its own file gets a provider for the new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acal-'));
    const made: string[] = [];
    const cal = createAccountsCalendar({ dir, ttlMs: 0, provider: (_a, cache) => { made.push(cache.path); return { events: async () => [] }; } });
    const def = new FileTokenCache(join(dir, 'graph-token.json'));
    await def.write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes: ['Calendars.Read'], refreshToken: 'RT', account: 'me@outlook.com' });
    await cal.events(...R);
    await def.clear();
    await seed(dir, 'me@outlook.com', ['Calendars.Read']);
    await cal.events(...R);
    expect(made).toEqual([join(dir, 'graph-token.json'), accountCachePath('me@outlook.com', dir)]);
  });
  // @req FR:graph-signin/web.calendar
  it('reads an explicit STACK_GRAPH_CACHE file with a custom name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acal-'));
    const custom = join(dir, 'ms-token.json');
    await new FileTokenCache(custom).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes: ['Calendars.Read'], refreshToken: 'RT', account: 'me@outlook.com' });
    const reads: string[] = [];
    const cal = createAccountsCalendar({ dir, cachePath: custom, provider: (a) => ({ events: async () => { reads.push(a); return [ev('1', 'Gym', 9)]; } }) });
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(reads).toEqual(['me@outlook.com']);
  });
});

describe('accounts calendar: honest errors and aggregation', () => {
  // @req FR:connect-accounts/cal.account
  it('tags each event with its account; a meeting on two calendars keeps the first', async () => {
    const { cal, dir } = mk({ by: { 'a@outlook.com': async () => [ev('1', 'Gym', 9), ev('s', 'Standup', 15)], 'b@contoso.test': async () => [ev('x', 'Standup', 15), ev('2', '1:1', 11)] } });
    await seed(dir, 'a@outlook.com', ['Calendars.Read']);
    await seed(dir, 'b@contoso.test', ['Calendars.Read']);
    const got = await cal.events(...R);
    expect(got.map((e) => [e.subject, e.account])).toEqual([['Gym', 'a@outlook.com'], ['1:1', 'b@contoso.test'], ['Standup', expect.stringMatching(/@/)]]);
  });

  // @req FR:connect-accounts/cal.isolate
  it('a slow or failing account never blocks the others', async () => {
    const { cal, dir, health } = mk({ by: {
      'a@outlook.com': async () => [ev('1', 'Gym', 9)],
      'b@contoso.test': async () => { throw new GraphHttpError(502, 'UnknownError'); },
      'c@contoso.test': async () => { throw new GraphHttpError(0, 'Timeout'); },
    } });
    for (const a of ['a@outlook.com', 'b@contoso.test', 'c@contoso.test']) await seed(dir, a, ['Calendars.Read']);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(cal.info?.()).toMatchObject({ partial: true, reason: 'down' });
    expect(health.get('b@contoso.test')).toBe('down');
    expect(health.get('c@contoso.test')).toBe('down');
    expect(health.get('a@outlook.com')).toBeUndefined();
  });

  // @req FR:connect-accounts/cal.info
  it('reason is signin when any failing account needs sign-in, else down, else error', async () => {
    const fails: Record<string, Error> = {};
    const { cal, dir, tick } = mk({ by: { 'a@x.test': async () => { if (fails.a) throw fails.a; return []; }, 'b@x.test': async () => { if (fails.b) throw fails.b; return [ev('1', 'Gym', 9)]; } } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await seed(dir, 'b@x.test', ['Calendars.Read']);
    fails.a = new GraphHttpError(401, 'InvalidAuthenticationToken');
    await cal.events(...R);
    expect(cal.info?.()).toMatchObject({ reason: 'signin' });
    tick(11 * 60_000); fails.a = new Error('boom');
    await cal.events(...R);
    expect(cal.info?.()).toMatchObject({ reason: 'error' });
    tick(11 * 60_000); delete fails.a;
    await cal.events(...R);
    expect(cal.info?.()).not.toHaveProperty('reason');
  });

  // @req FR:connect-accounts/acct.retry @req FR:connect-accounts/cal.ttl
  it('an account waiting for its retry time is not called; it is called again after 30 s, 2 min, 10 min', async () => {
    let fail = true;
    const { cal, dir, reads, tick, health } = mk({ by: { 'a@x.test': async () => { if (fail) throw new GraphHttpError(502, 'UnknownError'); return [ev('1', 'Gym', 9)]; } } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(1);
    tick(10_000);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(1); // still waiting: no call
    tick(20_000);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(2);
    tick(119_000);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(2);
    tick(1_000);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(3);
    tick(599_000);
    await expect(cal.events(...R)).rejects.toThrow();
    expect(reads).toHaveLength(3);
    fail = false; tick(1_000);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(reads).toHaveLength(4);
    expect(health.get('a@x.test')).toBeUndefined();
    expect(health.lastOk('a@x.test')).toBeDefined();
  });

  // @req FR:connect-accounts/acct.retry
  it('429 keeps the last copy and the account state, and waits', async () => {
    let throttle = false;
    const { cal, dir, reads, tick, health } = mk({ by: { 'a@x.test': async () => { if (throttle) throw new GraphHttpError(429, 'TooManyRequests', 60_000); return [ev('1', 'Gym', 9)]; } } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await cal.events(...R);
    throttle = true; tick(4 * 60_000);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(health.get('a@x.test')).toBeUndefined();
    expect(reads).toHaveLength(2);
    tick(30_000);
    await cal.events(...R);
    expect(reads).toHaveLength(2);
  });
});

describe('accounts calendar: review fixes', () => {
  // @req FR:connect-accounts/acct.retry
  it('a 429 with no copy yet is not ok: partial with reason down', async () => {
    const { cal, dir } = mk({ by: { 'a@x.test': async () => [ev('1', 'Gym', 9)], 'b@x.test': async () => { throw new GraphHttpError(429, 'TooManyRequests'); } } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await seed(dir, 'b@x.test', ['Calendars.Read']);
    await cal.events(...R);
    expect(cal.info?.()).toMatchObject({ partial: true, reason: 'down' });
  });
  // @req FR:connect-accounts/acct.retry
  it('a second read inside the Retry-After window, with no copy, is partial and makes no call', async () => {
    const { cal, dir, reads, tick } = mk({ by: { 'a@x.test': async () => [ev('1', 'Gym', 9)], 'b@x.test': async () => { throw new GraphHttpError(429, 'TooManyRequests', 60_000); } } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await seed(dir, 'b@x.test', ['Calendars.Read']);
    await cal.events(...R);
    const calls = reads.filter((a) => a === 'b@x.test').length;
    tick(10_000);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(cal.info?.()).toMatchObject({ partial: true, reason: 'down' });
    expect(reads.filter((a) => a === 'b@x.test')).toHaveLength(calls);
  });
  // @req FR:connect-accounts/cal.isolate
  it('a stalled account read ends at the cap; the others return and it is marked down', async () => {
    const { cal, dir, health } = mk({ accountMs: 30, by: { 'a@x.test': async () => [ev('1', 'Gym', 9)], 'b@x.test': () => new Promise<CalendarEvent[]>(() => undefined) } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await seed(dir, 'b@x.test', ['Calendars.Read']);
    expect((await cal.events(...R)).map((e) => e.subject)).toEqual(['Gym']);
    expect(cal.info?.()).toMatchObject({ partial: true, reason: 'down' });
    expect(health.get('b@x.test')).toBe('down');
  });
  // @req FR:connect-accounts/cal.account
  it('a meeting on two calendars keeps the account listed first, whatever answers first', async () => {
    const slow = (ms: number, a: string) => async () => { await new Promise((r) => setTimeout(r, ms)); return [ev(a, 'Standup', 15)]; };
    const { cal, dir } = mk({ by: { 'a@x.test': slow(20, 'a'), 'b@x.test': slow(0, 'b') } });
    await seed(dir, 'a@x.test', ['Calendars.Read']);
    await seed(dir, 'b@x.test', ['Calendars.Read']);
    expect((await cal.events(...R)).map((e) => e.account)).toEqual(['a@x.test']);
  });
});
