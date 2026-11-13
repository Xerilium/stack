import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { fixtureCalendar } from '../../src/calendar';
import { MemoryStorage } from '../../src/core/storage';
import type { CalendarProvider } from '../../src/calendar';

const NOW = new Date('2026-10-28T12:00:00Z');
const EVENTS = [{ id: 'm1', subject: 'Standup', start: '2026-10-28T15:00:00Z', end: '2026-10-28T15:30:00Z', allDay: false, showAs: 'busy' as const, cancelled: false, online: true }];

async function mk(calendar?: CalendarProvider) {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const tokenApi = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, calendar }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW, calendar });
  const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
  const get = async (who: 'owner' | string, path: string) => {
    const res = await (who === 'owner' ? owner : tokenApi)(new Request(`https://x.test/api${path}`, { headers: who === 'owner' ? OWNER : { authorization: `Bearer ${who}` } }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { get, mint: async () => (await tokens.create({ name: 't', scopes: ['tasks:read'] as never })).token };
}
const Q = '/calendar?from=2026-10-28T00:00:00.000Z&to=2026-10-29T00:00:00.000Z';

// @req FR:day-inputs/api.calendar
describe('GET /calendar', () => {
  it('is registered as calendar.list with tasks:read', () => {
    expect(routeScope('calendar.list')).toBe('tasks:read');
    expect(ROUTES.some((r) => r.name === 'calendar.list' && r.method === 'GET' && r.doc === '/calendar')).toBe(true);
  });
  it('returns events for the owner; tokens get 403', async () => {
    const { get, mint } = await mk(fixtureCalendar(EVENTS));
    expect(await get('owner', Q)).toEqual({ status: 200, json: { configured: true, items: EVENTS, source: { kind: 'calendar', via: 'fixture', state: 'ok', lastSyncAt: NOW.toISOString() } } });
    expect((await get(await mint(), Q)).status).toBe(403);
  });
  it('says when no calendar is configured, and survives a provider failure', async () => {
    expect((await (await mk()).get('owner', Q)).json).toEqual({ configured: false, items: [], source: { kind: 'calendar', via: 'none', state: 'not-connected' } });
    const broken = await mk({ events: async () => { throw new Error('token expired: abc'); } });
    expect(await broken.get('owner', Q)).toEqual({ status: 200, json: { configured: true, items: [], error: 'Calendar unavailable', source: { kind: 'calendar', state: 'error' } } });
  });
  // @req FR:ux-consolidation/cal.status
  it('reports the source: via and account from the provider; stale when the copy served is over 60 min old', async () => {
    const at = (min: number) => NOW.getTime() - min * 60_000;
    const p = (syncedAt?: number): CalendarProvider => ({ events: async () => EVENTS, info: () => ({ via: 'ics', account: 'outlook.office365.com', ...(syncedAt !== undefined ? { syncedAt } : {}) }) });
    expect((await (await mk(p(at(5)))).get('owner', Q)).json.source).toEqual({ kind: 'calendar', via: 'ics', account: 'outlook.office365.com', state: 'ok', lastSyncAt: new Date(at(5)).toISOString() });
    expect((await (await mk(p(at(61)))).get('owner', Q)).json.source).toMatchObject({ state: 'stale', lastSyncAt: new Date(at(61)).toISOString() });
    const failing: CalendarProvider = { events: async () => { throw new Error('x'); }, info: () => ({ via: 'graph', account: 'me@x.test', syncedAt: at(10) }) };
    expect((await (await mk(failing)).get('owner', Q)).json.source).toEqual({ kind: 'calendar', via: 'graph', account: 'me@x.test', state: 'error', lastSyncAt: new Date(at(10)).toISOString() });
  });
  it('validates the range: ISO, from before to, at most 7 days', async () => {
    const { get } = await mk(fixtureCalendar(EVENTS));
    expect((await get('owner', '/calendar?from=x&to=2026-10-29T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar?from=2026-10-29T00:00:00Z&to=2026-10-28T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar?from=2026-10-01T00:00:00Z&to=2026-10-29T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar')).status).toBe(422);
  });
});

// @req FR:ux-consolidation/cal.status @req FR:connect-accounts/cal.info
describe('GET /calendar: reason', () => {
  it('copies the provider reason into source.reason', async () => {
    const p: CalendarProvider = { events: async () => EVENTS, info: () => ({ via: 'graph', account: 'a@x.test', syncedAt: NOW.getTime(), partial: true, reason: 'down' }) };
    expect((await (await mk(p)).get('owner', Q)).json.source).toEqual({ kind: 'calendar', via: 'graph', account: 'a@x.test', state: 'error', lastSyncAt: NOW.toISOString(), reason: 'down' });
  });
});
