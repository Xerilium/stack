/** @req FR:agent-team/review.api @req FR:agent-team/talk.api */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createRunManager, type AgentDriver, type Run, type Update } from '../../src/agents';
import { putAgent } from '../../src/core/agents';
import { listAsks } from '../../src/core/asks';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T18:00:00Z');
const F4 = '# 🎧 Flantastic 4\n\n- **Agents:**\n  - `🎧 Cid Manager` — label manager\n\n## 🔄 Active\n\n- [ ] Release the single 🟡\n- [ ] Ship labels\n';
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeDriver() {
  const prompts: Parameters<AgentDriver['prompt']>[0][] = [];
  const driver: AgentDriver = {
    listSessions: async () => [],
    getMessages: async () => [],
    async prompt(req) {
      prompts.push(req);
      const n = prompts.length;
      const updates = (async function* (): AsyncGenerator<Update> {
        yield { type: 'session', sessionId: `a1b2c3d4-0000-0000-0000-00000000000${n}` };
        yield { type: 'done', stopReason: 'end_turn', cost: { usd: 0.2, tokens: 10 }, turns: 1, durationMs: 5, text: 'ok', ...(req.options?.schema ? { structured: { verdict: 'can', plan: 'Easy', estimate: '5m', needs: [{ what: 'Confirm the date', kind: 'answer' }] } } : {}) };
      })();
      return { id: `run-${n}`, sessionId: null, updates } as Run;
    },
    cancel: async () => false,
  };
  return { driver, prompts };
}

async function mk(withRunner = true) {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  const ctx = { storage, now: () => NOW };
  await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'], model: 'opus' });
  const { driver, prompts } = fakeDriver();
  const agents = withRunner ? createRunManager({ driver, ctx, cwd: '/served' }) : undefined;
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, agents }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW, agents });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 'cos', scopes: scopes as never })).token;
  const call = async (who: string | 'owner' | null, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else if (who) headers.authorization = `Bearer ${who}`;
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { ctx, mint, call, prompts };
}

describe('team, reviews, and task sessions', () => {
  it('routes are registered with scopes and documented', () => {
    const want: [string, string, string][] = [['team.list', 'GET', 'tasks:read'], ['reviews.list', 'GET', 'tasks:read'], ['tasks.review', 'POST', 'tasks:write']];
    for (const [name, method, scope] of want) { expect(routeScope(name)).toBe(scope); expect(ROUTES.some((r) => r.name === name && r.method === method)).toBe(true); }
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/team:', '/reviews:', '/tasks/review:']) expect(doc).toContain(p);
  });

  it('GET /team lists the team, and the agents for a project most specific first', async () => {
    const { call, mint } = await mk();
    const all = await call(await mint('tasks:read'), 'GET', '/team');
    expect(all.status).toBe(200);
    expect(all.json.items.map((a: { slug: string }) => a.slug)).toEqual(['cos', 'cid-manager']);
    const f4 = await call('owner', 'GET', '/team?project=flantastic-4');
    expect(f4.json.items.map((a: { slug: string; defined: boolean }) => [a.slug, a.defined])).toEqual([['cid-manager', false], ['cos', true]]);
    expect((await call('owner', 'GET', '/team?project=nope')).json.items.map((a: { slug: string }) => a.slug)).toEqual(['cos']);
    expect((await call('owner', 'GET', '/team?weird=1')).status).toBe(422);
  });

  it('POST /sessions with a ref runs the task agent in the served folder with its persona; cwd stays optional', async () => {
    const { call, mint, prompts } = await mk();
    expect((await call(await mint('tasks:write'), 'POST', '/sessions', { ref: 'flantastic-4:7', text: 'hi' })).status).toBe(403);
    const r = await call('owner', 'POST', '/sessions', { ref: 'flantastic-4:7', text: 'Do it' });
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ runId: 'run-1', agent: 'cid-manager', title: '🎧 Cid Manager · Release the single 🟡 · flantastic-4:7' });
    expect(prompts[0]).toMatchObject({ cwd: '/served', text: 'Do it' });
    expect(prompts[0].options?.systemPrompt).toContain('You are 🎧 Cid Manager');
    const p = await call('owner', 'POST', '/sessions', { project: 'flantastic-4', agent: 'cos', text: 'Plan' });
    expect(p.json).toMatchObject({ agent: 'cos', title: 'CoS · flantastic-4' });
    expect(prompts[1].options?.model).toBe('opus');
    expect((await call('owner', 'POST', '/sessions', { text: 'plain' })).status).toBe(202); // served folder, no persona
    expect(prompts[2]).toMatchObject({ cwd: '/served' });
    expect(prompts[2].options).toBeUndefined();
    expect((await call('owner', 'POST', '/sessions', { ref: 'flantastic-4:99', text: 'x' })).status).toBe(404);
    expect((await call('owner', 'POST', '/sessions', { ref: 'nope', text: 'x' })).status).toBe(422);
    expect((await call('owner', 'POST', '/sessions', { cwd: 'relative', text: 'x' })).status).toBe(422);
    expect((await call('owner', 'POST', '/sessions', { cwd: '/', ref: 'flantastic-4:7', text: 'x' })).status).toBe(422); // a task session always runs in the served folder
  });

  it('POST /tasks/review starts a read-only review (owner only); the verdict and its needs land; GET /reviews lists them', async () => {
    const { call, mint, ctx, prompts } = await mk();
    expect((await call(await mint('tasks:write'), 'POST', '/tasks/review', { ref: 'flantastic-4:7' })).status).toBe(403);
    expect((await call('owner', 'POST', '/tasks/review', { ref: 'nope' })).status).toBe(422);
    const r = await call('owner', 'POST', '/tasks/review', { ref: 'flantastic-4:7' });
    expect(r.status).toBe(202);
    expect(r.json).toMatchObject({ runId: 'run-1', agent: 'cid-manager' });
    expect(prompts[0].options?.schema).toBeDefined();
    await tick(60);
    const list = await call(await mint('tasks:read'), 'GET', '/reviews?project=flantastic-4');
    expect(list.status).toBe(200);
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0]).toMatchObject({ ref: 'flantastic-4:7', verdict: 'can', plan: 'Easy', estimate: '5m', agent: 'cid-manager' });
    expect(list.json.items[0].needs).toHaveLength(1);
    expect((await listAsks(ctx, { state: 'open' })).items[0]).toMatchObject({ ask: 'Confirm the date', kind: 'answer', from: 'cid-manager' });
    expect((await call('owner', 'GET', '/reviews')).status).toBe(422);
    expect((await call('owner', 'GET', '/reviews?project=nope')).json).toEqual({ items: [] });
  });

  it('without a runner the review is 404 like every sessions route; team and reviews still answer', async () => {
    const { call } = await mk(false);
    expect((await call('owner', 'POST', '/tasks/review', { ref: 'flantastic-4:7' })).status).toBe(404);
    expect((await call('owner', 'GET', '/team')).status).toBe(200);
    expect((await call('owner', 'GET', '/reviews?project=flantastic-4')).json).toEqual({ items: [] });
  });
});
