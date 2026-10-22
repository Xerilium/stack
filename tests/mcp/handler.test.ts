import { setup, URL_MCP } from './helpers';

// @req FR:mcp-server/http.auth
describe('http auth', () => {
  it('denies without a token, before method or body checks', async () => {
    const { mcp } = await setup();
    for (const method of ['POST', 'GET', 'DELETE']) {
      const res = await mcp(new Request(URL_MCP, { method, ...(method === 'POST' ? { body: '{', headers: { 'content-type': 'text/plain' } } : {}) }));
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } });
    }
  });
  it('denies invalid, revoked, and owner-session callers', async () => {
    const { rpc, mint, tokens, mcp } = await setup();
    expect((await rpc('stk_0000000000000000.' + 'A'.repeat(43), 'tools/list')).status).toBe(401);
    const t = await mint('read');
    const id = (await tokens.list()).find((x) => x.scopes.length === 1)!.id;
    await tokens.revoke(id);
    expect((await rpc(t, 'tools/list')).status).toBe(401);
    const principal = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'owner', userDetails: 'o', userRoles: ['authenticated'] })).toString('base64');
    const res = await mcp(new Request(URL_MCP, { method: 'POST', headers: { 'x-ms-client-principal': principal, 'content-type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(401);
  });
  it('accepts X-Stack-Token and answers 403 when verification throws', async () => {
    const { mcp, mint, tokens } = await setup();
    const t = await mint('read');
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'x-stack-token': t, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    expect((await mcp(new Request(URL_MCP, { method: 'POST', headers, body }))).status).toBe(200);
    tokens.verify = async () => { throw new Error('boom'); };
    expect((await mcp(new Request(URL_MCP, { method: 'POST', headers, body }))).status).toBe(403);
  });
});

// @req FR:mcp-server/http.@function @req FR:mcp-server/http.body @req FR:mcp-server/http.headers
describe('http transport', () => {
  it('404s other paths without auth, 405s GET/DELETE after auth', async () => {
    const { mcp, mint } = await setup();
    expect((await mcp(new Request('https://mcp.test/other', { method: 'POST' }))).status).toBe(404);
    const t = await mint('read');
    for (const method of ['GET', 'DELETE']) {
      const res = await mcp(new Request(URL_MCP, { method, headers: { authorization: `Bearer ${t}` } }));
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
  it('honors basePath', async () => {
    const { mcp, mint } = await setup({ basePath: '/x/mcp/' });
    const t = await mint('read');
    const res = await mcp(new Request('https://mcp.test/x/mcp', { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }));
    expect(res.status).toBe(200);
  });
  it('rejects non-JSON, oversize, batch, and malformed bodies', async () => {
    const { mcp, mint } = await setup();
    const t = await mint('read');
    const go = (body: string, ct = 'application/json') => mcp(new Request(URL_MCP, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': ct, accept: 'application/json, text/event-stream' }, body }));
    expect((await go('{}', 'text/plain')).status).toBe(415);
    expect((await go('x'.repeat(70 * 1024))).status).toBe(413);
    expect((await go('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).status).toBe(400);
    expect((await go('{')).status).toBe(400);
  });
  it('is stateless JSON with no-store; notifications get 202', async () => {
    const { rpc, mint } = await setup();
    const t = await mint('read');
    const r = await rpc(t, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.res.headers.get('mcp-session-id')).toBeNull();
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    expect(r.json.result.serverInfo.name).toBe('stack');
    const n = await rpc(t, 'notifications/initialized', undefined, null);
    expect(n.status).toBe(202);
  });
  it('reports unexpected failures with fixed text and class name only', async () => {
    const errs: unknown[] = [];
    const { mcp, mint } = await setup({ onError: (e) => errs.push(e), api: async () => { throw new TypeError('secret task text'); } });
    const t = await mint('write');
    const res = await mcp(new Request(URL_MCP, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'start', arguments: {} } }) }));
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).toContain('error internal');
    expect(errs).toEqual(['TypeError']);
  });
});

// @req FR:mcp-server/http.events
describe('events', () => {
  it('emit decisions without arguments or results', async () => {
    const events: unknown[] = [];
    const { call, mint, rpc } = await setup({ onEvent: (e) => events.push(e) });
    const w = await mint('write');
    await call(w, 'add', { project: 'alpha', text: 'SECRET' });
    await rpc(null, 'tools/list');
    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(events).toContainEqual(expect.objectContaining({ kind: 'allow', tool: 'add', status: 201 }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'deny', status: 401 }));
  });
  it('emits deny with the real status when the API refuses', async () => {
    const events: any[] = [];
    const { mcp, mint } = await setup({ api: async () => new Response('{"error":{"code":"forbidden"}}', { status: 403 }), onEvent: (e) => events.push(e) });
    const w = await mint('write');
    await mcp(new Request('https://mcp.test/mcp', { method: 'POST', headers: { authorization: `Bearer ${w}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add', arguments: { project: 'alpha', text: 'x' } } }) }));
    expect(events).toEqual([expect.objectContaining({ kind: 'deny', tool: 'add', status: 403 })]);
  });
  it('emits deny with the real status when the API refuses', async () => {
    const events: any[] = [];
    const { mcp, mint } = await setup({ api: async () => new Response('{"error":{"code":"forbidden"}}', { status: 403 }), onEvent: (e) => events.push(e) });
    const w = await mint('write');
    await mcp(new Request('https://mcp.test/mcp', { method: 'POST', headers: { authorization: `Bearer ${w}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add', arguments: { project: 'alpha', text: 'x' } } }) }));
    expect(events).toEqual([expect.objectContaining({ kind: 'deny', tool: 'add', status: 403 })]);
  });
});

// @req FR:mcp-server/http.azure
describe('azure', () => {
  it('plugs into registerAzure unchanged', async () => {
    const { registerAzure } = await import('../../src/api');
    const { mcp, mint } = await setup();
    const t = await mint('read');
    let fn: ((r: any) => Promise<any>) | undefined;
    registerAzure({ http: (_n: string, o: any) => { fn = o.handler; } }, mcp, 'mcp');
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const res = await fn!({ method: 'POST', url: URL_MCP, headers: new Headers({ authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }), text: async () => body });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result.tools.map((x: any) => x.name)).toEqual(['next', 'list']);
  });
});
