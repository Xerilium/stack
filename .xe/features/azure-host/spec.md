---
id: azure-host
title: Azure Host
author: flanakin
description: "Deployable Azure Functions host (SWA managed functions, Node 22, programming model v4) that wires the API, MCP, bots, auth, and git storage from src/ and is configured only by app settings."
dependencies: [api, auth-security, mcp-server, chat-bots, storage-git]
---

<!-- markdownlint-disable single-title -->

# Feature: Azure Host

## Purpose

Run Stack on Azure Static Web Apps managed Functions: one deployable `host/` that exposes the REST API, MCP, and chat-bot endpoints over the existing handlers, stores tasks in the owner's private GitHub repo, and needs nothing but app settings.

## Scope

- In: `host/` package (own `package.json`, `host.json`, entry), `src/host/` wiring (settings, git repo bootstrap, router), health endpoint, docs for settings.
- Out: deploying, creating Azure resources, the SWA workflow and Bicep (deploy-docs), persistent token storage beyond a file path, web UI.

## Scenarios

### FR:routes: Routing

- **FR:routes.register** (P1): One catch-all function is registered with `registerAzure(app, handler, 'api')` (route `{*route}`, anonymous at the Functions layer; the code does the real auth). The entry only registers; all logic is in `src/host/` and testable without `@azure/functions`
- **FR:routes.map** (P1): `/api/health` health; `/api/mcp` MCP handler (`basePath` `/api/mcp`); `/api/bots/{slack,webhook,github,imessage}` bot handler (`basePath` `/api/bots`); every other `/api/**` the authorizing API handler with token admin. Paths outside `/api` answer `404`
- **FR:routes.paths** (P1): Dispatch uses one canonical path (trailing slashes stripped) for every area, including bots (`/api/bots/webhook/` works). Doubled slashes, case changes, encoded dots/segments, and `/api/bots` without a subpath never reach a handler they do not belong to; bot routes in degraded mode answer `503`
- **FR:routes.errors** (P1): Unexpected failures answer fixed `500 {error:{code:'internal'}}`; nothing from the error is sent to the caller

### FR:health: Health

- **FR:health.shape** (P1): `GET|HEAD /api/health` is unauthenticated and answers `{status:'ok'}` (or `{status:'degraded'}` when settings are invalid). It never touches storage, tokens, or the network and carries no task data, names, counts, or setting values. `Cache-Control: no-store`. Reporting `degraded` without auth is accepted: it holds no setting names or values and helps operators


### FR:settings: Settings

- **FR:settings.parse** (P1): Config comes only from app settings: `STACK_REPO_URL` (https, no embedded credentials), `STACK_REPO_BRANCH` (default `main`), `STACK_REPO_PATH` (optional relative subfolder), `STACK_REPO_TOKEN` (GitHub credential), `STACK_OWNERS` (owner allow-list), `STACK_TOKEN_STORE` (optional token file path override), `STACK_TOKEN_PEPPER`, `STACK_CONFIG` (optional JSON stack config), and the bot settings `STACK_SLACK_SIGNING_SECRET`, `STACK_IMESSAGE_SECRET`, `STACK_WEBHOOK_SECRET`, `STACK_GITHUB_WEBHOOK_SECRET` with matching `*_ALLOW` comma lists
- **FR:settings.invalid** (P1): Invalid or missing required settings (repo URL, token, branch, path, config) make every route except health answer `503 {error:{code:'unavailable'}}` with fixed text; errors name the setting, never its value
- **FR:settings.deny** (P1): No owners means no session access; a bot channel without a secret is off; an empty allow-list denies every sender. A bad `STACK_REPO_URL` (http, credentials, other host schemes) is rejected
- **FR:settings.url** (P1): The repo URL is normalized with `new URL(raw).href` and git gets only that normalized string, so the host that was validated is the host git contacts. Any https host is allowed and receives the token; the operator must point it only at a host they trust
- **FR:settings.identity** (P2): `STACK_GIT_NAME`/`STACK_GIT_EMAIL` must not start with `-`, contain control characters or `<>`, or exceed 200 chars; the email has no whitespace. Branch names follow git ref rules (no `//`, no segment starting `.` or ending `.lock`, no trailing `.`)

### FR:git: Git storage

- **FR:git.clone** (P1): On first use per instance the repo is cloned (single branch) into a fresh private directory under the OS temp dir and wrapped by the `GitStorage` adapter with remote `origin` and the configured branch, so writes are direct commits pushed to that branch. Concurrent first requests share one clone; a failed clone is not cached
- **FR:git.timeout** (P1): Every git command has a timeout (default 120s) and is killed when it expires, so a hung remote cannot hang requests. A failed clone removes its directory. After a failed open, later calls fail fast for a short cooldown (default 30s) instead of cloning again
- **FR:git.symlinks** (P1): The clone runs with `core.symlinks=false` (tracked links become plain files) and storage refuses any symlink on a task or state path (see storage-git `fs.contain`), so repo content cannot read or write host files
- **FR:git.env** (P1): Git gets a minimal environment (PATH, HOME, TMP vars, plus the git settings below), never the app's `STACK_*` values; global and system config are `/dev/null`, `GIT_ASKPASS` is empty, `http.followRedirects=false`. The credential env is passed to the git adapter by option; `process.env` is never modified
- **FR:git.lazy** (P1): The clone happens only after a request carries a credential the host must check (owner principal header or token) or reaches a route that needs tasks; health and requests with no credential never trigger it. It is opened once per instance
- **FR:git.auth** (P1): The token is passed to git only through the environment as an `http.<origin>/.extraHeader` config scoped to the repo's origin; never in the URL, command line, remote config, `process.env`, logs, or responses. Git is limited to https transport, never prompts, and ignores system config
- **FR:git.identity** (P2): Commits use `Stack <stack@users.noreply.github.com>` unless `STACK_GIT_NAME`/`STACK_GIT_EMAIL` are set

### FR:auth: Auth wiring

- **FR:auth.swa** (P1): Owner sessions trust the SWA-injected `x-ms-client-principal` header unconditionally, so the Function MUST be reachable only through the SWA (no BYO functions backend, no direct `*.azurewebsites.net` exposure). This is a hard deployment requirement documented in the docs; the code adds no extra check

- **FR:auth.api** (P1): The API handler uses `createAuth` `authorize` (owner session via `STACK_OWNERS` or scoped token) from the token service over the token store below with `STACK_TOKEN_PEPPER`
- **FR:auth.mcp** (P1): MCP forwards the caller's token to the same authorizing API handler; owner sessions never reach MCP
- **FR:auth.bots** (P1): Bots call a second, in-process API handler whose gate allows only `next`, `tasks.add`, `tasks.start`, `tasks.complete`, `tasks.skip`; it is never routable from outside, and no service token exists
- **FR:auth.logs** (P1): Logging receives only auth/MCP event fields (kind, route, status, token id) and error class names; never tokens, secrets, headers, bodies, or task data

### FR:tokens: Token persistence

- **FR:tokens.git** (P1): By default the token store is `.stack/tokens.json` in the data repo, written through the storage adapter (state-file API: fixed `.stack/<name>.json` paths, same queue, direct commit and push, version-checked; a conflict maps to the token store conflict so the service retries). Only hashes, scopes, and expiry are stored, never secrets. Reads sync from the remote at most every 60 seconds so a revocation made on another instance applies within about a minute; a failed sync serves the local copy. `STACK_TOKEN_STORE` (absolute path) switches to the file store; state files are never listed as tasks
- **FR:tokens.override** (P1): Setting `STACK_TOKEN_STORE` requires `STACK_TOKEN_PEPPER` (otherwise settings are invalid), because a file in a predictable or shared path could be pre-planted; with a pepper a planted file grants nothing. The file store is per instance, so revocation is best effort across instances

### FR:pkg: Package

- **FR:pkg.layout** (P1): `host/package.json` (`main` = built entry, Node `>=22 <23`, exact dependency versions, `@azure/functions` 4.x), `host/host.json` (v2), built from `src/` by `tsc` into `host/dist`; `pnpm build` produces it; `host/dist`, `host/node_modules` are not committed
