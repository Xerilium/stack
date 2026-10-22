import { createApiHandler } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, type Scope } from '../../src/api';
import { createMcpHandler, type McpHttpDeps } from '../../src/mcp';
import { MemoryStorage } from '../../src/core/storage';

export const NOW = new Date('2026-10-22T18:00:00Z');
export const URL_MCP = 'https://mcp.test/mcp';

export async function setup(over: Partial<McpHttpDeps> = {}) {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [{ provider: 'github', userId: 'owner' }], tokens });
  const api = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const apiCalls: Request[] = [];
  const spyApi = async (req: Request) => { apiCalls.push(req.clone()); return api(req); };
  const mcp = createMcpHandler({ api: spyApi, tokens, ...over });
  const mint = async (...scopes: Scope[]) => (await tokens.create({ name: 't', scopes })).token;
  // Seed through the real api with a full token.
  const admin = await mint('read', 'write', 'projects:write');
  const post = (path: string, body: unknown) => api(new Request(`https://mcp.test/api${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await post('/projects', { name: 'Alpha', aliases: ['al'] });
  apiCalls.length = 0;
  const rpc = async (token: string | null, method: string, params?: unknown, id: number | null = 1, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers };
    if (token) h['authorization'] = `Bearer ${token}`;
    const res = await mcp(new Request(URL_MCP, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }) }));
    const text = await res.text();
    return { res, status: res.status, text, json: text ? JSON.parse(text) : undefined };
  };
  const call = async (token: string, name: string, args?: unknown) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    return r.json.result as { content: { type: string; text: string }[]; isError?: boolean };
  };
  const text = async (token: string, name: string, args?: unknown) => (await call(token, name, args)).content[0].text;
  return { storage, tokens, api, mcp, mint, rpc, call, text, apiCalls, post };
}
