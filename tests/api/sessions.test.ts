/** @req FR:agent-sessions/sessions.list @req FR:agent-sessions/sessions.messages @req FR:agent-sessions/sessions.cost @req FR:agent-sessions/run.prompt @req FR:agent-sessions/run.cancel @req FR:agent-sessions/driver.interface */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createRunManager, SessionBusy, type AgentDriver, type Session, type Update } from '../../src/agents';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T10:00:00Z');
const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const sess = (n: number, over: Partial<Session> = {}): Session => ({ id: `a1b2c3d4-0000-0000-0000-00000000000${n}`, title: `Session ${n}`, project: 'stack', cwd: '/x/stack', branch: 'main', lastActive: at(n), active: false, cost: { usd: n / 10, tokens: n * 1000 }, prs: [], ...over });
const SESSIONS: Session[] = [sess(1, { active: true, cost: { usd: 0.1, tokens: 1000, byModel: { 'claude-sonnet-5-5': { usd: 0.1, tokens: 1000 } } } }), sess(2, { project: 'todo', cwd: '/x/todo' }), sess(3, { lastActive: at(30) }), sess(4, { lastActive: at(24 * 9), project: 'todo', cwd: '/x/todo' })];

function fakeDriver(): AgentDriver & { prompts: unknown[] } {
  const prompts: unknown[] = [];
  const stops = new Map<string, () => void>();
  return {
    prompts,
    listSessions: async () => SESSIONS,
    getMessages: async (id) => (id === SESSIONS[0].id ? [{ at: at(1), role: 'user', text: 'Hi' }, { at: at(1), role: 'assistant', text: 'Hello' }] : (() => { throw new Error('not found'); })()),
    async prompt(req) {
      prompts.push(req);
      if (req.sessionId === SESSIONS[0].id) throw new SessionBusy('Session is active elsewhere; message it through its inbox');
      // The run stays open until it is cancelled, like a real agent at work.
      let stop: () => void = () => undefined;
      const stopped = new Promise<void>((ok) => { stop = ok; });
      stops.set(`run-${prompts.length}`, stop);
      const updates = (async function* (): AsyncGenerator<Update> { yield { type: 'message_chunk', role: 'assistant', text: 'ok' }; await stopped; yield { type: 'done', stopReason: 'cancelled', cost: { usd: 0.01, tokens: 10 }, turns: 1, durationMs: 5 }; })();
      return { id: `run-${prompts.length}`, sessionId: req.sessionId ?? null, updates };
    },
    cancel: async (id) => { stops.get(id)?.(); return true; },
  };
}

async function mk() {
  const storage = new MemoryStorage();
  const driver = fakeDriver();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const agents = createRunManager({ driver, ctx: { storage, now: () => NOW } });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, agents }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW, agents });
  const none = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 'cos', scopes: scopes as never })).token;
  const call = async (who: string | 'owner' | 'none' | null, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner' || who === 'none') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else if (who) headers.authorization = `Bearer ${who}`;
    const req = new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const res = await (who === 'owner' ? owner : who === 'none' ? none : token)(req);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { call, mint, driver, agents };
}

describe('sessions routes', () => {
  it('are registered with their scopes and documented', () => {
    const want: [string, string, string][] = [['sessions.list', 'GET', 'tasks:read'], ['sessions.messages', 'GET', 'tasks:read'], ['sessions.cost', 'GET', 'tasks:read'], ['sessions.prompt', 'POST', 'tasks:write'], ['sessions.new', 'POST', 'tasks:write'], ['sessions.cancel', 'POST', 'tasks:write']];
    for (const [name, method, scope] of want) {
      expect(routeScope(name)).toBe(scope);
      expect(ROUTES.some((r) => r.name === name && r.method === method)).toBe(true);
    }
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/sessions:', '/sessions/cost:', '/sessions/{id}/messages:', '/sessions/{id}/prompt:', '/sessions/{id}/cancel:']) expect(doc).toContain(p);
  });
  it('every route is 404 without a driver', async () => {
    const { call } = await mk();
    for (const [m, p] of [['GET', '/sessions'], ['GET', '/sessions/cost'], ['GET', `/sessions/${SESSIONS[0].id}/messages`], ['POST', `/sessions/${SESSIONS[0].id}/prompt`], ['POST', '/sessions'], ['POST', `/sessions/${SESSIONS[0].id}/cancel`]] as const) {
      expect((await call('none', m, p, m === 'POST' ? (p === '/sessions' ? { text: 'x', cwd: process.cwd() } : { text: 'x' }) : undefined)).status).toBe(404);
    }
  });
  it('lists sessions in attention order with state, cost, and project', async () => {
    const { call, mint } = await mk();
    const r = await call(await mint('tasks:read'), 'GET', '/sessions?limit=3');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(4);
    expect(r.json.indexing).toBe(0);
    expect(r.json.items.map((i: { id: string }) => i.id.slice(-1))).toEqual(['1', '2', '3']);
    expect(r.json.items[0]).toMatchObject({ state: 'active', title: 'Session 1', project: 'stack', branch: 'main', cost: { usd: 0.1, tokens: 1000 } });
    expect(r.json.items[1].state).toBe('idle');
    expect(r.json.items[2].state).toBe('stale');
    expect(r.json.items[0].byModel).toBeUndefined();
    expect((await call('owner', 'GET', '/sessions?limit=0')).status).toBe(422);
  });
  it('a running session and a session with an open permission ask rank first', async () => {
    const { call, agents } = await mk();
    await call('owner', 'POST', `/sessions/${SESSIONS[2].id}/prompt`, { text: 'go' });
    agents.needsYou = async () => new Set([SESSIONS[3].id]);
    const r = await call('owner', 'GET', '/sessions');
    expect(r.json.items.map((i: { id: string; state: string }) => [i.id.slice(-1), i.state])).toEqual([['4', 'needs-you'], ['3', 'running'], ['1', 'active'], ['2', 'idle']]);
  });
  it('messages: last turns, 404 for an unknown id', async () => {
    const { call } = await mk();
    const r = await call('owner', 'GET', `/sessions/${SESSIONS[0].id}/messages?limit=5`);
    expect(r.json).toEqual({ items: [{ at: at(1), role: 'user', text: 'Hi' }, { at: at(1), role: 'assistant', text: 'Hello' }] });
    expect((await call('owner', 'GET', `/sessions/${SESSIONS[1].id}/messages`)).status).toBe(404);
    expect((await call('owner', 'GET', '/sessions/not-a-uuid/messages')).status).toBe(422);
  });
  it('cost: by day (lastActive), project, and model', async () => {
    const { call } = await mk();
    const r = await call('owner', 'GET', '/sessions/cost?days=2');
    expect(r.status).toBe(200);
    expect(r.json.attribution).toBe('lastActive');
    expect(r.json.indexing).toBe(0);
    expect(r.json.days).toHaveLength(2);
    expect(r.json.days[1]).toMatchObject({ date: '2026-10-29', usd: 0.3, tokens: 3000, sessions: 2 });
    expect(r.json.days[0]).toMatchObject({ date: '2026-10-28', usd: 0.3, tokens: 3000, sessions: 1 });
    expect(r.json.projects).toEqual([{ project: 'stack', usd: 0.4, tokens: 4000, sessions: 2 }, { project: 'todo', usd: 0.2, tokens: 2000, sessions: 1 }]);
    expect(r.json.models).toEqual([{ model: 'claude-sonnet-5-5', usd: 0.1, tokens: 1000 }]);
    expect(r.json.total).toEqual({ usd: 0.6, tokens: 6000, sessions: 3 });
    expect((await call('owner', 'GET', '/sessions/cost?days=0')).status).toBe(422);
  });
  it('prompt: owner only, validates text, 409 when busy, 202 with the run id', async () => {
    const { call, mint, driver } = await mk();
    const w = await mint('tasks:write');
    expect((await call(w, 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: 'x' })).status).toBe(403);
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: '' })).status).toBe(422);
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: 'a'.repeat(4001) })).status).toBe(422);
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[0].id}/prompt`, { text: 'x' })).status).toBe(409);
    const r = await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: 'Hello agent' });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ runId: 'run-2', sessionId: SESSIONS[1].id });
    expect(driver.prompts[1]).toMatchObject({ sessionId: SESSIONS[1].id, text: 'Hello agent' });
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: 'again' })).status).toBe(409);
  });
  it('new session: cwd must be an absolute existing path; token callers are refused', async () => {
    const { call, mint } = await mk();
    expect((await call(await mint('tasks:write'), 'POST', '/sessions', { cwd: process.cwd(), text: 'x' })).status).toBe(403);
    expect((await call('owner', 'POST', '/sessions', { cwd: 'relative', text: 'x' })).status).toBe(422);
    expect((await call('owner', 'POST', '/sessions', { cwd: '/definitely/not/here', text: 'x' })).status).toBe(422);
    const r = await call('owner', 'POST', '/sessions', { cwd: process.cwd(), text: 'Start' });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ runId: 'run-1', sessionId: null });
  });
  it('cancel: owner only; changed false when nothing runs', async () => {
    const { call, mint } = await mk();
    expect((await call(await mint('tasks:write'), 'POST', `/sessions/${SESSIONS[1].id}/cancel`)).status).toBe(403);
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/cancel`)).json).toEqual({ changed: false });
    await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/prompt`, { text: 'x' });
    expect((await call('owner', 'POST', `/sessions/${SESSIONS[1].id}/cancel`)).json).toEqual({ changed: true });
  });
});
