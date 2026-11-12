---
id: inbox-page
title: Inbox Page
author: flanakin
description: "One Inbox page for all email (every inbox), unread Teams messages and unread Slack messages. Every item has an AI summary and one suggested action that runs in one click. The module never sends. Missing actions can be requested as a GitHub issue."
dependencies: [email-triage, email-inbox-zero, email-voice, ask-queue, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Inbox Page

## Purpose

Triage must be part of normal Stack work. One page lists all mail, unread Teams chats and unread Slack messages. Each item shows a summary and a suggested next action. Items that need the owner also become asks, so they rank in Needs you and Home.

## Hard rules

- The module never sends anything. No `Mail.Send`, no Teams post, no Slack post. A reply is a `createReply` draft that the owner sends.
- Message text is data. It is clipped and redacted before it reaches an ask.
- Teams and Slack are read only.

## Scenarios

### FR:item: Items

- **FR:item.shape** (P1): An `InboxItem` has `id`, `source` (`email`, `teams`, `slack`), `account`, `from`, `subject`, `receivedAt`, `unread`, `summary`, `suggested` (an action id), `actions` (action ids), and optional `link`, `draft`.
- **FR:item.email** (P1): Each triage result becomes one item, including quiet classes. `summary` falls back to the reason, then the preview. `suggested` follows the class: `needs_reply` is `reply-draft`, `needs_decision` and `sensitive` are `ask-me-later`, `newsletter` is `unsubscribe`, `calendar` is `schedule`, `receipt`, `fyi`, `skip` and `spam` are `mark-done`.
- **FR:item.order** (P1): Items sort by unread first, then urgency, then newest.
- **FR:item.ask** (P1): `needs_reply`, `needs_decision` and `sensitive` mail already becomes an ask (`FR:email-triage/ask.*`). An unread Teams or Slack item that is not from the owner becomes a `go-do` ask keyed `chat-<hash>`, with a clipped summary and a link. One ask per conversation.

### FR:action: Actions

- **FR:action.catalog** (P1): The catalog lists: `reply-draft`, `mark-done`, `snooze`, `ask-me-later`, `create-task` (ready), and `archive`, `unsubscribe`, `delegate`, `schedule`, `forward-draft` (missing). Each entry has `id`, `label`, `ready`.
- **FR:action.reply** (P1): `reply-draft` calls `MailProvider.createDraft` with the edited text and returns the Outlook link. It works for email only. Nothing is sent.
- **FR:action.done** (P1): `mark-done` resolves the item's ask. `snooze` and `ask-me-later` defer the ask (`until`, default next morning). `create-task` adds a Stack task from the subject.
- **FR:action.missing** (P1): A missing action returns `{ ok: false, missing: true }` and runs nothing.
- **FR:action.request** (P1): "Request this action" files an issue in `Xerilium/stack` with label `help wanted`, a title naming the action, and the item's source and class (no message text). If filing fails, a Stack task is added instead. The result says which one was used.

### FR:conn: Connectors

- **FR:conn.interface** (P1): `ChatConnector.unread()` returns unread chat messages. Teams and Slack implement it. Tests use fixtures; no network.
- **FR:conn.teams** (P1): Teams unread = chat with `lastMessagePreview.createdDateTime` after `viewpoint.lastMessageReadDateTime`, sender not the owner, not hidden, message type `message`. Needs delegated `Chat.Read` on a work or school account. Personal Microsoft accounts have no Teams chat API.
- **FR:conn.slack** (P1): Slack unread = conversation with a `last_read` and a newer message from another user (`conversations.history` with `oldest=last_read`). Needs a user token with `im:read`, `mpim:read`, `channels:read`, `groups:read` and the matching `*:history`.
- **FR:conn.guard** (P1): The Teams request allowlist permits only `GET /me/chats`. The Slack allowlist permits only `users.conversations`, `conversations.info`, `conversations.history`. Anything else throws.

### FR:run: Runner

- **FR:run.email** (P1): After each email pass, the runner turns the pass results into items (`fromTriage`) and merges them into `.stack/inbox-items.json`. Items replace by id. Items from other mailboxes stay, so every inbox shares one file. A dry run writes nothing.
- **FR:run.chat** (P1): `runInbox` reads each `ChatConnector`. It replaces all stored items of that source with the unread result, and writes one `go-do` ask per item (`FR:item.ask`). If one connector fails, its stored items stay and the others still run. The result lists failed sources by name only.
- **FR:run.store** (P1): The file keeps the newest 500 items in display order. A write conflict is retried up to 3 times.

### FR:live: Live transports

- **FR:live.teams** (P1): `teamsConnector` calls `GET /v1.0/me/chats?$expand=lastMessagePreview` with a bearer token from an injected function. It follows `@odata.nextLink` up to 5 pages. Every URL passes the guard first. Errors name the HTTP status only.
- **FR:live.slack** (P1): `slackConnector` calls `users.conversations`, then `conversations.info` (for `last_read`) and `conversations.history` (`oldest=last_read`) per conversation, up to 100 conversations. Every method passes the guard first. Errors name the Slack error code only. Never a token in an error.
- **FR:live.http** (P1): Both take an injected HTTP function. Tests use fixtures; no network. The default uses `fetch` and does not follow redirects.

### FR:wire: Host wiring

- **FR:wire.issue** (P1): The host passes an `IssueFiler` to the API. The default is `ghIssueFiler()` (the `gh` CLI). `HostDeps.issues` replaces it. "Request this action" then files a `help wanted` issue in `Xerilium/stack`, or adds a task if filing fails.

### FR:src: Source status

The page must never say "Inbox zero" when nothing is connected or nothing synced. Each inbox source reports its real state.

- **FR:src.shape** (P1): An `InboxSource` has `kind` (`email`, `teams`, `slack`, `github`), `account`, `state` (`not-connected`, `connecting`, `ok`, `error`, `stale`), and optional `lastSyncAt`, `error`, `needs`, `command`, `doc`, `mode` (`read-only`, `drafts`; email only) and `planned`.
- **FR:src.record** (P1): After each real (not dry run) email pass, `stack email run` writes one sync record `{ kind, account, at, ok, error?, mode? }` to `.stack/inbox-sources.json` in the data repo. `error` is a code only: `signin-expired`, `model-down`, `sync-failed`. Never a token, message text or raw error. A record replaces the older one for the same kind and account.
- **FR:src.probe** (P1): A local host also probes this machine. Email: every Graph token cache with `Mail.Read` or `Mail.ReadWrite` is one account. A mail cache that names no mailbox (a first-run sign-in) makes the email source `connecting`; its first `stack email run --account` names it. `Mail.ReadWrite` is `drafts` mode, else `read-only`. A cache that cannot be read is `error` (`token-unreadable`). GitHub: signed in when `GITHUB_TOKEN` is set or `gh auth status` succeeds. The probe reads no token value and makes no network call.
- **FR:src.state** (P1): Email state: a failed latest record is `error`; an ok record within the freshness window is `ok`, older is `stale`; signed in with no record is `connecting`; a configured account (`inbox.accounts`) with no sign-in and no record is `not-connected`. When no email account is known, one `email` row with an empty account is `not-connected`. GitHub: not signed in is `not-connected`; signed in with no record is `connecting`; records apply as for email.
- **FR:src.fresh** (P1): The freshness window is `inbox.freshMinutes` in `.xe/config/stack.json`, default 30.
- **FR:src.planned** (P1): Teams and Slack are listed as `not-connected` with `planned: true` until their connectors ship. GitHub shows its sign-in state but is `planned` until its runner writes a record. A planned source is never counted, never sets the dot, and never changes the headline.
- **FR:src.multi** (P1): Each email account is its own source with its own state. Sources sort email (by account), then GitHub, Teams, Slack.
- **FR:src.summary** (P1): The summary has `connected` (counted sources in `ok`, `stale` or `connecting`), `total` (counted sources), `fresh` (counted sources `ok`), `attention` (any counted source `not-connected` or `error`), `canClaimZero` (`fresh >= 1` and every counted source is `ok`; on `GET /inbox-items` also the item file read cleanly), and `headline`. Headline, first match wins: no counted source connected is "No inboxes connected"; one error is its message ("Email sign-in expired: a@x.com"); more errors is "N inboxes need attention"; no fresh source is "Last synced 3h ago" (newest sync) or "Waiting for the first sync"; some stale is "N of M inboxes up to date"; some still waiting is "N of M inboxes synced; waiting for the first sync"; some not connected is "N of M sources connected"; else none.
- **FR:src.help** (P1): Each non-`ok` source has `needs`, one plain sentence with the exact human step, and `command` when a terminal step exists. Email sign-in: `stack graph login --client-id <id> --account <addr> --with mail` (the client id from an existing sign-in, else `<app id>`); `needs` says read-only by default, `--with mail,drafts` for reply drafts, and "Stack never sends". An expired drafts account keeps `--with mail,drafts` (mode from the probe, else from its record; a record keeps the sign-in mode, not the pass `--mode`). An unreadable token file: `chmod 600` if it is readable by others, else the sign-in command. A usage error (`--max` typo) writes no record. Connecting: `stack email run --account <addr>`. Stale: `stack email run --all`. Model down: `claude`. GitHub: `gh auth login`. Teams and Slack: what token or app they need, and `doc` links to `docs/inbox-sources.md`.
- **FR:src.safe** (P1): No token, secret, token file content or message text appears in a source, a record, a log or the UI. An email account that is not a plain mailbox address (letters, digits, `._%+-`, one `@`, a dotted domain) is dropped, from records, the probe and the config, so no shell text reaches a copyable command. Other kinds use an empty account.

### FR:cli: CLI

- **FR:cli.sources** (P1): `stack inbox sources [--json]` prints each source (kind, account, state, last sync, needs, command) and the summary line `N of M sources connected`. `--json` prints `{ sources, summary }`. Exit 0 when nothing needs attention, else 4.

### FR:web: Page

- **FR:web.view** (P1): `#/inbox` lists items. Each row: source, sender, subject, summary, one primary button for the suggested action, a menu of other actions. Missing actions show "Request this action".
- **FR:web.draft** (P1): `reply-draft` opens an editable text area first. Confirming creates the draft and shows an "Open in Outlook" link. The page has no send button.
- **FR:web.phone** (P1): At 375 px width rows stack and nothing scrolls sideways. Every control is at least 44 px tall on a phone.
- **FR:web.empty** (P1): With no items, the page says "Inbox zero. Nothing needs you." only when `canClaimZero`. Otherwise the empty state is the headline ("No inboxes connected", "Last synced 3h ago", "Email sign-in expired: a@x.com") and points to the sources panel. An open page reads the items and summary again every minute, when the tab comes back, and on live changes.
- **FR:web.sources** (P1): A sources panel inside Inbox lists every source with its state and last sync, and a progress line `N of M sources connected`. Each source that is not `ok` has a Connect (or Fix) button that shows `needs`, the `command` with a Copy button, and the `doc` link. Email shows its mode. The panel says "Stack never sends." The panel is open when `attention` or `headline` is set, else collapsed to one line.
- **FR:web.check** (P1): "Check connection" re-reads `GET /inbox-sources?fresh=1`, then `GET /inbox-items`, and redraws the items, the panel and the dot together. It announces the new progress line to a screen reader.
- **FR:web.dot** (P1): The Inbox rail item, and on a phone the More tab, carry a dot when `attention` is true. The dot has an accessible name ("Inbox needs setup").

### FR:api: API

- **FR:api.read** (P1): `GET /inbox-items` returns `{ items, actions, sources, summary }`.
- **FR:api.sources** (P1): `GET /inbox-sources` returns `{ sources, summary }`. Owner only. A host without a local probe builds sources from the sync records and the config alone.
- **FR:api.act** (P1): `POST /inbox-items/{id}/action` takes `{ action, text?, until? }`. Owner only.

## Interfaces

`InboxStore { read(): Promise<InboxItem[]>; write(items): Promise<void> }`, `ChatConnector`, `IssueFiler { file(issue): Promise<{ url }> }`, `InboxSource`, `SyncRecord`, `SourcesSummary`, `SourceProbe { emails, github, clientId? }`.

## Dependencies

email-triage, email-inbox-zero, email-voice, ask-queue, web-shell.
