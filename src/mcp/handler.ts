/**
 * Stateless streamable-HTTP MCP endpoint: (Request) => Response, token auth first.
 * @req FR:mcp-server/http.@function
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { presentedToken, type TokenService } from '../api/auth';
import { ApiError, errorResponse, toApiError } from '../api/errors';
import { readBody } from '../api/validate';
import { createMcpServer, type McpEvent } from './server';

export interface McpHttpDeps {
  /** The authorizing API handler (e.g. `auth.wrap(createApiHandler(...))`). */
  api: (req: Request) => Promise<Response>;
  tokens: TokenService;
  /** Default `/mcp`. */
  basePath?: string;
  onEvent?: (e: McpEvent) => void;
  /** Receives the error's class name only. */
  onError?: (className: string) => void;
}

const className = (e: unknown) => (e instanceof Error ? e.constructor.name : 'Error');

/** Plugs into `registerAzure(app, handler, "mcp")` as is. @req FR:mcp-server/http.azure @req FR:mcp-server/http.events (events go to deps.onEvent) */
export function createMcpHandler(deps: McpHttpDeps): (req: Request) => Promise<Response> {
  const base = (deps.basePath ?? '/mcp').replace(/\/+$/, '');
  const emit = (e: McpEvent) => { try { deps.onEvent?.(e); } catch { /* ignore */ } };
  const deny = (status: 401 | 403): Response => {
    emit({ kind: 'deny', status });
    return status === 401
      ? errorResponse(new ApiError('unauthorized', 'Authentication required', undefined, { 'www-authenticate': 'Bearer' }))
      : errorResponse(new ApiError('forbidden', 'Forbidden'));
  };

  /** @req FR:mcp-server/http.auth @req FR:mcp-server/http.body @req FR:mcp-server/http.headers @req FR:mcp-server/http.errors */
  return async (req) => {
    try {
      if (new URL(req.url).pathname.replace(/\/+$/, '') !== base) return errorResponse(new ApiError('not_found', 'Not found'));

      // Auth first: nothing about the method or body is learned without a valid token.
      const token = presentedToken(req);
      if (token === null) return deny(401);
      let who;
      try { who = await deps.tokens.verify(token); } catch { return deny(403); }
      if (!who) return deny(401);

      if (req.method.toUpperCase() !== 'POST') {
        return errorResponse(new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: 'POST' }));
      }
      const parsedBody = await readBody(req);

      const server = createMcpServer({
        api: deps.api, scopes: who.scopes, tokenId: who.id, headers: { authorization: `Bearer ${token}` },
        onEvent: deps.onEvent, onError: deps.onError,
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      try {
        await server.connect(transport);
        const res = await transport.handleRequest(req, { parsedBody });
        const headers = new Headers(res.headers);
        headers.set('cache-control', 'no-store');
        return new Response(await res.arrayBuffer(), { status: res.status, headers });
      } finally {
        void server.close().catch(() => undefined);
      }
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'internal') { try { deps.onError?.(className(e)); } catch { /* ignore */ } }
      return errorResponse(err);
    }
  };
}
