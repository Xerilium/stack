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
    return { status: res.status, json: await res.json() };
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
    expect(await get('owner', Q)).toEqual({ status: 200, json: { configured: true, items: EVENTS } });
    expect((await get(await mint(), Q)).status).toBe(403);
  });
  it('says when no calendar is configured, and survives a provider failure', async () => {
    expect((await (await mk()).get('owner', Q)).json).toEqual({ configured: false, items: [] });
    const broken = await mk({ events: async () => { throw new Error('token expired: abc'); } });
    expect(await broken.get('owner', Q)).toEqual({ status: 200, json: { configured: true, items: [], error: 'Calendar unavailable' } });
  });
  it('validates the range: ISO, from before to, at most 7 days', async () => {
    const { get } = await mk(fixtureCalendar(EVENTS));
    expect((await get('owner', '/calendar?from=x&to=2026-10-29T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar?from=2026-10-29T00:00:00Z&to=2026-10-28T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar?from=2026-10-01T00:00:00Z&to=2026-10-29T00:00:00Z')).status).toBe(422);
    expect((await get('owner', '/calendar')).status).toBe(422);
  });
});
