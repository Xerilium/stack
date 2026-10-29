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

- In: device code start and poll, scope sets, token cache file, access-token provider with refresh, CLI `stack graph`, `stack web` live calendar wiring.
- Out: the app registration itself (owner, one time: a public client with "Allow public client flows" on), the mail runner (`FR:email-triage/*`, scheduled separately), the Azure host (it has no owner terminal; it keeps fixtures off and no calendar), confidential clients and secrets.

## Scenarios

### FR:scope: Scopes

- **FR:scope.sets** (P1): `scopesFor(features)` maps `calendar` to `Calendars.Read`, `mail` to `Mail.Read`, and `drafts` to `Mail.ReadWrite`, always adds `offline_access`, and removes duplicates. Unknown features throw
- **FR:scope.never** (P1): `assertSafeScopes(scopes)` throws for any scope that can send or write beyond drafts: `Mail.Send`, `Mail.Send.Shared`, `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `.default`, or any scope with `All` or `Shared` in it. Every request to the login host checks its scopes with it first

### FR:flow: Device code flow

- **FR:flow.start** (P1): `startDeviceCode({tenant, clientId, scopes, fetch})` posts form data to `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/devicecode` and returns `{deviceCode, userCode, verificationUri, expiresIn, interval, message}`. `tenant` is `organizations`, `consumers`, `common`, or a GUID or domain; `clientId` is a GUID. Anything else is refused before a request
- **FR:flow.poll** (P1): `pollDeviceCode(...)` posts the device code grant to the token endpoint every `interval` seconds (`sleep` injectable), adds 5 seconds on `slow_down`, keeps waiting on `authorization_pending`, and stops with a typed error on `expired_token`, `access_denied`, `authorization_declined`, `bad_verification_code`, or when `expiresIn` has passed. Success returns `{accessToken, refreshToken, expiresAt, scopes}`; a response without a refresh token is an error (`offline_access` was not granted)
- **FR:flow.host** (P1): Sign-in requests go only to `https://login.microsoftonline.com`; error results carry the OAuth `error` code only, never the response body or a token

### FR:cache: Token cache

- **FR:cache.file** (P1): `FileTokenCache(path)` keeps `{version: 1, tenant, clientId, scopes, refreshToken, accessToken?, expiresAt?, account?}` as JSON. The default path is `~/.config/stack/graph-token.json`. The file is written with mode `0600` (atomically: temp file then rename), and reading a file that is readable by group or others is refused until it is fixed. A path inside a Stack task repo (a directory that has `tasks/`) is refused, so a token can never be committed
- **FR:cache.provider** (P1): `graphToken(cache, {fetch, now})` returns a token function for `graphTransport`: it returns the cached access token while it has more than 5 minutes left, else redeems the refresh token (`grant_type=refresh_token`, same scopes, scopes checked by `FR:scope.never`), saves the new access token and rotated refresh token, and returns it. Concurrent calls share one refresh. `invalid_grant` or a missing cache throws `GraphSignInRequired`

### FR:cli: CLI

- **FR:cli.login** (P1): `stack graph login --client-id <guid> [--tenant t] [--with calendar,mail,drafts] [--cache path]` (default `--with calendar`, tenant `organizations`) prints the sign-in message (URL and code), polls, and saves the cache. It prints the granted scopes and the cache path, never a token
- **FR:cli.status** (P1): `stack graph status` prints `signed in` with tenant, scopes, and access-token expiry, or `not signed in`; exit code 0 or 4 (none). `--json` gives the same fields. No token is printed
- **FR:cli.logout** (P1): `stack graph logout` deletes the cache file; it is not an error when there is none

### FR:web: Live calendar

- **FR:web.calendar** (P1): `stack web` uses the Graph calendar adapter with `graphToken` when the cache exists and its scopes include `Calendars.Read`, unless `STACK_CALENDAR_FIXTURE` is set (fixture wins). It logs one line naming the source (`calendar: Graph` or `calendar: fixture`), never a token. A sign-in failure surfaces through `GET /calendar` as `Calendar unavailable`

## Dependencies

- day-inputs (`graphTransport`, `createGraphCalendar`), email-triage (no-send rule), cli (command table)
