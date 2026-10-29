import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { parseConfig } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T06:12:00Z');
const config = parseConfig({ timezone: 'America/Los_Angeles', timeBlocks: [{ name: 'Sleep', days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], startTime: '02:00', endTime: '08:00', emoji: '😴' }] });
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const storage = new MemoryStorage();
const h = createApiHandler({ storage, config, authorize: () => true, now: () => NOW });
const get = async (path: string) => { const r = await h(new Request(`https://x.test/api${path}`, { headers: OWNER })); return { status: r.status, json: await r.json() }; };

// @req FR:schedule/api.schedule
describe('GET /schedule', () => {
  it('is registered as schedule.get with tasks:read', () => {
    expect(routeScope('schedule.get')).toBe('tasks:read');
    expect(ROUTES.some((r) => r.name === 'schedule.get' && r.method === 'GET' && r.doc === '/schedule')).toBe(true);
  });
  it('returns the waking day for now, with the timezone', async () => {
    const r = await get('/schedule');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ timezone: 'America/Los_Angeles', date: '2026-10-28', bed: '2026-10-29T09:00:00.000Z', asleep: false });
  });
  it('takes an ISO instant and rejects anything that is not a real one', async () => {
    expect((await get('/schedule?at=2026-10-29T10:00:00Z')).json).toMatchObject({ date: '2026-10-29', asleep: true });
    expect((await get('/schedule?at=2026-10-29T01:00:00-07:00')).json).toMatchObject({ date: '2026-10-28' });
    for (const bad of ['tomorrow', '2026-13-45T10:00Z', '2026-02-30T10:00:00Z', '2026-10-29T25:00:00Z']) expect((await get(`/schedule?at=${bad}`)).status).toBe(422);
    expect((await get('/schedule?when=x')).status).toBe(422);
  });
  it('is owner only: tokens get 403', async () => {
    const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
    const auth = createAuth({ owners: [], tokens });
    const api = auth.wrap(createApiHandler({ storage, config, authorize: auth.authorize, now: () => NOW }));
    const { token } = await tokens.create({ name: 't', scopes: ['tasks:read'] as never });
    expect((await api(new Request('https://x.test/api/schedule', { headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
  });
});

// @req FR:schedule/api.override
describe('POST /schedule/day', () => {
  const post = async (h: ReturnType<typeof createApiHandler>, body: unknown) => {
    const r = await h(new Request('https://x.test/api/schedule/day', { method: 'POST', headers: { ...OWNER, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: r.status, json: await r.json() };
  };
  const fresh = () => { const s = new MemoryStorage(); return { s, h: createApiHandler({ storage: s, config, authorize: () => true, now: () => NOW }) }; };
  const getOn = async (h: ReturnType<typeof createApiHandler>, path: string) => (await h(new Request(`https://x.test/api${path}`, { headers: OWNER }))).json();

  it('is registered as schedule.day with tasks:write', () => {
    expect(routeScope('schedule.day')).toBe('tasks:write');
  });
  it('saves a date override that GET /schedule applies; reset removes it', async () => {
    const { s, h } = fresh();
    const r = await post(h, { date: '2026-10-28', bed: '01:00' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ date: '2026-10-28', bed: '2026-10-29T08:00:00.000Z' });
    expect(JSON.parse((await s.readAux('.stack/schedule.json'))!.content)).toEqual({ dates: { '2026-10-28': { bed: '01:00' } } });
    expect(await getOn(h, '/schedule?at=2026-10-29T06:12:00Z')).toMatchObject({ bed: '2026-10-29T08:00:00.000Z' });
    await post(h, { date: '2026-10-28', reset: true });
    expect(await getOn(h, '/schedule?at=2026-10-29T06:12:00Z')).toMatchObject({ bed: '2026-10-29T09:00:00.000Z' });
  });
  it('every: true saves it for the weekday', async () => {
    const { s, h } = fresh();
    await post(h, { date: '2026-10-28', wake: '09:30', every: true });
    expect(JSON.parse((await s.readAux('.stack/schedule.json'))!.content)).toEqual({ weekdays: { Wed: { wake: '09:30' } } });
  });
  it('rejects bad times and dates', async () => {
    const { h } = fresh();
    for (const b of [{ date: '2026-02-30', bed: '01:00' }, { date: '2026-10-28', bed: '25:00' }, { date: '2026-10-28' }, { bed: '01:00' }]) expect((await post(h, b)).status).toBe(422);
  });
  it('is owner only', async () => {
    const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
    const auth = createAuth({ owners: [], tokens });
    const api = auth.wrap(createApiHandler({ storage: new MemoryStorage(), config, authorize: auth.authorize, now: () => NOW }));
    const { token } = await tokens.create({ name: 't', scopes: ['tasks:write'] as never });
    const r = await api(new Request('https://x.test/api/schedule/day', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-10-28', bed: '01:00' }) }));
    expect(r.status).toBe(403);
  });
});

// @req FR:day-inputs/api.calendar
describe('GET /calendar dates', () => {
  it('rejects dates that do not exist', async () => {
    expect((await get('/calendar?from=2026-02-30T00:00:00Z&to=2026-03-01T00:00:00Z')).status).toBe(422);
  });
});
