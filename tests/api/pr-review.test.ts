import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { LiveStore } from '../../src/core/live-lane';
import { BriefStore, FactsStore, parsePrRef } from '../../src/core/pr-review';

const NOW = new Date('2026-11-11T18:00:00Z');
const SHA = 'a'.repeat(40);
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };

async function mk(withDeps = true) {
  const home = mkdtempSync(join(tmpdir(), 'stack-prr-api-'));
  writeFileSync(join(home, 'live.config.json'), JSON.stringify({ lockPath: join(home, 'fh.lock') }));
  writeFileSync(join(home, 'pr-facts.json'), JSON.stringify({ version: 1, items: [{ repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', title: 'One', headSha: 'b'.repeat(40), specLines: 12, labels: [], live: true, reasons: ['label: Needs Validation'], at: NOW.toISOString() }] }));
  const live = new LiveStore(home, { now: () => NOW });
  const briefs = new BriefStore(home, { now: () => NOW });
  const facts = new FactsStore(home, { now: () => NOW });
  await briefs.put({ problem: 'It fails.', solution: 'Fix it.', recommendation: 'Approve.', evidence: ['https://github.com/o/r/pull/1'], headSha: SHA }, parsePrRef('o/r#1')!);
  const deps = { storage: new MemoryStorage(), now: () => NOW, ...(withDeps ? { live, briefs, facts } : {}) };
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(who === 'owner' ? OWNER : { authorization: `Bearer ${who}` }) };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
  return { call, tokens, live };
}

it('routes are registered with scopes and documented', () => {
  expect(routeScope('prReview.get')).toBe('tasks:read');
  expect(routeScope('live.get')).toBe('tasks:read');
  expect(routeScope('live.item')).toBe('tasks:write');
  expect(ROUTES.filter((r) => ['prReview.get', 'live.get', 'live.item'].includes(r.name)).map((r) => `${r.method} ${r.doc}`)).toEqual(['GET /pr-review', 'GET /live', 'POST /live/items']);
  const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
  expect(y).toContain('/pr-review:');
  expect(y).toContain('/live/items:');
});

// @req FR:pr-review-lane/sort.api @req FR:pr-review-lane/brief.api
it('GET /pr-review returns cached facts with specLines and briefs with stale; no store is 404', async () => {
  const { call } = await mk();
  const r = await call('owner', 'GET', '/pr-review');
  expect(r.status).toBe(200);
  expect(r.json.facts[0]).toMatchObject({ number: 1, specLines: 12, live: true });
  expect(r.json.briefs[0]).toMatchObject({ number: 1, stale: true, recommendation: 'Approve.' });
  expect((await (await mk(false)).call('owner', 'GET', '/pr-review')).status).toBe(404);
});

// @req FR:pr-review-lane/lane.api
it('GET /live and POST /live/items: owner is by owner, a token is by its name', async () => {
  const { call, tokens, live } = await mk();
  expect((await call('owner', 'GET', '/live')).json).toMatchObject({ state: 'idle', items: [], done: [] });
  await live.next({ ref: parsePrRef('o/r#1')!, agent: 'live-1' }, async () => null);
  const a = await call('owner', 'POST', '/live/items', { op: 'add', repo: 'o/r', number: 1, text: 'Sign in works' });
  expect(a.status).toBe(200);
  expect(a.json).toMatchObject({ changed: true, item: { text: 'Sign in works', by: 'owner', state: 'open' } });
  const t = (await tokens.create({ name: 'live-1', scopes: ['tasks:read', 'tasks:write'] as never })).token;
  const b = await call(t, 'POST', '/live/items', { op: 'add', repo: 'o/r', number: 1, text: 'Export' });
  expect(b.json.item.by).toBe('live-1');
  const id = a.json.item.id;
  expect((await call('owner', 'POST', '/live/items', { op: 'needs-fix', repo: 'o/r', number: 1, id, text: 'Header wrong' })).json.item).toMatchObject({ state: 'needs-fix', comment: 'Header wrong' });
  expect((await call('owner', 'POST', '/live/items', { op: 'check', repo: 'o/r', number: 1, id: 'li-00000000' })).status).toBe(404);
  expect((await call('owner', 'POST', '/live/items', { op: 'block', repo: 'o/r', number: 1, id })).status).toBe(422);
  expect((await call('owner', 'POST', '/live/items', { op: 'zap', repo: 'o/r', number: 1 })).status).toBe(422);
  const v = await call(t, 'GET', '/live');
  expect(v.json).toMatchObject({ state: 'preparing', active: { number: 1, by: 'live-1' } });
  expect(v.json.items).toHaveLength(2);
  expect((await (await mk(false)).call('owner', 'GET', '/live')).status).toBe(404);
});

// @req FR:pr-review-lane/lane.needs
it('blocked items appear in GET /needs-you and the answer reopens them', async () => {
  const { call, live } = await mk();
  await live.next({ ref: parsePrRef('o/r#1')!, agent: 'live-1' }, async () => null);
  const { item } = await live.item(parsePrRef('o/r#1')!, 'add', { text: 'Run export', by: 'live-1' });
  await live.item(parsePrRef('o/r#1')!, 'block', { id: item.id, reason: 'No tenant', by: 'live-1' });
  const n = await call('owner', 'GET', '/needs-you');
  expect(n.json.items).toContainEqual(expect.objectContaining({ id: `lv.${item.id}`, recommendation: 'No tenant', link: 'https://github.com/o/r/pull/1' }));
  expect((await call('owner', 'POST', `/needs-you/lv.${item.id}/answer`, { choice: 'defer', until: '2030-01-01' })).json).toEqual({ changed: false });
  expect((await call('owner', 'POST', `/needs-you/lv.${item.id}/answer`, { choice: 'reply', text: 'Use demo' })).json).toEqual({ changed: true });
  expect(live.view().items[0]).toMatchObject({ state: 'open', comment: 'Use demo' });
});
