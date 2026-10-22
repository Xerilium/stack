---
id: auth-security
title: Auth and Security
author: flanakin
description: "Owner-only SWA sign-in, hashed scoped revocable API tokens, the api authorize hook, threat model, and security tests."
dependencies: [api]
---

<!-- markdownlint-disable single-title -->

# Feature: Auth and Security

## Purpose

Keep Stack private to its one owner: deny every request by default and let in only the owner's browser session or one of the owner's own API tokens. Ends at single-owner access; multi-user accounts are out of scope.

## Scope

- In: SWA principal parsing and owner allow-list, API token lifecycle and storage, the `authorize` hook for `src/api`, token admin endpoints, threat model, security tests.
- Non-goals: multi-user, roles beyond scopes, login UI, rate limiting at the host, CLI changes (the library does not depend on the CLI).
- Free tier: no Key Vault. Owner list and optional pepper come from app settings (`STACK_OWNERS`, `STACK_TOKEN_PEPPER`).

## Scenarios

### FR:session: Owner browser session

Owner needs to sign in through Static Web Apps so that only the owner's browser reaches the API.

- **FR:session.@function** (P1): Interface: `parseClientPrincipal(header)`, `parseOwners(setting)`, `isOwner(principal, owners)`, `createAuth(opts)` in `src/api/auth`
- **FR:session.input** (P1):
  - Principal header (string) — the `x-ms-client-principal` value, base64 JSON
  - Owner list (string) — comma-separated `provider:userId` entries from `STACK_OWNERS`
- **FR:session.parse** (P1): Parser MUST return `null`, never throw, for a missing, oversized (over 8 KiB), non-base64, non-JSON, non-object, or wrongly typed header
  - **FR:session.parse.roles** (P1): Parser MUST require `userRoles` to be an array of strings that includes `authenticated`
- **FR:session.allow** (P1): Allow-list MUST admit a principal only when `identityProvider:userId` equals an owner entry (provider case-insensitive, user id exact)
  - **FR:session.allow.empty** (P1): Allow-list MUST deny everyone when `STACK_OWNERS` is empty or unset
  - **FR:session.allow.details** (P1): Allow-list MUST NOT match on `userDetails` (a mutable display value)
- **FR:session.csrf** (P1): Authorizer MUST deny a session write whose `Origin` header names a different host than the request, whose `Sec-Fetch-Site` is not `same-origin`/`none`, or that carries neither header
- **FR:session.output** (P1): Denial is `401` when no valid principal or token is present and `403` when the principal is not an owner

### FR:token: API tokens

Owner needs to create, list, and revoke API tokens so that scripts and agents get limited, revocable access.

- **FR:token.@function** (P1): Interface: `createTokenService(opts)` with `create`, `list`, `revoke`, `verify`, plus `FileTokenStore` and `MemoryTokenStore`
- **FR:token.input** (P1):
  - Name (string) — 1 to 80 single-line characters
  - Scopes (string list) — one or more of `read`, `write`, `tasks:read`, `tasks:write`, `projects:read`, `projects:write`, `summaries:read`
  - Lifetime (number) — days, 1 to 365, default 90
- **FR:token.create** (P1): Service MUST generate a token `stk_<id>.<secret>` where the secret is 256 random bits from the OS CSPRNG
  - **FR:token.create.once** (P1): Service MUST return the full token only from `create`, never from `list` or `verify`
  - **FR:token.create.limit** (P1): Service MUST refuse to create more than 50 active tokens
- **FR:token.hash** (P1): Service MUST store only a SHA-256 hash of the secret (HMAC-SHA-256 when a pepper is set)
- **FR:token.verify** (P1): Service MUST compare hashes in constant time and treat an unknown id like a wrong secret
  - **FR:token.verify.expiry** (P1): Service MUST reject an expired or revoked token
  - **FR:token.verify.record** (P1): Service MUST treat a stored record with an invalid shape, unknown scopes, bad hash, or unparseable `expiresAt` as never verifying (an unparseable `expiresAt` counts as expired)
  - **FR:token.verify.format** (P1): Service MUST reject a malformed token without touching the store
- **FR:token.list** (P1): Service MUST list `id`, `name`, `scopes`, `createdAt`, `expiresAt`, `revokedAt`, and `status`, never the hash
- **FR:token.revoke** (P1): Service MUST mark a token revoked by id and treat a repeat revoke as a no-op; an unknown id MUST be reported as not found
- **FR:token.file** (P1): Token file MUST be JSON `{ "version": 1, "tokens": [...] }` holding hashes and metadata only, written atomically with owner-only permissions and optimistic version checks
  - **FR:token.file.conflict** (P1): Service MUST retry a write that loses a version race, then fail without losing the other writer's change
  - **FR:token.file.lock** (P1): File store MUST serialize the version check and the rename (in-process queue per path plus an exclusive lockfile with stale-lock recovery) so concurrent writers never lose an update

### FR:authorize: Authorize hook

API needs every request checked before any work so that nothing runs for an unauthenticated caller.

- **FR:authorize.@function** (P1): Interface: `createAuth({ owners, tokens, onEvent? })` returns `{ authorize, wrap }`; `authorize` is the api `Authorize` hook
  - > - @req FR:api/auth.hook
- **FR:authorize.deny** (P1): Authorizer MUST deny a request with no session and no token as `401`
  - > - @req FR:api/auth.deny
- **FR:authorize.bearer** (P1): Authorizer MUST read a token from `Authorization: Bearer` or `X-Stack-Token`
  - **FR:authorize.bearer.invalid** (P1): Authorizer MUST answer `401` for a bad token and MUST NOT fall back to a session
- **FR:authorize.scope** (P1): Authorizer MUST allow a token only when its scopes cover the route
  - **FR:authorize.scope.table** (P1): Every route in the api route table MUST map to exactly one required scope; an unmapped or unknown route MUST deny a token with `403`
  - **FR:authorize.scope.deny** (P1): Authorizer MUST answer `403` when the token is valid but its scopes are too narrow
- **FR:authorize.session** (P1): Authorizer MUST give an owner session full access to every route
- **FR:authorize.fail** (P1): Authorizer MUST deny with `403` when the token store or parsing fails, with no detail in the response
- **FR:authorize.events** (P2): Authorizer MAY call `onEvent` with `{ kind, route, status, tokenId? }` and nothing else

### FR:admin: Token admin endpoints

Owner needs to manage tokens over HTTP so that the web app and scripts need no other tool.

- **FR:admin.@http** (P1): Interface: `GET /api/auth/tokens`, `POST /api/auth/tokens`, `POST /api/auth/tokens/{id}/revoke`, served by `auth.wrap(apiHandler)`
- **FR:admin.session** (P1): Wrapper MUST serve these endpoints to an owner session only; tokens MUST get `403` and unauthenticated callers `401`
- **FR:admin.create** (P1): Wrapper MUST answer a create with `201` and the one-time token in the body
- **FR:admin.shape** (P1): Wrapper MUST follow the api error model and JSON rules (JSON bodies only, 64 KiB cap, strict fields, `Cache-Control: no-store`)
- **FR:admin.rest** (P1): Wrapper MUST pass every other request to the api handler unchanged

### FR:safe: Safe output

Owner needs secrets and task content kept out of logs and responses so that a leak of either never exposes data.

- **FR:safe.hash** (P1): Token hashes MUST NOT appear in any response, event, or error
- **FR:safe.secret** (P1): Token secrets MUST appear only in the create response
- **FR:safe.tasks** (P1): Auth events and errors MUST NOT include task text, request bodies, or query strings

### FR:docs: Threat model and tests

Owner needs the risks written down and tested so that regressions are caught.

- **FR:docs.threat** (P1): `docs/security/threat-model.md` MUST cover assets, trust boundaries, threats with mitigations, and residual risk
- **FR:docs.routes** (P1): Security tests MUST fire an unauthenticated request at every route in the api route table and expect a denial
- **FR:docs.swa** (P2): `docs/security/staticwebapp.config.json` MUST show the SWA route rules that let `/api/*` reach the Function and block other providers
