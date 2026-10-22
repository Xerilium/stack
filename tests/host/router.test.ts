import { ENV, setup, signedWebhook, principal, hmac, BASE } from './helpers';

const json = (o: object) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const rpc = (token: string | null, method: string, params?: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

describe('azure-host routing', () => {
  /** @req FR:azure-host/health.shape */
  it('health is open, minimal, and touches nothing', async () => {
    const h = await setup();
    for (const m of ['GET', 'HEAD']) {
      const r = await h.req('/api/health', { method: m });
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    const r = await h.req('/api/health');
    expect(await r.json()).toEqual({ status: 'ok' });
    expect(h.opens()).toBe(0);
    expect((await h.req('/api/health', { method: 'POST' })).status).toBe(405);
  });

  /** @req FR:azure-host/health.shape @req FR:azure-host/settings.invalid */
  it('invalid settings: health degraded, everything else 503 fixed', async () => {
    const h = await setup({ ...ENV, STACK_REPO_URL: undefined });
    expect(await (await h.req('/api/health')).json()).toEqual({ status: 'degraded' });
    for (const p of ['/api/next', '/api/mcp', '/api/bots/webhook']) {
      const r = await h.req(p, { method: 'POST' });
      expect(r.status).toBe(503);
      const body = await r.text();
      expect(JSON.parse(body)).toEqual({ error: { code: 'unavailable', message: 'Service unavailable' } });
    }
    expect(h.opens()).toBe(0);
  });

  /** @req FR:azure-host/routes.map */
  it('404 outside /api', async () => {
    const h = await setup();
    expect((await h.req('/other')).status).toBe(404);
    expect((await h.req('/')).status).toBe(404);
    expect((await h.req('/apix/next')).status).toBe(404);
  });

  /** @req FR:azure-host/git.lazy */
  it('unauthenticated requests never open storage', async () => {
    const h = await setup();
    expect((await h.req('/api/next')).status).toBe(401);
    expect((await h.req('/api/tasks')).status).toBe(401);
    expect((await h.req('/api/mcp', rpc(null, 'tools/list'))).status).toBe(401);
    expect((await h.req('/api/mcp', rpc('stk_bad.bad', 'tools/list'))).status).toBe(401);
    expect((await h.req('/api/next', { headers: { 'x-ms-client-principal': principal('99') } })).status).toBe(403);
    expect(h.opens()).toBe(0);
  });

  /** @req FR:azure-host/routes.map @req FR:azure-host/auth.api */
  it('REST works for owner session and tokens, scopes enforced', async () => {
    const h = await setup();
    const proj = await h.owner('/api/projects', json({ name: 'Alpha' }));
    expect(proj.status).toBe(201);
    const t = await h.mint('read');
    const list = await h.req('/api/tasks', { headers: { authorization: `Bearer ${t}` } });
    expect(list.status).toBe(200);
    const add = await h.req('/api/tasks', { ...json({ project: 'Alpha', text: 'hi' }), headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' } });
    expect(add.status).toBe(403);
    expect(h.opens()).toBe(1);
  });

  /** @req FR:azure-host/auth.api */
  it('token admin is owner-only', async () => {
    const h = await setup();
    const made = await h.owner('/api/auth/tokens', json({ name: 'a', scopes: ['read'] }));
    expect(made.status).toBe(201);
    const t = await h.mint('read', 'write');
    expect((await h.req('/api/auth/tokens', { headers: { authorization: `Bearer ${t}` } })).status).toBe(403);
  });

  /** @req FR:azure-host/auth.mcp */
  it('MCP runs over the same gate; owner session is not accepted', async () => {
    const h = await setup();
    await h.owner('/api/projects', json({ name: 'Alpha' }));
    const t = await h.mint('read', 'write');
    const r = await h.req('/api/mcp', rpc(t, 'tools/list'));
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain('"next"');
    const sess = await h.owner('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(sess.status).toBe(401);
    const call = await h.req('/api/mcp', rpc(t, 'tools/call', { name: 'add', arguments: { project: 'Alpha', text: 'from mcp' } }));
    expect(JSON.stringify(await call.json())).toContain('added');
    expect((await h.req('/api/mcp', { method: 'GET', headers: { authorization: `Bearer ${t}` } })).status).toBe(405);
  });

  /** @req FR:azure-host/auth.bots @req FR:azure-host/routes.map */
  it('bots: signed webhook runs commands, bad signature and unlisted sender denied', async () => {
    const h = await setup();
    await h.owner('/api/projects', json({ name: 'Alpha' }));
    const ok = await h.host(signedWebhook('/api/bots/webhook', 'whsec', { sender: 'ci-bot', text: 'add Alpha ship it' }));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toMatch(/Added alpha:\d+/i);
    const nxt = await h.host(signedWebhook('/api/bots/webhook', 'whsec', { sender: 'ci-bot', text: 'next' }));
    expect(JSON.stringify(await nxt.json())).toContain('ship it');
    expect((await h.host(signedWebhook('/api/bots/webhook', 'wrong', { sender: 'ci-bot', text: 'next' }))).status).toBe(401);
    expect((await h.host(signedWebhook('/api/bots/webhook', 'whsec', { sender: 'eve', text: 'next' }))).status).toBe(403);
    expect((await h.host(signedWebhook('/api/bots/imessage', 'imsec', { sender: '+15551234567', text: 'next' }))).status).toBe(200);
    expect((await h.req('/api/bots/slack', { method: 'POST', body: 'x' })).status).toBe(401);
    const raw = JSON.stringify({ action: 'created', sender: { login: 'octo' }, comment: { body: '/stack next' } });
    const gh = await h.req('/api/bots/github', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-github-event': 'issue_comment', 'x-hub-signature-256': `sha256=${hmac('ghsec', raw)}` } });
    expect(gh.status).toBe(200);
    expect((await h.req('/api/bots/nope', { method: 'POST' })).status).toBe(404);
  });

  /** @req FR:azure-host/auth.bots */
  it('bot channel without a secret is off', async () => {
    const h = await setup({ ...ENV, STACK_WEBHOOK_SECRET: undefined });
    expect((await h.host(signedWebhook('/api/bots/webhook', 'whsec', { sender: 'ci-bot', text: 'next' }))).status).toBe(404);
  });

  /** @req FR:azure-host/auth.bots */
  it('bot gate allows only the five command routes (no reads of lists, no projects, no tokens)', async () => {
    const { botGate } = await import('../../src/host');
    const allowed = ['next', 'tasks.add', 'tasks.start', 'tasks.complete', 'tasks.skip'];
    for (const n of allowed) expect(botGate(new Request(BASE), { name: n, method: 'POST', write: true })).toBe(true);
    for (const n of ['tasks.list', 'tasks.get', 'tasks.set', 'projects.add', 'projects.list', 'summaries.get', 'tasks.removeCompleted', 'auth.tokens.create', '']) {
      expect(botGate(new Request(BASE), { name: n, method: 'POST', write: true })).toBe(false);
    }
  });

  /** @req FR:azure-host/auth.logs */
  it('logs carry no secrets, tokens, headers, or task text', async () => {
    const h = await setup();
    await h.owner('/api/projects', json({ name: 'Alpha' }));
    const t = await h.mint('read', 'write');
    await h.req('/api/tasks', { ...json({ project: 'Alpha', text: 'TOPSECRETTASK' }), headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' } });
    await h.req('/api/mcp', rpc(t, 'tools/call', { name: 'next', arguments: {} }));
    await h.req('/api/next', { headers: { authorization: 'Bearer stk_nope.nope' } });
    const all = h.logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const bad of [t, 'stk_nope', 'TOPSECRETTASK', 'ghp_secret_repo_token', 'pepper-value', 'whsec', 'authorization']) expect(all).not.toContain(bad);
  });

  /** @req FR:azure-host/routes.errors */
  it('unexpected failures are fixed 500s and log only the class name', async () => {
    const h = await setup(ENV, { openStorage: async () => { throw new TypeError('git said ghp_secret_repo_token'); } });
    await h.owner('/api/projects', json({ name: 'Alpha' }));
    const r = await h.owner('/api/next');
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('ghp_');
    expect(h.logs.join('\n')).not.toContain('ghp_');
  });

  /** @req FR:azure-host/git.clone */
  it('failed storage open is retried, shared while pending', async () => {
    let n = 0;
    const h = await setup(ENV, { openStorage: async () => { n++; if (n === 1) throw new Error('x'); return (await setup()).storage; } });
    expect((await h.owner('/api/next')).status).toBe(500);
    expect((await h.owner('/api/next')).status).toBe(200);
    const results = await Promise.all([h.owner('/api/next'), h.owner('/api/next')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(n).toBe(2);
  });
});
