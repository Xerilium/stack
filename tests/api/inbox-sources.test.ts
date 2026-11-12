/**
 * Source status over the API: on the Inbox page read and on its own light route.
 * @req FR:inbox-page/api.read @req FR:inbox-page/api.sources @req FR:inbox-page/src.fresh @req FR:inbox-page/src.safe
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createApiHandler, ROUTES, type ApiDeps } from '../../src/api/handler';
import { getDefaults } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';
import { recordSync, type SourceProbe } from '../../src/inbox';

const NOW = new Date('2026-11-11T18:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const OWNER = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');

async function mk(extra: Partial<ApiDeps> = {}) {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const deps = { storage, now: () => NOW, ...extra };
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const get = async (path: string, who: 'owner' | string = 'owner') => {
    const headers: Record<string, string> = who === 'owner' ? { 'x-ms-client-principal': OWNER } : { authorization: `Bearer ${who}` };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { headers }));
    return { status: res.status, json: (await res.json()) as any };
  };
  return { storage, get, mint: async () => (await tokens.create({ name: 't', scopes: ['tasks:read'] as never })).token };
}

describe('GET /inbox-sources and sources on /inbox-items', () => {
  it('route is registered, read scope, documented', () => {
    expect(routeScope('inboxSources.list')).toBe('tasks:read');
    expect(ROUTES.some((r) => r.name === 'inboxSources.list' && r.method === 'GET')).toBe(true);
    expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/inbox-sources:');
  });

  it('nothing connected: says so, and the page read carries the same status', async () => {
    const { get } = await mk({ inboxProbe: async () => ({ emails: [], github: false }) });
    const r = await get('/inbox-sources');
    expect(r.status).toBe(200);
    expect(r.json.summary).toMatchObject({ connected: 0, canClaimZero: false, attention: true, headline: 'No inboxes connected' });
    const page = await get('/inbox-items');
    expect(page.json).toMatchObject({ items: [], sources: r.json.sources, summary: r.json.summary });
  });

  it('probe plus records: each account has its state; freshness from config', async () => {
    const probe: SourceProbe = { emails: [{ account: 'a@outlook.com', mode: 'read-only' }, { account: 'b@contoso.test', mode: 'drafts' }], github: true, clientId: '11111111-2222-3333-4444-555555555555' };
    const config = { ...getDefaults(), inbox: { freshMinutes: 60 } };
    const { storage, get } = await mk({ inboxProbe: async () => probe, config });
    await recordSync(storage, { kind: 'email', account: 'a@outlook.com', at: ago(45), ok: true });
    await recordSync(storage, { kind: 'email', account: 'b@contoso.test', at: ago(5), ok: false, error: 'signin-expired' });
    const r = await get('/inbox-sources');
    const mail = r.json.sources.filter((s: { kind: string }) => s.kind === 'email');
    expect(mail.map((s: { account: string; state: string }) => [s.account, s.state])).toEqual([['a@outlook.com', 'ok'], ['b@contoso.test', 'error']]);
    expect(r.json.summary.headline).toBe('Email sign-in expired: b@contoso.test');
    expect(JSON.stringify(r.json)).not.toMatch(/refresh|accessToken|Bearer/i);
  });

  it('Check connection asks the probe for a fresh read', async () => {
    const seen: unknown[] = [];
    const { get } = await mk({ inboxProbe: async (o) => { seen.push(o); return { emails: [], github: false }; } });
    await get('/inbox-sources');
    await get('/inbox-sources?fresh=1');
    expect(seen).toEqual([undefined, { fresh: true }]);
    expect((await get('/inbox-sources?bogus=1')).status).toBe(422);
  });

  it('no probe (hosted app): records and configured accounts only; a probe failure reads as no probe', async () => {
    const config = { ...getDefaults(), inbox: { accounts: ['z@outlook.com'] } };
    const { storage, get } = await mk({ config });
    await recordSync(storage, { kind: 'email', account: 'a@outlook.com', at: ago(5), ok: true });
    const mail = (await get('/inbox-sources')).json.sources.filter((s: { kind: string }) => s.kind === 'email');
    expect(mail.map((s: { account: string; state: string }) => [s.account, s.state])).toEqual([['a@outlook.com', 'ok'], ['z@outlook.com', 'not-connected']]);
    const broken = await mk({ inboxProbe: async () => { throw new Error('boom'); } });
    expect((await broken.get('/inbox-sources')).status).toBe(200);
  });

  // @req FR:inbox-page/src.summary: fresh syncs never back a zero claim off a missing or unreadable item file
  it('the page read claims zero only when the item file reads cleanly', async () => {
    const { storage, get } = await mk({ inboxProbe: async () => ({ emails: [{ account: 'a@outlook.com', mode: 'read-only' }], github: true }) });
    await recordSync(storage, { kind: 'email', account: 'a@outlook.com', at: ago(5), ok: true });
    await recordSync(storage, { kind: 'github', account: '', at: ago(5), ok: true });
    expect((await get('/inbox-sources')).json.summary.canClaimZero).toBe(true);
    const page = async () => (await get('/inbox-items')).json;
    expect(await page()).toMatchObject({ items: [], summary: { canClaimZero: false } }); // no item file
    await storage.writeAux('.stack/inbox-items.json', '{not json', { expectedVersion: null });
    expect(await page()).toMatchObject({ items: [], summary: { canClaimZero: false } }); // malformed
    const f = await storage.readAux('.stack/inbox-items.json');
    await storage.writeAux('.stack/inbox-items.json', '[]\n', { expectedVersion: f!.version });
    expect(await page()).toMatchObject({ items: [], summary: { canClaimZero: true } });
  });

  it('owner only', async () => {
    const { get, mint } = await mk();
    expect((await get('/inbox-sources', await mint())).status).toBe(403);
  });
});
