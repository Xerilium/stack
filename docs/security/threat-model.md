# Threat Model: Stack

One owner, one private task repo, hosted on Azure Static Web Apps (SWA) free tier. Feature spec: `.xe/features/auth-security/spec.md`.

## Assets

- Task content (the markdown in the private repo): confidentiality and integrity.
- API tokens: their secrets (shown once) and the stored hashes.
- Owner identity: the allow-list in `STACK_OWNERS`.
- Repo write access held by the Function (a GitHub credential in app settings).

## Trust boundaries

- Internet to SWA edge: SWA authenticates the browser (GitHub only) and adds `x-ms-client-principal`. SWA is the only thing allowed to set that header.
- SWA to managed Function: the Function trusts the principal header only because the Function is reachable through SWA alone. `/api/*` is anonymous at the SWA layer on purpose so token callers get in; the code does the real check.
- Script or agent to Function: presents a bearer token.
- Function to token store and task storage: server-side only.

## Threats

| # | Threat | Mitigation | Test |
| - | ------ | ---------- | ---- |
| 1 | Anonymous request reaches data | `authorize` runs first on every route; no hook means 401; unknown routes and verbs are denied before they are reported | `authorize.test.ts` (every route), api `auth.deny` |
| 2 | Any GitHub user signs in | Allow-list of `provider:userId`; empty list denies all; `userDetails` never matches | `session.test.ts` |
| 3 | Forged or malformed principal header | Strict parse (size, base64, JSON, types, `authenticated` role); never throws | `session.test.ts` |
| 4 | Header spoofing by calling the Function directly | Function is not exposed outside SWA (managed Functions). If ever self-hosted, put a verifying proxy in front. See residual risk | docs |
| 5 | Cross-site request with the owner's cookie (CSRF) | JSON-only bodies (415 otherwise, forces a preflight with no CORS headers), plus `Sec-Fetch-Site` and `Origin` checks on session writes | `authorize.test.ts` |
| 6 | Token theft from the store | Only SHA-256 (or HMAC with `STACK_TOKEN_PEPPER`) of a 256-bit random secret is stored; file is mode 0600 | `tokens.test.ts` |
| 7 | Token guessing | 256-bit secret; constant-time compare; unknown ids cost the same as wrong secrets | `tokens.test.ts` |
| 8 | Leaked token abuse | Scopes per route (fail-closed table), expiry (default 90 days, max 365), instant revoke, 50 active max | `authorize.test.ts` |
| 9 | Leaked token mints more tokens | Token admin is owner-session only | `admin.test.ts` |
| 10 | Secrets or tasks in logs or responses | Auth events carry only kind, route name, status, token id; error bodies are fixed text; list never returns hashes; secret appears once at create | `leaks.test.ts` |
| 11 | Two writers corrupt the token file | Version-checked atomic writes with retry | `tokens.test.ts` |
| 12 | Corrupt token file grants access | Unreadable file means no token verifies (401); creating refuses to overwrite it | `tokens.test.ts` |
| 13 | Other sign-in providers | SWA route rules return 404 for non-GitHub login (`docs/security/staticwebapp.config.json`) | `docs.test.ts` |

## Residual risk

- Single owner: a compromised GitHub account is a full compromise. Turn on GitHub 2FA.
- SWA can rewrite the `Authorization` header in some setups, so tokens are also accepted as `X-Stack-Token`.
- The token file needs a persistent home. The reference file adapter is for local or self-hosted use; the deploy feature must pick durable storage (for example a private repo file). Tokens lose nothing if that file is public: it holds only hashes, but publishing it still hands out expiry and scope metadata.
- No rate limiting. 256-bit secrets make guessing infeasible; add a host-level limit if abuse appears.
- Owner-session access is all-or-nothing (no per-route scopes for the owner).
- Task data lives in git history; revoking a token does not erase past reads.
