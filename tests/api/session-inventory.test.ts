import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { PriStore } from '../../src/core/pris';
import type { Inventory } from '../../src/core/session-inventory';

const NOW = new Date('2026-11-11T18:00:00Z');
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const INV: Inventory = { at: NOW.toISOString(), total: 0, counts: { running: 0, waiting: 0, stuck: 0, done: 0, pinned: 0, idle: 0 }, needsYou: [], archive: [], sessions: [] };
const PRI = { id: 'p1', title: 'One', status: 'active', items: [{ text: 'a', status: 'todo' }], backlog: [], weekly: [{ week: '2026-W46', text: 'Shipped' }] };

function mk(withDeps = true) {
  const pris = withDeps ? new PriStore(mkdtempSync(join(tmpdir(), 'stack-home-')), { now: () => NOW }) : undefined;
  const deps = { storage: new MemoryStorage(), now: () => NOW, ...(withDeps ? { inventory: () => INV, pris } : {}) };
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const call = async (who: string | 'owner', method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(who === 'owner' ? OWNER : { authorization: `Bearer ${who}` }) };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
  return { call, tokens };
}

it('routes are registered with scopes and documented', () => {
  expect(routeScope('inventory.list')).toBe('tasks:read');
  expect(routeScope('pris.get')).toBe('tasks:read');
  expect(routeScope('pris.put')).toBe('tasks:write');
  expect(ROUTES.filter((r) => ['inventory.list', 'pris.get', 'pris.put'].includes(r.name)).map((r) => `${r.method} ${r.doc}`)).toEqual(['GET /session-inventory', 'GET /pris', 'POST /pris']);
  const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
  expect(y).toContain('/session-inventory:');
  expect(y).toContain('/pris:');
});

// @req FR:session-inventory/api.inventory
it('GET /session-inventory returns the inventory to the owner; 404 with none; 403 for a token', async () => {
  const { call, tokens } = mk();
  expect(await call('owner', 'GET', '/session-inventory')).toEqual({ status: 200, json: INV });
  expect((await mk(false).call('owner', 'GET', '/session-inventory')).status).toBe(404);
  const t = (await tokens.create({ name: 'cos', scopes: ['tasks:read', 'tasks:write'] as never })).token;
  expect((await call(t, 'GET', '/session-inventory')).status).toBe(403);
  expect((await call(t, 'GET', '/pris')).status).toBe(403);
  expect((await call(t, 'POST', '/pris', { rev: 0, pris: [] })).status).toBe(403);
});

// @req FR:session-inventory/api.pris.get @req FR:session-inventory/api.pris.put
it('GET and POST /pris read and replace the list with rev checks', async () => {
  const { call } = mk();
  expect(await call('owner', 'GET', '/pris')).toEqual({ status: 200, json: { version: 1, rev: 0, pris: [] } });
  const put = await call('owner', 'POST', '/pris', { rev: 0, pris: [PRI] });
  expect(put).toMatchObject({ status: 200, json: { rev: 1, pris: [PRI], updatedAt: NOW.toISOString() } });
  expect((await call('owner', 'POST', '/pris', { rev: 0, pris: [PRI] })).status).toBe(409);
  const bad = await call('owner', 'POST', '/pris', { rev: 1, pris: [{ ...PRI, id: 'X', status: 'nope' }] });
  expect(bad.status).toBe(400);
  expect(bad.json.error.details.map((d: { field: string }) => d.field)).toEqual(['pris[0].id', 'pris[0].status']);
  expect((await call('owner', 'POST', '/pris', { pris: [] })).json.error.details).toEqual([{ field: 'rev', message: 'Required: the rev you read' }]);
  expect((await call('owner', 'POST', '/pris', { rev: 1, pris: {}, x: 1 })).status).toBe(400);
  expect((await call('owner', 'POST', '/pris', [1])).status).toBe(400);
  expect((await mk(false).call('owner', 'GET', '/pris')).status).toBe(404);
  expect((await mk(false).call('owner', 'POST', '/pris', { rev: 0, pris: [] })).status).toBe(404);
});
