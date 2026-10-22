---
id: auth-security
title: Auth and Security Plan
---

# Plan: Auth and Security

## Approach

`src/api/auth/` is a library beside the api handler; it plugs in only through the existing `authorize` hook and one wrapper for the token admin endpoints. No CLI dependency, no new runtime packages (Node `crypto` only).

## Contracts

- `parseClientPrincipal`, `parseOwners`, `isOwner` (`session.ts`)
- `createTokenService`, `FileTokenStore`, `MemoryTokenStore`, `SCOPES` (`tokens.ts`)
- `createAuth({ owners, tokens, onEvent })` returning `{ authorize, wrap }`, plus `routeScope(name)` (`authorize.ts`)

## Decisions

- Owner match uses `provider:userId`, never `userDetails` (mutable)
- Tokens are `stk_<id>.<secret>`; the id is a lookup key so only one hash is compared; unknown ids compare against a dummy hash
- SHA-256 is enough for 256-bit random secrets (no slow KDF needed); optional HMAC pepper from `STACK_TOKEN_PEPPER`
- Token file is a pluggable store (`read`/`write` with version); the file adapter is the reference; the deploy feature picks the persistent location
- Token admin is owner-session only so a leaked token cannot mint tokens
- Bearer also accepted as `X-Stack-Token` because SWA may rewrite `Authorization`
- Route-to-scope map is fail-closed and tested against `ROUTES`
- Origin check blocks cross-site session writes; API already requires JSON, so no simple-form CSRF

## Tests

`tests/security/*.test.ts`: session parsing, token lifecycle, hook behavior, every-route denial, scope matrix, leak checks.
