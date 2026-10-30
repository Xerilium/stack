/** @req FR:agent-thread/reply.entry @req FR:agent-thread/thread.read @req FR:agent-thread/thread.assign @req FR:agent-thread/ask.ref */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createRunManager, type AgentDriver, type Run, type Update } from '../../src/agents';
import { putAgent } from '../../src/core/agents';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T18:00:00Z');
const F4 = '# 🎧 Flantastic 4\n\n- **Agents:**\n  - `🎧 Cid Manager` — label manager\n\n## 🔄 Active\n\n- [ ] Release the single 🟡\n- [ ] 🙋 Sign the contract\n';
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mk(withRunner = true) {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  const ctx = { storage, now: () => NOW };
  await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
  const prompts: unknown[] = [];
  const driver: AgentDriver = {
    listSessions: async () => [], getMessages: async () => [],
    async prompt(req) { prompts.push(req); const n = prompts.length; const updates = (async function* (): AsyncGenerator<Update> { yield { type: 'session', sessionId: `a1b2c3d4-0000-0000-0000-00000000000${n}` }; yield { type: 'done', stopReason: 'end_turn', cost: { usd: 0.1, tokens: 1 }, turns: 1, durationMs: 1 }; })(); return { id: `run-${n}`, sessionId: null, updates } as Run; },
    cancel: async () => false,
  };
  const agents = withRunner ? createRunManager({ driver, ctx, cwd: '/served' }) : undefined;
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, agents }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW, agents });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 'cid-manager', scopes: scopes as never })).token;
  const call = async (who: string | 'owner' | null, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else if (who) headers.authorization = `Bearer ${who}`;
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, mint, call, prompts };
}

describe('thread routes', () => {
  it('are registered with scopes and documented', () => {
    for (const [name, method, scope] of [['inbox.reply', 'POST', 'tasks:write'], ['tasks.thread', 'GET', 'tasks:read'], ['tasks.assign', 'POST', 'tasks:write']] as const) { expect(routeScope(name)).toBe(scope); expect(ROUTES.some((r) => r.name === name && r.method === method)).toBe(true); }
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/inbox/reply:', '/tasks/{ref}/thread:', '/tasks/{ref}/assign:']) expect(doc).toContain(p);
  });

  it('an agent token replies on a task (the owner session cannot); the thread shows owner and agent messages and the ask with a ref', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:read', 'tasks:write');
    expect((await call('owner', 'POST', '/inbox/reply', { ref: 'flantastic-4:7', text: 'hi' })).status).toBe(403);
    expect((await call('owner', 'POST', '/inbox', { ref: 'flantastic-4:7', text: 'Can you take this?', kind: 'reply' })).status).toBe(201);
    const r = await call(w, 'POST', '/inbox/reply', { ref: 'flantastic-4:7', text: 'Yes, cover first.' });
    expect(r.status).toBe(201);
    expect(r.json.id).toMatch(/^in-/);
    expect((await call(w, 'POST', '/inbox/reply', { ref: 'flantastic-4:7', text: 'x', expect: 'stale' })).status).toBe(409);
    expect((await call(w, 'POST', '/asks/q1', { ask: 'Which cover?', kind: 'answer', ref: 'flantastic-4:7' })).status).toBe(200);
    expect((await call(w, 'POST', '/asks/q2', { ask: 'x', kind: 'answer', ref: 'flantastic-4:99' })).status).toBe(404);
    expect((await call(w, 'POST', '/asks/q2', { ask: 'x', kind: 'answer', ref: 'nope' })).status).toBe(422);
    const th = await call(w, 'GET', '/tasks/flantastic-4:7/thread');
    expect(th.status).toBe(200);
    expect(th.json.items.map((i: { kind: string }) => i.kind)).toEqual(['owner', 'agent', 'ask']);
    expect(th.json.items[1]).toMatchObject({ agent: 'cid-manager', text: 'Yes, cover first.' });
    expect(th.json.items[2].ask).toMatchObject({ key: 'q1', ref: 'flantastic-4:7', row: 'flantastic-4:7', from: 'cid-manager' });
    expect((await call('owner', 'GET', '/asks')).json.items.find((a: { key: string }) => a.key === 'q1')).toMatchObject({ ref: 'flantastic-4:7' });
    expect((await call(w, 'GET', '/tasks/nope/thread')).status).toBe(422);
    expect((await call(w, 'GET', '/tasks/flantastic-4:99/thread')).status).toBe(404);
  });

  it('assign is owner-only, claims the row, starts the agent; 🙋 is 403; no runner is 404', async () => {
    const { call, mint, prompts, storage } = await mk();
    expect((await call(await mint('tasks:write'), 'POST', '/tasks/flantastic-4:7/assign', {})).status).toBe(403);
    const r = await call('owner', 'POST', '/tasks/flantastic-4:7/assign', {});
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ agent: 'cid-manager', claimed: true });
    expect(prompts).toHaveLength(1);
    await tick(20);
    expect((await storage.read('tasks/flantastic-4.md')).content).toContain('🚧');
    // A follow-up on the task carries the persona again (a resumed session has no system prompt). @req FR:agent-thread/thread.ask
    await tick(20);
    const sid = 'a1b2c3d4-0000-0000-0000-000000000001'; // the id the fake driver announced for run 1
    const f = await call('owner', 'POST', `/sessions/${sid}/prompt`, { text: 'And the date?', ref: 'flantastic-4:7' });
    expect(f.status).toBe(202);
    expect((prompts[1] as { options?: { systemPrompt?: string; title?: string } }).options?.systemPrompt).toContain('You are 🎧 Cid Manager');
    expect((prompts[1] as { options?: { title?: string } }).options?.title).toBeUndefined();
    expect((await call('owner', 'POST', `/sessions/${sid}/prompt`, { text: 'plain' })).status).toBe(202);
    expect((prompts[2] as { options?: unknown }).options).toBeUndefined();
    expect((await call('owner', 'POST', `/sessions/${sid}/prompt`, { text: 'x', ref: 'nope' })).status).toBe(422);
    expect((await call('owner', 'POST', `/sessions/${sid}/prompt`, { text: 'x', ref: 'flantastic-4:7', agent: 'cos' })).status).toBe(202); // the picked agent's persona
    expect((prompts[3] as { options?: { systemPrompt?: string } }).options?.systemPrompt).toContain('You are CoS');
    expect((await call('owner', 'POST', `/sessions/${sid}/prompt`, { text: 'x', agent: 'nobody' })).status).toBe(404);
    expect((await call('owner', 'POST', '/tasks/flantastic-4:8/assign', {})).status).toBe(403);
    expect((await call('owner', 'POST', '/tasks/flantastic-4:7/assign', { agent: 'Bad Slug' })).status).toBe(422);
    const none = await mk(false);
    expect((await none.call('owner', 'POST', '/tasks/flantastic-4:7/assign', {})).status).toBe(404);
    expect((await none.call('owner', 'GET', '/tasks/flantastic-4:7/thread')).status).toBe(200); // the thread reads without a runner
  });
});
