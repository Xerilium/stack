import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-11-05T12:00:00Z');
// @req FR:cos-view/meet.api
describe('GET /meetings', () => {
  async function mk(file?: string) {
    const storage = new MemoryStorage();
    if (file !== undefined) await (storage as unknown as { writeAux(p: string, c: string, o: object): Promise<unknown> }).writeAux('.stack/meetings.md', file, {});
    const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
    const auth = createAuth({ owners: [], tokens });
    const tokenApi = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
    const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW });
    const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
    return {
      owner: async () => { const r = await owner(new Request('https://x.test/api/meetings', { headers: OWNER })); return { status: r.status, json: await r.json() }; },
      token: async () => { const t = (await tokens.create({ name: 't', scopes: ['tasks:read'] as never })).token; return (await tokenApi(new Request('https://x.test/api/meetings', { headers: { authorization: `Bearer ${t}` } }))).status; },
    };
  }
  it('is registered with tasks:read', () => {
    expect(routeScope('meetings.list')).toBe('tasks:read');
    expect(ROUTES.some((r) => r.name === 'meetings.list' && r.method === 'GET' && r.doc === '/meetings')).toBe(true);
  });
  it('returns parsed rules to the owner; tokens get 403; no file is empty', async () => {
    const m = await mk('- Mon 9-10: Sync; owner: `x`');
    expect(await m.owner()).toEqual({ status: 200, json: { items: [{ title: 'Sync', days: [1], start: '09:00', end: '10:00', owner: 'x' }] } });
    expect(await m.token()).toBe(403);
    expect((await (await mk()).owner()).json).toEqual({ items: [] });
  });
});
