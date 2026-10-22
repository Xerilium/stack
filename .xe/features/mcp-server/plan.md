---
id: mcp-server
title: MCP Server Plan
---

# Plan: MCP Server

## Approach

`src/mcp/` wraps the API handler. Each tool declares its API route, scope, and argument names. A call is validated for shape only, turned into one in-process API request carrying the caller's bearer token, and the API's JSON reply is reduced to a compact text block. The SDK's low-level `Server` and `WebStandardStreamableHTTPServerTransport` do the protocol; tool schemas are plain JSON Schema (no zod authoring, no duplicated field rules).

## Contracts

- `createMcpHandler`, `McpHttpDeps`, `createMcpServer`, `TOOLS`, `stack-mcp` bin

## Decisions

- Modules: `tools.ts` (definitions, request build, reply format), `server.ts` (SDK server bound to scopes + token), `handler.ts` (HTTP: auth, caps, stateless transport), `stdio.ts` (bin)
- Scopes: reuse `routeScope` and add exports `presentedToken` and `scopeCovers` from `src/api/auth/authorize.ts`; the API's own `authorize` still runs on every forwarded call (two gates)
- Stateless per-request server: fits Functions, no session store, no SSE
- Auth before method/body; only the token header is forwarded
- Replies never echo text for mutations; list/next text is JSON-encoded
- Dependencies: `@modelcontextprotocol/sdk` 1.32.1 and its `zod` peer, exact versions
- Build: `tsconfig.mcp.json` added to `pnpm build` and lint; `bin.stack-mcp`
- Tests: `tests/mcp/*.test.ts` using API handler + `createAuth` over `MemoryStorage`; SDK `Client` over a fetch bridge for protocol e2e
