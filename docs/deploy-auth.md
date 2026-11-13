<!-- @req FR:deploy-stack-xerilium-com/auth.doc -->
# Auth on stack.xerilium.com

Default deny. Only the owner's browser session or one of the owner's tokens gets data. Detail: [threat model](security/threat-model.md).

## What exists

- **Browser:** SWA GitHub sign-in. Other providers answer 404. `STACK_OWNERS` (SWA per-app user id) is the allow-list; empty denies all. Session writes need a same-origin `Origin` or `Sec-Fetch-Site` (CSRF).
- **Scripts and agents:** `Authorization: Bearer stk_…` (or `X-Stack-Token`). 256-bit secret, hashed with the pepper, scoped per route, 90-day default, 365 max, 50 active, instant revoke. Only an owner session can mint tokens.
- **Phone:** device pairing. The owner mints a device token (3 scopes, 90 days, 10 devices max); the phone gets it in the URL fragment, never sent to a server. Revoke kills token and push.
- **Edge:** `/*` needs sign-in. `/api/*` is anonymous at SWA on purpose, so tokens and signed bots get in; the Function checks every route first. `/api/health` has no data. `Cache-Control: no-store` on `/api`. CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff.

## Not covered

- Passkeys: not built. The phone uses a device token, not a passkey.
- Multi-user and roles: one owner only. A lost GitHub account is a full loss: keep 2FA on.
- The repo token can write every branch of `flanakin/todo`. Only `STACK_REPO_BRANCH=stack/live` keeps writes off `main`; GitHub cannot limit a fine-grained token to one branch.

## Gaps for a public domain

| Gap | Status |
| --- | --- |
| No HSTS, no Permissions-Policy, no COOP | Fixed: `Strict-Transport-Security` 1 year, camera, mic, geo off, COOP `same-origin` |
| Lock `/api/*` to signed-in users | Rejected: breaks tokens, bots, health. Function default deny covers it |
| `*.azurestaticapps.net` stays live next to the custom domain | Accepted: same auth. Free plan cannot turn it off |
| No rate limit | Accepted: 256-bit tokens, no-credential calls never open storage. Add if abuse shows (Front Door is paid) |
| Token expiry | Exists: 90 days default, 365 max; device 90 days |
| Writes to `main` | Fixed: setup defaults to `stack/live` |
