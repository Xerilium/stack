---
id: connect-accounts
title: Connect Accounts (Outlook and Microsoft 365)
author: flanakin
description: "In-app Connect for Outlook.com and Microsoft 365: browser sign-in, read-only by default, one live calendar, honest errors."
dependencies:
  [
    graph-signin,
    inbox-page,
    day-inputs,
    now-screen,
    ux-consolidation,
    desktop-shell,
    settings,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Connect Accounts

## Purpose

The owner uses Outlook.com, 2 Microsoft 365 accounts and 4 more personal accounts. Connect must not hand him a terminal command or ask for a published calendar link. He clicks Connect, picks the account in the Microsoft sign-in page, and Stack does the rest. The calendar is live.

## Architecture Constraints

- Stack never sends. No `Mail.Send` and no calendar write, in any flow (`FR:graph-signin/scope.never`).
- Tokens live only in the `0600` token cache (`FR:graph-signin/cache.file`). No token, code, verifier or id token is logged, returned by the API, or shown in the page.
- Stack never takes a password or an Azure credential. The owner signs in on Microsoft pages only.
- Error handling never changes token storage: a Graph outage leaves the cache as it is.
- The only human steps: sign in to Azure once (`Connect-AzAccount`) for the one-time app registration, and the Microsoft consent click for each account.

## Scenarios

### FR:setup: One-time setup

The owner needs a one-time app registration that Stack runs for him, so no portal steps or copied ids are needed.

- **FR:setup.client** (P1): `readClientId()` returns the Stack app id, in this order: `STACK_GRAPH_CLIENT_ID`, then `graph.clientId` in `~/.config/stack/config.json`, then the client id of an existing token cache. A value that is not a GUID is ignored.
- **FR:setup.script** (P1): `scripts/register-stack-app.ps1` uses Az PowerShell only. It needs a working Azure sign-in (`Get-AzContext` and a Graph token from `Get-AzAccessToken`); without one it prints one line and exits with code 3. Without the Az modules it exits with code 4. It finds the app by the client id already in the config, else by the name `Stack (Xerilium)`, else creates it: sign-in audience `AzureADandPersonalMicrosoftAccount`, access token version 2, public client (`isFallbackPublicClient`), redirect URI `http://localhost`, delegated Graph permissions `Mail.Read`, `Calendars.Read`, `Mail.ReadWrite` (requested only when drafts are on), `offline_access`, `openid`, `profile`. It never adds `Mail.Send` or any application permission, and never creates a secret. It merges `graph.clientId` into `~/.config/stack/config.json` (keeps other keys, mode 0600) and prints the client id only. It never takes a credential. Run again, it changes nothing that is already right.
- **FR:setup.run** (P1): `runSetup()` runs the script with `pwsh -NoProfile -NonInteractive -File <script>` (fixed args, no shell, 3 minute cap). The desktop app bundles the script. Exit 0 and a readable client id is `done`. Exit 3 is `needs-azure-signin`. No `pwsh`, or exit 4 (no Az modules), is `needs-pwsh`. Anything else is `failed`. The result is a state code only; script output is never returned or logged.
- **FR:setup.doc** (P1): `docs/connect-accounts.md` names the single one-time human step (`Connect-AzAccount`, then Run setup) and what the app registration allows.

### FR:flow: Sign-in

The owner needs one click to sign in each Microsoft account in the browser, so he never types a command or a password into Stack.

- **FR:flow.browser** (P1): `start()` uses the authorization code flow with PKCE (`S256`) on the `common` authority. It opens a loopback listener on `127.0.0.1` on a free port (and on `::1` on the same port when the host has IPv6), builds the redirect URI `http://localhost:<port>`, and opens the Microsoft sign-in page in the system browser (desktop: `shell.openExternal`; `stack web`: the OS opener, fixed args, no shell). A `login_hint` is sent when the account is known. The page gets the sign-in URL too, as an "Open the sign-in page" link.
- **FR:flow.callback** (P1): The listener answers only `GET /` with the matching `state`. An `error` parameter ends the session with that OAuth code. A good code is redeemed once (`FR:graph-signin/flow.pkce`); the listener then stops taking connections, and the reply in progress still reaches the browser. The browser tab says "Stack is connected. You can close this tab." The listener closes after 10 minutes with no answer (`expired_token`).
- **FR:flow.device** (P1): When the listener or the browser cannot open, or the owner asks for it ("Use a code instead"), `start()` uses the device code flow on the `common` authority. The page shows the code with a Copy button and an "Open microsoft.com/devicelogin" link, and polls the session. The server polls Microsoft in the background (`FR:graph-signin/flow.poll`).
- **FR:flow.account** (P1): The account is `preferred_username` (else `email`) from the id token in the token response (`FR:graph-signin/flow.idtoken`). It must be a plain mailbox address, else the session fails with `no_account`. When the sign-in was for a named account (drafts, sign in again) and Microsoft names another, the session fails with `account_mismatch` and nothing is saved. The tenant saved is `consumers` for a personal account (tenant id `9188040d-6c67-4c5b-b112-36a304b66dad`), else the account's tenant id.
- **FR:flow.save** (P1): A finished sign-in writes `accountCachePath(account)` with the granted scopes (minus `Mail.ReadWrite`, plus `Mail.Read`, when this sign-in did not ask for drafts: Microsoft returns every scope consented before), refresh token, access token and expiry, and clears any expired mark for that account. A second sign-in for the same account replaces its cache.
- **FR:flow.session** (P1): A session is `{id, method, state, url?, userCode?, verificationUri?, expiresAt?, account?, error?}`. `state` is `waiting`, `done` or `error`. `error` is an OAuth code only. Sessions are kept in memory for 30 minutes. `account` is the hinted account while waiting and the signed-in account when done. One sign-in waits at a time: a new start closes a waiting browser listener or stops a waiting device poll, and ends that session with `replaced`. A poll that gets 404 (the host restarted) ends the session in the page.

### FR:scope: Scopes

The owner needs Stack to ask for the least access, so it reads by default and writes drafts only where he turns them on.

- **FR:scope.default** (P1): Connect asks for `Mail.Read`, `Calendars.Read`, `offline_access`, `openid` and `profile`.
- **FR:scope.drafts** (P1): Reply drafts are opt-in per account. Turning drafts on starts a sign-in for that account that also asks for `Mail.ReadWrite`. Turning drafts off removes `Mail.ReadWrite` from that account's cache scopes and drops the access token, so the next refresh asks for read scopes only. The page says: "Drafts lets Stack save reply drafts in your mailbox. Stack never sends."

### FR:acct: Accounts

The owner needs to see each connected account and its health, so he can fix, change or remove one in a click.

- **FR:acct.list** (P1): `accounts()` lists every token cache: `{account, type: personal|work, mail, calendar, drafts, state, lastOkAt?, retryAt?}`. `state` is `connected`, `expired` (needs sign-in), `down` (Microsoft not responding) or `error` (unreadable cache or another failure). `lastOkAt` is the ISO time of the last good live read; `retryAt` is the ISO time of the next automatic try. A cache with no account name is listed with an empty account.
- **FR:acct.health** (P1): Each live read classifies its failure (`classifyGraphError`):
  - `signin`: `GraphSignInRequired`, a token refresh with `invalid_grant` or `interaction_required`, or Graph 401 or 403. Marks the account `expired`.
  - `down`: Graph 5xx, the 8 s timeout, a network failure, or a token endpoint 5xx (`server_error`, `temporarily_unavailable`). Marks the account `down`.
  - `throttled`: Graph 429. Keeps the current mark.
  - `other`: anything else. Marks the account `error`.
  - A good read clears the mark and sets `lastOkAt`. The marks are in memory, shared by the calendar, the accounts list and the inbox probe.
- **FR:acct.retry** (P1): After a failure, the account is not read again before its retry time: 30 s after the first failure in a row, 2 min after the second, then 10 min. Until then the calendar serves the last copy for that account. A 429 waits for `Retry-After` (seconds) when it is given, else 30 s, and does not count as a failure in a row. A good read, a sign-in or a disconnect resets the count.
- **FR:acct.diag** (P1): Every Graph call sends a fresh `client-request-id` (with `return-client-request-id: true`). Each failed call appends one JSON line to `~/.stack/graph.log` (mode 0600, rolled to `.1` past 1 MB): `{at, account, method, path, status, code, requestId, ms}`. `path` has no query. No token, query value or response body is written.
- **FR:acct.timeout** (P1): Every Graph and token request for an account read has a hard 8 s cap. A request over the cap is aborted and counts as `down`.
- **FR:acct.remove** (P1): Disconnect deletes the cache file that holds that account: its own file, or an older default `graph-token.json` that names it (an empty account removes a default file that names no one). A new sign-in for an account that the default file names replaces that file, so the account is listed once.
- **FR:acct.sources** (P1): Each connected mail account is an inbox source (`FR:inbox-page/src.probe`). An `expired` account is an email source in `error` with `signin-expired`. A connected account's calendar feeds the Now calendar source.

### FR:cal: Live calendar

The owner needs one live calendar over all his accounts, so Now and My day show every meeting without a published link.

- **FR:cal.live** (P1): `createAccountsCalendar()` reads `calendarView` (`FR:day-inputs/cal.graph`) for every cache with `Calendars.Read` (plus an explicit `STACK_GRAPH_CACHE` file with any name), one provider per cache file, at each read, so an account connected after start shows at once. It merges the events by start and drops a copy of the same meeting (same subject, start and end) seen in two calendars.
- **FR:cal.account** (P1): Each merged event carries `account`, the address of the calendar it came from (the first one, for a meeting on two calendars).
- **FR:cal.isolate** (P1): The accounts are read in parallel. A failing or slow account never blocks or empties the others: its last copy is served (or nothing), and the read still returns the other accounts' events.
- **FR:cal.ttl** (P1): Each account's events for a range are kept for 3 minutes, then read again. A failed read serves the last copy for that account and sets `partial`. An account waiting for its retry time (`FR:acct.retry`) is not called. Delta queries are not used: the window changes with every day and the 3 minute copy keeps Graph calls low.
- **FR:cal.fallback** (P1): With no calendar account, the ICS feeds (`FR:schedule/ics.wire`) are used. With neither, `events()` throws `CalendarNotConnected` and `GET /calendar` says `not-connected`.
- **FR:cal.info** (P1): `info()` is `{via: 'graph', account: the accounts, syncedAt: the oldest copy, partial, reason?}`, or the fallback's info. `reason` is set when `partial`: `signin` when any failing account needs sign-in, else `down` when any is not responding, else `error`. `GET /calendar` copies `reason` into `source.reason` (`FR:ux-consolidation/cal.status`).
- **FR:cal.page** (P1): An open page reads the calendar again every 5 minutes (was 15).

### FR:api: API

The page needs owner-only routes for Connect, so no token or code ever leaves the host.

All routes are owner only (403 for tokens) and 404 on a host with no connect service (the Azure host).

- **FR:api.get** (P1): `GET /connect` returns `{setup: {clientId: boolean}, accounts}`.
- **FR:api.setup** (P1): `POST /connect/setup` runs `FR:setup.run` and returns `{state}`.
- **FR:api.start** (P1): `POST /connect/sign-in` with `{account?, drafts?, method?: 'browser'|'device'}` returns the session (201). No client id is 409 `setup needed`.
- **FR:api.poll** (P1): `GET /connect/sign-in/{id}` returns the session; unknown is 404.
- **FR:api.drafts** (P1): `POST /connect/drafts` with `{account, on}`: on returns a session; off returns `{ok: true}`.
- **FR:api.remove** (P1): `POST /connect/remove` with `{account}` returns `{ok: true}`.

### FR:web: Page

The owner needs every account and its state on one screen in Settings, so he sees what works and fixes what does not in one click.

- **FR:web.where** (P1): Accounts are managed in Settings > Accounts (`FR:settings/view.sections`); the first-run email step (`FR:first-run-onboarding`) shows the same list. Now and Inbox never embed the list; they link to `#/settings/accounts`.
- **FR:web.panel** (P1): One compact list, one row per account, sorted by address. `Add account` is a button at the top of the list. No paragraph per row.
- **FR:web.row** (P1): A row shows, on one line: the kind icon (`Work` briefcase or `Personal` person, with that word as its accessible name), the address, and a status dot plus one short word:
  - `connected`: green dot, `Connected`.
  - `expired`: orange dot, `Needs sign-in`.
  - `down`: yellow dot, `Microsoft not responding`.
  - `error`: red dot, `Not working`.
  - The status has a tooltip (`title`) with the last good read (`Last synced 9:41 AM`, or `Never synced`) and, for `down`, `Retrying in 2 min`.
- **FR:web.fix** (P1): An `expired` or `error` row has one `Fix` button that starts a sign-in for that account (drafts kept on when on). A `down` row has no `Fix`: Stack retries on its own.
- **FR:web.menu** (P1): Each row has one `More` menu button (`aria-haspopup="menu"`, label `More for <address>`) with: the setting `Let Stack save reply drafts in my mailbox` as a `menuitemcheckbox` with its state word (`On` or `Off`) and the hint `Stack writes drafts for you to review. It never sends.`; `Sign in again`; `Disconnect`. Escape closes the menu and returns focus to its button. Disconnect asks to confirm first (`FR:task-detail-design/rules` rule 9).
- **FR:web.learn** (P1): The section summary is `Stack reads mail and calendar. It never sends.` with a `Learn more` button that opens a popover: what Stack reads, what reply drafts do, and that Stack never sends.
- **FR:web.manual** (P1): One opt-in link under the list, `Other ways to connect`, expands: the one-time setup when it is needed (`FR:web.setup`), and the published calendar link field (`FR:ux-consolidation/cal.connect`). It is closed by default, and open by default only when setup is needed.
- **FR:web.fit** (P1): At 1280x800, 6 accounts, `Add account` and `Other ways to connect` are visible in Settings without scrolling.
- **FR:web.setup** (P1): Until a client id exists, the list area shows one "One-time setup" step with a "Run setup" button. `needs-azure-signin` says: "Sign in to Azure once: open PowerShell, run Connect-AzAccount, then click Run setup again." `needs-pwsh` says to install PowerShell. No other step and no copy box.
- **FR:web.signin** (P1): Add account starts a browser sign-in and shows "Finish signing in in your browser" with the link. A device code session shows the code, a Copy button and the link. The list polls the session every 2 seconds and redraws when it is done.
- **FR:web.nocmd** (P1): No email sign-in step shows a terminal command.
- **FR:web.now** (P1): Now shows at most one quiet line about the calendar, as a link to `#/settings/accounts`:
  - not connected: `Calendar not connected`.
  - `source.reason` is `down`: `Calendar: Microsoft not responding`.
  - `source.reason` is `signin`: `Calendar needs sign-in`.
  - any other error: `Calendar unavailable`.
  - stale: `Calendar last synced 2 h ago`.
  - fresh, or still loading: nothing.
- **FR:web.label** (P1): When the day's events come from more than one account, each meeting in Now and My day shows a small badge with the account's first letter in a color fixed per account; the badge's accessible name and tooltip are the address.

## Data Model

- **Token cache** (one file per account, mode 0600): `{version, tenant, clientId, scopes, refreshToken, accessToken?, expiresAt?, account?}`.
- **Connect session** (in memory, 30 minutes): see the sign-in scenario.
- **Account row**: `{account, type, mail, calendar, drafts, state, lastOkAt?, retryAt?}`.
- **Health** (in memory, per account): mark (`expired`, `down` or `error`), failures in a row, retry time, last good read.

## External Dependencies

- Microsoft identity platform (`login.microsoftonline.com`, `common` authority) and Microsoft Graph (`calendarView`, mail reads, `createReply` drafts).
- Az PowerShell (`Az.Accounts`, `Az.Resources`) for the one-time setup only.

## Dependencies

- graph-signin (token cache, scopes, flows), inbox-page (sources), day-inputs (calendar adapter), schedule (ICS), desktop-shell (`shell.openExternal`)
