import { createApiHandler, ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api';
import { parseConfig } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';

const config = parseConfig({ timezone: 'America/Los_Angeles', timeBlocks: [{ name: 'Sleep', days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], startTime: '02:00', endTime: '08:00', emoji: '😴' }] });
const h = createApiHandler({ storage: new MemoryStorage(), config, authorize: () => true, now: () => new Date('2026-10-29T06:12:00Z') });
const get = async (path: string) => { const r = await h(new Request(`https://x.test/api${path}`)); return { status: r.status, json: await r.json() }; };

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
  it('takes an ISO instant and rejects anything else', async () => {
    expect((await get('/schedule?at=2026-10-29T10:00:00Z')).json).toMatchObject({ date: '2026-10-29', asleep: true });
    expect((await get('/schedule?at=tomorrow')).status).toBe(422);
    expect((await get('/schedule?when=x')).status).toBe(422);
  });
});
