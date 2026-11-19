import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import type { PrBoard } from '../../src/api/pr-board-service';
import { getDefaults } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';
import { PriStore } from '../../src/core/pris';
import type { Inventory } from '../../src/core/session-inventory';

const NOW = new Date('2026-11-18T19:00:00Z');
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const S1 = { id: 's1', title: 'Stack agent', project: 'xerilium', state: 'running', reason: 'idle', pinned: false, lastActivityAt: NOW.toISOString(), link: 'claude://claude.ai/epitaxy/s1', prs: [] } as Inventory['sessions'][number];
const INV: Inventory = { at: NOW.toISOString(), total: 1, counts: { running: 1, waiting: 0, stuck: 0, done: 0, pinned: 0, idle: 0 }, needsYou: [], archive: [], sessions: [S1] };
const BOARD = {
  at: NOW.toISOString(), user: 'me', agents: { count: 0, source: 'sessions' }, counts: { processing: 0, waiting: 1, pending: 0, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, queue: false,
  summary: { live: [], signoff: [], autopilot: [], missing: [] },
  rows: [{ url: 'https://github.com/Xerilium/stack/pull/9', repo: 'Xerilium/stack', number: 9, title: 'feat: x', project: 'xerilium', nextAction: 'autopilot', specLines: 2, detail: {} }],
} as unknown as PrBoard;
const PRIS = [{ id: 'stack', title: 'Stack', status: 'active', items: [], backlog: [], weekly: [], projects: ['Stack'], refs: ['Xerilium/stack'], session: 's1' }];
const STACK_MD = '# 🥞 Stack\n\n## Active\n\n- [ ] 1️⃣ 🔄 Ship the report (agent: Stack agent)\n';

async function mk(withPris = true, get: () => Promise<PrBoard> = async () => BOARD) {
  const storage = new MemoryStorage();
  await storage.write('tasks/stack.md', STACK_MD);
  const dir = mkdtempSync(join(tmpdir(), 'stack-home-'));
  if (withPris) writeFileSync(join(dir, 'pris.json'), JSON.stringify({ version: 1, rev: 1, pris: PRIS }));
  const deps = { storage, config: getDefaults(), now: () => NOW, inventory: () => INV, prBoard: { get, refresh: async () => {}, stop: () => {} }, ...(withPris ? { pris: new PriStore(dir) } : {}) };
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const call = async (who: string, path: string) => {
    const headers: Record<string, string> = who === 'owner' ? OWNER : { authorization: `Bearer ${who}` };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { headers }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
  return { call, tokens };
}

// @req FR:priorities-tables/api.@api
it('GET /priorities is registered, read-scoped and documented', () => {
  expect(routeScope('priorities.get')).toBe('tasks:read');
  expect(ROUTES.filter((r) => r.name === 'priorities.get').map((r) => `${r.method} ${r.doc}`)).toEqual(['GET /priorities']);
  expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/priorities:');
});

// @req FR:priorities-tables/api.read @req FR:priorities-tables/api.@api @req FR:priorities-tables/tasks.store
it('builds the report from the store, the task files, the inventory and the board, for the owner only', async () => {
  const { call, tokens } = await mk();
  const r = await call('owner', '/priorities');
  expect(r.status).toBe(200);
  expect(r.json.now.rows).toEqual([{
    id: 'stack', project: 'Stack', file: 'tasks/stack.md', agent: { name: 'Stack agent', link: 'claude://claude.ai/epitaxy/s1', file: null, session: null }, more: 0, status: 'working', action: 'Ship the report', gap: false, cos: null, request: null, ref: 'tasks/stack.md:4', at: NOW.toISOString(), stale: false,
  }]);
  expect(r.json.prs.rows).toEqual([{ emoji: '🥞', number: 9, url: 'https://github.com/Xerilium/stack/pull/9', agent: { name: 'Stack agent', link: 'claude://claude.ai/epitaxy/s1', file: null, session: null }, pri: 'stack', action: 'Autopilot: promote', minutes: 5, server: null, details: null }]);
  const t = (await tokens.create({ name: 'cos', scopes: ['tasks:read'] as never })).token;
  expect((await call(t, '/priorities')).status).toBe(403);
});

// @req FR:priorities-tables/api.read.none
it('answers 404 without a priority store', async () => {
  expect((await (await mk(false)).call('owner', '/priorities')).status).toBe(404);
});

// @req FR:priorities-tables/pr.live.none
it('does not wait long for a slow first board poll; the PR table is stale', async () => {
  const r = await (await mk(true, () => new Promise<PrBoard>(() => {}))).call('owner', '/priorities');
  expect(r.status).toBe(200);
  expect(r.json.now.rows).toHaveLength(1);
  expect(r.json.prs).toMatchObject({ stale: true, verified: false, rows: [] });
}, 10_000);
