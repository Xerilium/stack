---
id: mcp-server
title: MCP Server
author: flanakin
description: "Token-efficient MCP tools (next, list, add, complete, start, skip, resume, suspend, set) over the API handler, authenticated with scoped API tokens, over streamable HTTP and stdio."
dependencies: [api, auth-security]
---

<!-- markdownlint-disable single-title -->

# Feature: MCP Server

## Purpose

Let AI agents operate the stack through MCP with small tool lists and small replies. Tools are a thin layer over the API handler: all validation, lifecycle, and storage logic stays in the API and core.

## Scope

- In: tools `next`, `list`, `add`, `complete`, `start`, `skip`, `resume`, `suspend`, `set`; scoped-token auth; stateless streamable HTTP handler (Azure Functions friendly); stdio entry (`stack-mcp`).
- Out: autonomy logic, prompts/resources, sessions and server-initiated streams, owner (browser) sessions, token admin, project creation, capture.

## Scenarios

### FR:tools: Tools

- **FR:tools.list** (P1): `tools/list` returns exactly the tools the caller's scopes allow, each with a one-sentence description (under 100 characters) and a closed input schema (`additionalProperties: false`), no examples or prose
- **FR:tools.scope** (P1): Each tool maps to one API route and needs that route's scope (reusing the auth-security scope table: `next`, `list` -> `tasks:read`; the rest -> `tasks:write`; `read`/`write` also cover). A tool the token lacks is hidden and calling it is a tool error `forbidden`; an unmapped tool is denied
- **FR:tools.api** (P1): Every call becomes one in-process request to the API handler (`GET /next`, `GET /tasks`, `POST /tasks`, `POST /tasks/{action}`), forwarding only the caller's token as `Authorization: Bearer`. The API stays the single place for validation, authorization, and lifecycle; the MCP layer holds none of that logic
- **FR:tools.args** (P1): Unknown arguments, non-object arguments, and non-scalar values are rejected as `invalid` before any API call. Field limits (single line, length, enums, ranges) are the API's
- **FR:tools.next** (P1): `next` returns compact JSON `{ref,text,project,score}` or `none`
- **FR:tools.list-tool** (P1): `list` takes `project`, `section`, `state` (open|done|all, default open), `q`, `limit` (1-100, default 20), `offset`; returns `{total,offset,items:[[ref,text,project],...]}` with no field names repeated per item
- **FR:tools.mutate** (P1): `add` (`project`, `text`, `section?`, `parent?`), `complete` (`ref?`, `summary?`, `remove?`), `start|skip|resume` (`ref?`), `suspend` (`ref?`, `days?`, `hours?`), `set` (`ref`, `status?`, `priority?`, `effort?`, `impact?`, `checkbox?`, `suspend?`, `clearEmojis?`). Replies are fixed short text: `added <ref>`, `completed <ref>`, `started <ref>`, `skipped <ref>`, `resumed <ref>`, `suspended <ref>`, `updated <ref>`, or `no change` when nothing changed

### FR:out: Output safety

- **FR:out.noecho** (P1): Mutation replies never contain task text, before/after lines, or core messages. Only `ref` values from the API (`project:line`) appear
- **FR:out.json** (P1): Task text (`next`, `list`) is only ever emitted as JSON string values, so a task cannot forge extra lines or structure
- **FR:out.errors** (P1): Failures are tool errors (`isError`) with fixed text `error <code>` plus, for validation, `field: message` pairs (API messages only, control characters removed, capped at 200 characters). Unexpected failures are `error internal`; details go to `onError` by class name only
- **FR:out.shape** (P1): Replies are a single text content block; no structured duplicate

### FR:http: Streamable HTTP

- **FR:http.@function** (P1): `createMcpHandler({api, tokens, basePath?, onError?, onEvent?}): (req) => Promise<Response>` handles `POST {basePath}` (default `/mcp`) statelessly: a fresh server and the SDK's web-standard transport per request, JSON responses, no sessions, no SSE. `GET` and `DELETE` answer `405` with `Allow: POST`. Other paths answer `404`
- **FR:http.auth** (P1): Deny by default: the token (`Authorization: Bearer` or `X-Stack-Token`) is verified before the method is checked or the body is read. Missing or invalid -> `401` with `WWW-Authenticate: Bearer`; verification failure -> `403`. Owner session headers are never accepted or forwarded
- **FR:http.body** (P1): Body is JSON only (`415` otherwise), capped at 64 KiB (`413`), a single JSON-RPC message (not a batch)
- **FR:http.headers** (P1): Responses carry `Cache-Control: no-store`
- **FR:http.errors** (P1): Failures outside JSON-RPC use the API's `{error:{code,message}}` shape with fixed text
- **FR:http.events** (P2): `onEvent({kind, tool?, status, tokenId?})` receives allow/deny decisions only; never arguments or results
- **FR:http.azure** (P1): The handler plugs into `registerAzure(app, handler, 'mcp')` unchanged, with the function route set to `mcp`

### FR:stdio: stdio

- **FR:stdio.entry** (P1): `stack-mcp [--dir <path>] [--scopes a,b]` serves MCP over stdio against the project directory (default current directory; git storage when `.git` exists). Scopes default to all of `read`/`write` (local process, same trust as the CLI); `--scopes` or `STACK_MCP_SCOPES` narrows them; unknown scope names grant nothing
- **FR:stdio.quiet** (P1): stdout carries only protocol frames; diagnostics go to stderr and never include task data
