---
id: api
title: API
author: flanakin
description: "REST over the core: next, add, lifecycle actions, list/get, summaries. Framework-neutral Request-to-Response handler with a deny-by-default authorize hook."
dependencies: [task-lifecycle, summaries, storage-git]
---

<!-- markdownlint-disable single-title -->

# Feature: API

## Purpose

One HTTP surface over the core so the web app, quick capture, chat bots, and the MCP server all use the same flows. Host target is Azure Static Web Apps managed Functions (free tier); the core handler knows nothing about Azure.

## Scope

- In: JSON REST handler, validation, error model, field selection, authorize hook, Azure adapter, OpenAPI spec.
- Non-goals: authentication and tokens (auth-security adds them through the hook); scoring or storage changes; the web UI.

## Scenarios

### FR:handler: Framework-neutral handler

- **FR:handler.@function** (P1): Interface: `createApiHandler(deps): (req: Request) => Promise<Response>` using the standard Fetch `Request`/`Response`. `deps = { storage, config?, now?, engine?, authorize?, basePath? }`. The handler MUST NOT import any host framework
- **FR:handler.base** (P1): Routes live under `basePath` (default `/api`); a path outside it is `404 not_found`
- **FR:handler.storage** (P1): All reads and writes go through the injected `Storage` (git storage commits directly); the handler keeps no state between requests

### FR:auth: Authorize hook

- **FR:auth.deny** (P1): With no `authorize` supplied every request MUST be denied with `401 unauthorized`
- **FR:auth.hook** (P1): `authorize(req, route)` runs before routing outcomes, body parsing, or any storage access. `route = { name, method, write }` (`name` is `unknown` when no route matches). It receives a clone, so the body stays unread. It returns `true`/`false` or `{ allow, status? }`
- **FR:auth.decision** (P1): `true` or `{ allow: true }` allows (an allow may carry `token: { id, name }` for a token caller; routes use the name to attribute writes, never the body); `false` is `403 forbidden`; `{ allow: false, status: 401 | 403 }` uses that status. Anything else, or a throw or rejection, MUST deny with `403 forbidden` (a throw MUST NOT leak its message)
- **FR:auth.noleak** (P1): An unmatched route or wrong method is denied before it is reported, so a caller learns nothing about routes

### FR:errors: Error model

- **FR:errors.shape** (P1): Every non-2xx body is `{"error":{"code","message","details"?}}` with `application/json`
- **FR:errors.codes** (P1): `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `method_not_allowed` 405 (with `Allow`), `conflict` 409, `payload_too_large` 413, `unsupported_media_type` 415, `invalid` 422, `internal` 500
- **FR:errors.map** (P1): `NotFoundError` and a lifecycle "not found" are 404; `ConflictError` is 409; other `LifecycleError` and `PathError` are 422/400 (`invalid`/`bad_request`); client messages for core errors are fixed text and never echo file content or input; anything else is 500 `internal` with a fixed message (no stack or internals)
- **FR:errors.validation** (P1): Validation failures are `422 invalid` with `details` listing `{ field, message }` for each problem

### FR:input: Input validation

- **FR:input.json** (P1): A body MUST be `application/json` (415 otherwise), valid JSON object (400), at most 64 KiB (413). GET has no body. The body is read only after authorization, as a stream with a hard 64 KiB cap (no unbounded buffering, with or without `content-length`)
- **FR:input.strict** (P1): Unknown body fields and unknown query parameters are rejected (`invalid`), so typos never silently do nothing
- **FR:input.types** (P1): Strings, integers, booleans, enums, and refs are type- and range-checked before the core is called; strings are limited to 2000 characters (summary 10000)
- **FR:input.ref** (P1): A task ref is the string `project:line` (project is the file base name; line is a non-negative integer). Anything else is `invalid`; `README` (any case) is never a valid ref or project `fileName`
- **FR:input.line** (P1): Single-line fields (including `complete.summary`) MUST reject CR, LF, U+0085, U+2028, and U+2029 so input cannot inject markdown lines
- **FR:input.enums** (P1): `status`, `priority`, `effort`, `impact` (emoji or `None`), `checkbox` (`Complete`/`Incomplete`), and `suspend` format are checked at the API layer; OpenAPI declares the same enums
- **FR:input.noforce** (P1): `POST /projects` never overwrites an existing project file (409); there is no `force` option

### FR:routes: Endpoints

- **FR:routes.next** (P1): `GET /next` returns `{task}`, where `task` is `{ref,text,project,score}` or `null` when nothing is active
- **FR:routes.add** (P1): `POST /tasks` `{project,text,section?,parent?}` adds a task (201); `POST /projects` `{name,description?,repositoryUrl?,aliases?,priority?,capacity?,weeklyCapacity?,fileName?,force?}` adds a project (201 `{path,project}`)
- **FR:routes.actions** (P1): `POST /tasks/{start|complete|skip|resume|suspend|set}` with `ref` (optional except for `set`; omitted means the next or parked task, as in the core). `complete` takes `summary?`, `remove?`; `suspend` takes `days?` or `hours?`; `set` takes `status?`, `priority?`, `effort?`, `impact?`, `checkbox?`, `suspend?`, `clearEmojis?`. Returns `{changed,ref?,before?,after?,message?}`
- **FR:routes.remove** (P1): `POST /tasks/remove-completed` `{project?}` returns `{removed,files}`
- **FR:routes.tasks** (P1): `GET /tasks` lists tasks (children included) with `project`, `section`, `state` (`open` default, `done`, `all`), `q` (case-insensitive text), `limit` (1-200, default 50), `offset`; returns `{items,total,offset,limit}`. `GET /tasks/{ref}` returns one item (404 if the line is not a task)
- **FR:routes.projects** (P1): `GET /projects` lists projects; `GET /projects/{name}` returns one (404 when absent); `name` matches the file base name
- **FR:routes.summaries** (P1): `GET /summaries` returns `{readme,stack,projects,myDay}` generated from storage (`myDay` is `null` when no tasks); `fields` selects which

### FR:compact: Token-efficient responses

- **FR:compact.json** (P1): JSON MUST be compact (no extra whitespace) and omit undefined values
- **FR:compact.fields** (P1): `fields=a,b` on any GET returns only those fields (per item for lists, in `task` for next); unknown fields are `invalid`. Defaults are small: task `ref,text,project,section,done`; project `name,title,open,done`
- **FR:compact.cache** (P2): Responses carry `Cache-Control: no-store`

### FR:azure: Azure adapter

- **FR:azure.@function** (P1): `toAzureHandler(handler)` in `src/api/azure.ts` turns an Azure Functions v4 HTTP request (`method`, `url`, `headers`, `text()`) into a `Request` and the `Response` into `{status,headers,body}`; `registerAzure(app, handler, name?)` registers a catch-all `api/{*route}` function without importing `@azure/functions`
- **FR:azure.body** (P1): GET/HEAD requests carry no body; the body of others is read as text

### FR:docs: OpenAPI

- **FR:docs.openapi** (P1): `docs/api/openapi.yaml` is OpenAPI 3.0.3, documents every route, the error model, and `fields`; the document MUST be generated from the route table (`pnpm openapi`) and a test MUST fail when the committed file differs from the generated one
  - **FR:docs.openapi.parity** (P1): Tests MUST check, per route, schema-level parity between the handler and the document: path and query params (names, types, bounds, enum, defaults), request body (properties, required, enums, bounds, `additionalProperties: false`), response schemas against real handler output, and the global `security` requirement (every route denies without a grant)
  - **FR:docs.openapi.valid** (P1): The document MUST be structurally valid OpenAPI 3.0.3 (single `components`, every `$ref` resolves, operationIds unique)
