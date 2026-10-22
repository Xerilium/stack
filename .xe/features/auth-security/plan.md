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
- Session writes need `Sec-Fetch-Site` of `same-origin`/`none` (when sent) and a matching `Origin` (when sent); at least one of the two MUST be present. Browsers always send `Origin` on non-GET, so SWA same-origin use is unaffected; header-less clients (curl) must use a token. Decision recorded after review.
- `X-Forwarded-Host` is still accepted as an alternate host for the `Origin` match (SWA fronts the Function, so `Host` can differ). A browser attacker cannot set it cross-site (custom header forces a failing preflight); a direct caller can, but has no owner cookie. Residual risk in threat model.
- File store: per-path in-process queue + `<file>.lock` (O_EXCL, 10s stale takeover) around check+rename
- Stored records are validated on load; invalid ones never verify; bad `expiresAt` = expired

## Tests

`tests/security/*.test.ts`: session parsing, token lifecycle, hook behavior, every-route denial, scope matrix, leak checks.
