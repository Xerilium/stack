---
id: graph-signin
title: Graph Sign-in (Device Code)
author: flanakin
description: "One-time owner sign-in to Microsoft Graph with the device code flow; least-privilege read scopes; a token cache outside the task repo; refresh on demand; `stack graph login|status|logout`; `stack web` reads the live calendar when signed in."
dependencies: [day-inputs, email-triage, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: Graph Sign-in

## Purpose

The calendar and mail adapters (`FR:day-inputs/*`) need a Graph token. The owner signs in once from the terminal, without a browser redirect or a client secret, and Stack keeps a refresh token on his machine so Today shows his real meetings. Nothing here can send mail or write a calendar.

## Scope

- In: device code start and poll, authorization code with PKCE (for in-app Connect, `FR:connect-accounts/*`), scope sets, token cache file, access-token provider with refresh, CLI `stack graph`, `stack web` live calendar wiring.
- Note: `Mail.ReadWrite` (drafts) is not read-only; Graph has no drafts-only scope. What limits mail writes to reply drafts is the email guard (`FR:email-triage/safe.allowlist`), not the scope.
- Out: the app registration itself (owner, one time: a public client with "Allow public client flows" on), the mail runner (`FR:email-triage/*`, scheduled separately), the Azure host (it has no owner terminal; it keeps fixtures off and no calendar), confidential clients and secrets.

## Scenarios

### FR:scope: Scopes

- **FR:scope.sets** (P1): `scopesFor(features)` maps `calendar` to `Calendars.Read`, `mail` to `Mail.Read`, and `drafts` to `Mail.ReadWrite`, always adds `offline_access`, and removes duplicates. Unknown features throw
- **FR:scope.never** (P1): `assertSafeScopes(scopes)` is an allowlist, case-insensitive, Graph resource only: `Calendars.Read`, `Mail.Read`, `Mail.ReadWrite`, `offline_access`, `openid`, `profile`, `email`, `User.Read`. Anything else (send, `MailboxSettings.*`, `.default`, `*.All`, `*.Shared`, other resources) throws `unsafe_scope`, naming the refused scopes and the fix (remove them from the app registration and revoke the consent already granted, since removing a permission does not revoke consent). It checks the requested scopes before every login request and the granted scopes in every token response (Microsoft grants all scopes already consented for the app), so a token with an unsafe scope is never saved

### FR:flow: Device code flow

- **FR:flow.start** (P1): `startDeviceCode({tenant, clientId, scopes, fetch})` posts form data to `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/devicecode` and returns `{deviceCode, userCode, verificationUri, expiresIn, interval, message}`. `tenant` is `organizations`, `consumers`, `common`, or a GUID or domain; `clientId` is a GUID. Anything else is refused before a request
- **FR:flow.poll** (P1): `pollDeviceCode(...)` posts the device code grant to the token endpoint every `interval` seconds (`sleep` injectable), adds 5 seconds on `slow_down`, keeps waiting on `authorization_pending`, and stops with a typed error on `expired_token`, `access_denied`, `authorization_declined`, `bad_verification_code`, or when `expiresIn` has passed. Success returns `{accessToken, refreshToken, expiresAt, scopes}`; a response without a refresh token is an error (`offline_access` was not granted)
- **FR:flow.pkce** (P1): `pkcePair()` makes a random verifier (43+ characters) and its `S256` challenge. `authorizeUrl({tenant, clientId, scopes, redirectUri, challenge, state, loginHint?})` builds the `/authorize` URL (`response_type=code`, `response_mode=query`, `prompt=select_account`). `redeemAuthCode({tenant, clientId, code, verifier, redirectUri})` posts the `authorization_code` grant with the verifier and returns the same result as `FR:flow.poll`. The redirect URI must be `http://localhost:<port>` or `http://127.0.0.1:<port>`; scopes are checked by `FR:scope.never`
- **FR:flow.idtoken** (P1): A token response with `id_token` keeps it as `idToken` (never saved). `idClaims(idToken)` reads `preferred_username`, `email` and `tid` from its payload without a network call; a bad token gives no claims
- **FR:flow.host** (P1): Sign-in requests go only to `https://login.microsoftonline.com`; error results carry the OAuth `error` code only, never the response body or a token

### FR:cache: Token cache

- **FR:cache.file** (P1): `FileTokenCache(path)` keeps `{version: 1, tenant, clientId, scopes, refreshToken, accessToken?, expiresAt?, account?}` as JSON. The default path is `~/.config/stack/graph-token.json`. The file is written with mode `0600` (atomically: temp file then rename), and reading a file that is readable by group or others is refused until it is fixed. A path inside a Stack task repo (a directory that has `tasks/`) is refused, so a token can never be committed
- **FR:cache.accounts** (P1): Each mailbox has its own cache file beside the default one: `accountCachePath(addr)` is `graph-token-<address, lower case>.json` in the same folder (beside `STACK_GRAPH_CACHE` when it is set) (an address with a path character is refused). `listCachePaths()` returns the default file and every `graph-token-*.json` that exists, so one command can serve every signed-in inbox. `tenantFor(addr)` is `consumers` for personal Microsoft domains (outlook.com, hotmail.com, live.com, msn.com) and `organizations` otherwise
- **FR:cache.provider** (P1): `graphToken(cache, {fetch, now})` returns a token function for `graphTransport`: it returns the cached access token while it has more than 5 minutes left, else redeems the refresh token (`grant_type=refresh_token`, same scopes, scopes checked by `FR:scope.never`), saves the new access token and the rotated refresh token (keeping the old one when none comes back), and returns it. Before it saves, it reads the cache again: a cache removed during the request throws `GraphSignInRequired` and is not written back; a cache whose refresh token, scopes or account changed (a drafts change, another refresh) is refreshed again from the new record (once; then `cache_changed`). Concurrent calls share one refresh. `force` refreshes even a fresh-looking token (after any normal call in flight, so it never returns the revoked token); `graphTransport` asks for it once after a 401. `invalid_grant`, `interaction_required`, or a missing cache throws `GraphSignInRequired`; other errors keep their OAuth code. Writes use a unique temp file (`wx`) that is removed on failure

### FR:cli: CLI

- **FR:cli.login** (P1): `stack graph login --client-id <guid> [--tenant t] [--account addr] [--with calendar,mail,drafts] [--cache path]` (default `--with calendar`, tenant `organizations`) prints the sign-in message (URL and code; on stderr with `--json`), polls, and saves the cache. It prints the granted scopes and the cache path, never a token
- **FR:cli.login.account** (P1): `--account addr` signs in one more inbox: the cache is `accountCachePath(addr)` (unless `--cache` is given), the default tenant is `tenantFor(addr)` (so a personal Outlook.com mailbox uses `consumers`), and the address is saved in the cache as `account`. `status` and `logout` accept the same flag. The app registration must allow personal accounts and work accounts
- **FR:cli.login.nosend** (P1): No `--with` value ever requests a send scope; a cache that names one is refused by `FR:scope.never`
- **FR:cli.status** (P1): `stack graph status` prints `signed in` with tenant, scopes, and access-token expiry, or `not signed in`; exit code 0 or 4 (none). `--json` gives the same fields. No token is printed
- **FR:cli.logout** (P1): `stack graph logout` deletes the cache file; it is not an error when there is none

### FR:web: Live calendar

- **FR:web.calendar** (P1): `stack web` uses the accounts calendar (`FR:connect-accounts/cal.live`) over every token cache with `Calendars.Read` (any case, with or without the Graph prefix), with the ICS feeds as its fallback, unless `STACK_CALENDAR_FIXTURE` is set (fixture wins). It logs one line naming the source at start (`calendar: Graph`, `calendar: ICS feeds`, `calendar: fixture` or `calendar: none yet`), never a token. A sign-in failure surfaces through `GET /calendar` as `Calendar unavailable`

## Dependencies

- day-inputs (`graphTransport`, `createGraphCalendar`), email-triage (no-send rule), cli (command table)
