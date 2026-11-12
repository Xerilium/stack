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

const CLIENT = '11111111-2222-3333-4444-555555555555';
const R = ['2026-11-12T00:00:00.000Z', '2026-11-13T00:00:00.000Z'] as const;
const ev = (id: string, subject: string, h: number): CalendarEvent => ({ id, subject, start: `2026-11-12T${String(h).padStart(2, '0')}:00:00.000Z`, end: `2026-11-12T${String(h).padStart(2, '0')}:30:00.000Z`, allDay: false, showAs: 'busy', cancelled: false, online: false });
const seed = (dir: string, account: string, scopes: string[]) =>
  new FileTokenCache(accountCachePath(account, dir)).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes, refreshToken: 'RT', account });

function mk(o: { fallback?: CalendarProvider; by?: Record<string, () => Promise<CalendarEvent[]>> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acal-'));
  let now = Date.parse('2026-11-12T12:00:00Z');
  const reads: string[] = [];
  const health = new AccountHealth();
  const cal = createAccountsCalendar({
    dir, health, now: () => now, ...(o.fallback ? { fallback: o.fallback } : {}),
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
