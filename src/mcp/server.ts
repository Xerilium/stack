/**
 * SDK server bound to one caller's scopes. Stateless: build one per request (HTTP) or per process (stdio).
 * @req FR:mcp-server/tools.scope @req FR:mcp-server/tools.api
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { routeScope, scopeCovers } from '../api/auth';
import { ArgError, buildRequest, checkArgs, errorText, inputSchema, replyFrom, TOOLS, type ToolDef } from './tools';

export interface McpEvent { kind: 'allow' | 'deny'; tool?: string; status: number; tokenId?: string }
export interface McpServerOptions {
  /** The API handler (authorizing). Receives one request per tool call. */
  api: (req: Request) => Promise<Response>;
  scopes: string[];
  /** Auth headers forwarded to the API (the caller's bearer token). Nothing else is forwarded. */
  headers?: Record<string, string>;
  tokenId?: string;
  /** Max ms for one API call; default 30000. */
  timeoutMs?: number;
  onEvent?: (e: McpEvent) => void;
  /** Receives the error's class name only. */
  onError?: (className: string) => void;
}

const BASE = 'https://mcp.invalid/api';

export function createMcpServer(opts: McpServerOptions): Server {
  const allowed = (t: ToolDef) => { const need = routeScope(t.route); return need !== null && scopeCovers(opts.scopes, need); };
  const emit = (e: McpEvent) => { try { opts.onEvent?.({ ...e, ...(opts.tokenId ? { tokenId: opts.tokenId } : {}) }); } catch { /* a broken logger never changes the decision */ } };
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

  const server = new Server({ name: 'stack', version: '0.0.1' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.filter(allowed).map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchema(t) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = TOOLS.find((x) => x.name === req.params.name);
    if (!t || !allowed(t)) { emit({ kind: 'deny', tool: t?.name, status: 403 }); return fail(errorText('forbidden')); }
    let args: Record<string, string | number | boolean>;
    try { args = checkArgs(t, req.params.arguments); } catch (e) {
      if (e instanceof ArgError) return fail(errorText('invalid', [{ field: e.field, message: e.message }]));
      throw e;
    }
    if (t.actor) args = { ...args, actor: `mcp:${opts.tokenId ?? 'local'}` };
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('Timeout')), opts.timeoutMs ?? 30000); });
      let res: Response;
      try { res = await Promise.race([opts.api(buildRequest(t, args, BASE, opts.headers ?? {})), timeout]); } finally { clearTimeout(timer); }
      const r = await replyFrom(t, res);
      emit({ kind: r.status === 401 || r.status === 403 ? 'deny' : 'allow', tool: t.name, status: r.status });
      return r.isError ? fail(r.text) : { content: [{ type: 'text' as const, text: r.text }] };
    } catch (e) {
      try { opts.onError?.(e instanceof Error ? e.constructor.name : 'Error'); } catch { /* ignore */ }
      return fail(errorText('internal'));
    }
  });

  return server;
}
