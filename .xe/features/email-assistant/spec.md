---
id: email-assistant
title: Email Assistant
author: flanakin
description: "Runs triage on every inbox (Outlook, Gmail, IMAP) every 15 minutes with no manual runs; drafts only; decisions only; metered"
dependencies: [email-triage, email-runner, email-voice, email-inbox-zero, graph-signin, ask-queue, agent-sessions]
---

<!-- markdownlint-disable single-title -->

# Feature: Email Assistant

## Purpose

The email modules (`email-triage`, `email-voice`, `email-inbox-zero`, `email-runner`) triage one Microsoft mailbox per command. This feature makes them one autonomous assistant. It runs on a schedule for every inbox the owner has, work and personal. It gives the owner only decisions, as asks. It shows what each inbox uses in tokens and list-price dollars. It never sends mail.

Plan, research, and cost model: `plan.md`. Source design: [todo PR 93](https://github.com/flanakin/todo/pull/93).

## Scope

- In: the schedule and all-inbox pass, self-recovery and stale detection, the provider contract, the Gmail provider, the IMAP provider, the decisions-only rules for asks, the usage meter and budget, the safety rules that apply to every provider.
- Out: sending mail in any form; deleting mail; any mailbox change without an answered ask (`email-inbox-zero` hard rules); browser or screen automation; a cloud runner (`plan.md` phase 4, only on a trigger); push subscriptions (Graph change notifications, Gmail Pub/Sub); a third model tier (Opus); learned sender rules; mailboxes in a tenant whose admin does not allow the app.

## Scenarios

### FR:auto: Run without the owner

Owner needs every inbox triaged all day without running a command, so that mail never waits for him to start a tool.

- **FR:auto.@cli** (P1): Interface: `stack email run --all`, `stack email status --all [--json]`, `stack email schedule --install | --uninstall | --print`
- **FR:auto.schedule** (P1): Email assistant MUST run one pass for every inbox every 15 minutes from one LaunchAgent, with no owner step after install
  - **FR:auto.schedule.install** (P1): `stack email schedule --install` MUST write the plist and load it with `launchctl bootstrap`; a second run MUST replace it and leave exactly one loaded job
  - **FR:auto.schedule.uninstall** (P2): `stack email schedule --uninstall` MUST unload and delete the plist; with no plist it MUST exit 0
- **FR:auto.nobrowser** (P1): Email assistant MUST NOT drive a browser or the screen in a pass; a test MUST fail when `src/email/` or its imports reach `playwright`, `puppeteer`, or a computer-use client
- **FR:auto.isolate** (P1): A pass MUST continue with the next inbox when one inbox fails
  > - @req FR:email-runner/cli.all
- **FR:auto.backlog** (P1): When one delta brings more than `--max` messages, the pass MUST queue the extra message ids in the inbox state, advance the cursor, and handle the queue oldest first in later passes; no rerun by the owner is needed
  - **FR:auto.backlog.ask** (P2): When the queue holds more than 1,000 ids, the pass MUST write one `answer` ask `mail-backlog-<inbox>`: "Look back how far for <inbox>?" with options `14 days` / `3 days` / `Only new mail`
- **FR:auto.signin** (P1): When a provider reports that sign-in is lost (Graph `invalid_grant` or `interaction_required`, Google `invalid_grant`, IMAP auth failure), the pass MUST write one `go-do` ask `mail-signin-<inbox>` with the exact login command, and MUST skip that inbox until sign-in works
  - **FR:auto.signin.clear** (P1): The first good pass of that inbox MUST handle the ask as `resolved`
- **FR:auto.modeldown** (P1): After 3 model failures in a row in one pass, the pass MUST stop model calls, keep those messages queued (not asked, not skipped), and write one `go-do` ask `mail-model-down` naming the error code
  - **FR:auto.modeldown.clear** (P1): The first pass with a good model call MUST handle `mail-model-down` as `resolved`
- **FR:auto.voice** (P2): The first `drafts` pass of an inbox with no voice profile MUST learn the profile from Sent items before it drafts
  > - @req FR:email-voice/learn.profile
- **FR:auto.heartbeat** (P1): Each pass MUST set `lastOk` for each inbox that passed in the status file, but only when the stored value is 4 hours old or older, or when the file changes for another reason, so idle passes make no commits
- **FR:auto.stale** (P1): The Stack host MUST list one Needs you item `mail-stale-<inbox>` when an inbox's `lastOk` is more than 12 hours old at read time: "Email assistant has not run for <inbox> since <time>"; recommendation "Wake the Mac, then run `stack email status --all`"
  - **FR:auto.stale.host** (P1): The Stack host MUST compute the item when it reads the status file, with no timer, so the hosted app shows it while the Mac sleeps

### FR:inbox: All inboxes

Owner needs every inbox he owns in one assistant, so that personal mail gets the same triage as work mail.

- **FR:inbox.list** (P1): `listInboxes()` MUST return one `$inbox` for each saved credential: Graph token caches with a mail scope, Gmail token caches, and IMAP configs
  > - @req FR:graph-signin/cache.accounts
- **FR:inbox.route** (P1): The login commands MUST pick the provider by address: Microsoft personal domains (`outlook.com`, `hotmail.com`, `live.com`, `msn.com`) and Microsoft 365 tenants use Graph; `gmail.com`, `googlemail.com`, and `--provider gmail` use Gmail; every other address uses IMAP unless `--provider` says otherwise
- **FR:inbox.id** (P1): An inbox id MUST be the first label of the address domain (`allyte.com` gives `allyte`), with the local part added on a clash (`michael-outlook`); `--id` overrides it
- **FR:inbox.project** (P1): Asks from an inbox MUST use the inbox `project` (default: the inbox id), never the address
- **FR:inbox.state** (P1): Each inbox MUST keep its own state, lock, voice, rules, queue, and usage; no value from one inbox may enter another inbox's prompt, state, or ask

### FR:provider: Provider contract

The mail runner needs one contract for every mail provider, so that triage, voice, inbox zero, and the meter work the same for each.

- **FR:provider.contract** (P1): Each provider MUST implement `MailProvider` (`delta`, `createDraft`) plus `details(id)`, `sentDelta(cursor)`, `move(id, folder)`, and `link(kind, id)`
  > - @req FR:email-triage/safe.allowlist
- **FR:provider.guard** (P1): Each provider MUST send every request through its own allowlist guard that throws before the network on any request not listed
- **FR:provider.cursor** (P1): When the provider says the cursor is no longer valid (Graph `410`, Gmail history `404`, IMAP `UIDVALIDITY` change), the provider MUST drop the cursor and bootstrap with the last 14 days; reprocessing MUST change nothing (idempotent)
- **FR:provider.throttle** (P2): On `429` or `5xx`, the provider MUST honor `Retry-After` up to 60 seconds, retry at most twice, then end that inbox's pass with the cursor unchanged
- **FR:provider.reply** (P1): A provider that builds reply headers itself (Gmail, IMAP) MUST take `To` from the original `Reply-To` or else `From`, `Subject` from the original with one `Re: `, and `In-Reply-To` and `References` from the original `Message-ID`; no model output may set a header

### FR:gmail: Gmail provider (phase 2)

Owner needs his Gmail inboxes triaged with the narrowest Google access, so that a bug cannot reach more than mail drafts and labels.

- **FR:gmail.auth** (P1): `stack gmail login --account <addr> [--with mail|drafts]` MUST use the OAuth installed-app flow with PKCE and a loopback redirect on `127.0.0.1` and a random port, with the Desktop client in `~/.config/stack/google-client.json`
- **FR:gmail.scopes** (P1): The requested scope MUST be `gmail.readonly` (observe) or `gmail.modify` (drafts); any other Google scope requested or granted (`gmail.send`, `gmail.compose`, `gmail.insert`, `gmail.settings.*`, `https://mail.google.com/`) MUST throw `unsafe_scope`, and the token MUST NOT be saved
- **FR:gmail.cache** (P1): The token cache MUST be `gmail-token-<address>.json` beside the Graph caches, with the same file rules
  > - @req FR:graph-signin/cache.file
- **FR:gmail.delta** (P1): `delta` MUST read `users.history.list` from the saved `historyId` for `messageAdded` in `INBOX`; the first pass MUST list `in:inbox newer_than:14d`
- **FR:gmail.details** (P1): `details` MUST read `users.messages.get` with `format=full` and a field mask, use the `text/plain` part (else HTML stripped), keep the headers, and set `isRead` from the absence of `UNREAD`
- **FR:gmail.draft** (P1): `createDraft` MUST call `users.drafts.create` with the thread id and a MIME reply built to the reply-header rule, body starting with the draft marker
  > - @req FR:email-triage/safe.draft-marker
- **FR:gmail.guard** (P1): The Gmail guard MUST allow only, on `https://gmail.googleapis.com/gmail/v1/users/me`: `GET /history`, `GET /messages`, `GET /messages/{id}`, `GET /labels`, `POST /drafts`, `POST /messages/{id}/modify`; every path with `send`, `trash`, `import`, `insert`, `settings`, `batchDelete`, and every `DELETE` MUST be denied
  - **FR:gmail.guard.modify** (P1): `modify` MUST be allowed only with `addLabelIds` from the `AI/*` labels and `SPAM`, and `removeLabelIds` of `INBOX` only for ids in `approvedMoves`
  > - @req FR:email-inbox-zero/gate.guard
- **FR:gmail.link** (P2): `link` MUST return `https://mail.google.com/mail/u/?authuser=<addr>#all/<id>` for a message and `#drafts` for drafts

### FR:imap: IMAP provider (phase 3)

Owner needs any other inbox (iCloud, Fastmail, Yahoo, a custom domain) triaged over standard IMAP, so that no inbox is left out.

- **FR:imap.login** (P1): `stack imap login --account <addr> --host <host> [--port 993]` MUST read the app password from a hidden prompt, test it with one `LOGIN`, and store it in the macOS Keychain (service `stack-imap`, account `<addr>`); it MUST NOT print or log it
- **FR:imap.config** (P1): The inbox config MUST be `imap-<address>.json` beside the token caches (mode `0600`) with host, port, and optional webmail URL; it MUST NOT hold the password
- **FR:imap.tls** (P1): The provider MUST connect with TLS on port 993 with certificate checks on; `STARTTLS` downgrade and plain ports MUST be refused
- **FR:imap.read** (P1): In `observe` mode the provider MUST open folders with `EXAMINE`; in every mode it MUST fetch with `BODY.PEEK` only, so triage never marks mail read
- **FR:imap.delta** (P1): The cursor MUST be `UIDVALIDITY` plus the last seen UID per folder; with `CONDSTORE` the provider MUST also track `HIGHESTMODSEQ` for read state
- **FR:imap.draft** (P1): `createDraft` MUST `APPEND` the reply to the `\Drafts` special-use folder with the `\Draft` flag
- **FR:imap.guard** (P1): The IMAP guard MUST allow only `CAPABILITY`, `LOGIN`, `LIST`, `EXAMINE`, `SELECT`, `STATUS`, `SEARCH`, `UID SEARCH`, `FETCH`/`UID FETCH` with `PEEK`, `APPEND` to `\Drafts`, `UID MOVE` for ids in `approvedMoves` to `\Archive` or `\Junk`, `LOGOUT`; `STORE`, `EXPUNGE`, `COPY`, `DELETE`, `RENAME`, and fetches without `PEEK` MUST be denied
- **FR:imap.nosmtp** (P1): `src/email/` MUST NOT import an SMTP client; a test MUST fail when `src/email/` names `nodemailer`, `smtp`, or port `25`, `465`, `587`, or when `package.json` lists an SMTP client directly
- **FR:imap.nomove** (P2): A server without `MOVE` MUST get no archive or spam batch; it gets one `go-do` ask per batch instead

### FR:surface: Decisions only

Owner needs only the mail that needs his call, as ranked asks, so that he never reads a recap.

- **FR:surface.asks** (P1): Email assistant MUST reach the owner only through asks; it MUST NOT write a digest, a recap, an email, or a notification of its own
- **FR:surface.cap** (P1): Email assistant MUST keep at most `maxOpenAsks` (default 5) open individual mail asks per inbox
  - **FR:surface.cap.pick** (P1): A `needs_decision`, a `sensitive` item, a VIP sender, or urgency 2 or more MUST get its own ask, most urgent first, up to the cap
  - **FR:surface.cap.rollup** (P1): Every other drafted reply MUST go into one `review` ask per inbox `mail-drafts-<inbox>`: "<N> reply drafts ready in <inbox>", link to the provider's Drafts, detail up to 20 lines `sender · subject` (no body)
  - **FR:surface.cap.overflow** (P2): Items over the cap MUST wait in the queue and MUST get an ask when a slot opens
- **FR:surface.priority** (P1): Ask priority MUST come from urgency: 3 `high`, 2 `normal`, 1 or less `low`; a VIP adds one level (max `high`); `crit` is never set by mail
- **FR:surface.system** (P1): System asks (`mail-signin-*`, `mail-model-down`, `mail-budget-*`, `mail-backlog-*`) MUST be at most one open per key and MUST be handled by the assistant when the cause clears
- **FR:surface.counts** (P1): Pass counts MUST go only to the status file and `stack email status`, never to an ask

### FR:meter: Usage meter

Owner needs tokens and list-price dollars per inbox per day, visible in Stack, so that he can see what the assistant costs and catch a runaway.

- **FR:meter.call** (P1): Email assistant MUST record each model call's inbox, stage (`classify`, `rejudge`, `draft`, `redraft`, `judge`), model, and input, output, cache-read, and cache-write tokens from the `claude -p` JSON (`modelUsage`, else `usage`)
  - **FR:meter.call.approx** (P2): A call with no usage block MUST count as 1 call and mark that day `approx`
- **FR:meter.price** (P1): Dollars MUST be the list-price equivalent from `priceFor` in `src/agents/store.ts`; a model not in the table adds tokens and marks the day `approx`
  > - @req FR:agent-sessions/driver.cost
- **FR:meter.day** (P1): The status file MUST hold one `$usage-day` per inbox per owner-local day for the last 35 days
- **FR:meter.view** (P1): The Agents usage panel MUST show one line per inbox: `Email · <inbox> · today <tokens> · 7 days <tokens> · ≈ $<usd> today at list price`
  > - @req FR:agent-sessions/web.usage.panel
- **FR:meter.cli** (P1): `stack email status --all` MUST print the same numbers per inbox, plus messages, settled by rules, sent to a model, drafts, and asks for today
- **FR:meter.api** (P2): `GET /email/usage` MUST return the `$usage-day` rows, owner only
- **FR:meter.budget** (P1): When an inbox reaches `dailyTokenCap` (default 1,000,000 tokens) in a day, the pass MUST stop model calls for that inbox until the next owner-local day, queue the mail that needs a model, and write one `decide` ask `mail-budget-<inbox>`: options `Raise cap for today` / `Wait until tomorrow`, default `Wait until tomorrow`
  - **FR:meter.budget.rules** (P1): Rules-only settling MUST continue while the cap holds

### FR:tokens: Token efficiency

Owner needs the fewest model tokens per decision, so that the assistant can run forever on his plan.

- **FR:tokens.zero** (P1): A pass with no new or queued mail MUST make zero model calls
- **FR:tokens.thread** (P1): Only the newest inbound message per conversation MUST reach a model
  > - @req FR:email-triage/rules.order
- **FR:tokens.clip** (P1): A classify call MUST hold at most 1,500 characters of message text; a draft call at most the last 3 messages of the thread at 1,500 characters each
- **FR:tokens.cache** (P2): A classification MUST be reused for 30 days for a message whose normalized body hash (quotes and signature stripped) was seen before from the same sender

### FR:safe: Safety (every provider)

Owner needs the assistant to be unable to send mail, leak secrets, or obey text inside an email, so that he can let it run unwatched.

- **FR:safe.nosend** (P1): Email assistant MUST have no code path that sends mail; a test MUST scan `src/email/` and fail on Graph `sendMail`, `/send`, `/reply`, `/replyAll`, `/forward`, Gmail `send`, and any SMTP name
  > - @req FR:email-triage/safe.allowlist
- **FR:safe.scopes** (P1): Each provider MUST request only the scopes in the plan's scope table for the inbox mode, and MUST refuse a token with any other scope
  > - @req FR:graph-signin/scope.never
- **FR:safe.secrets** (P1): Refresh tokens MUST live in `0600` files outside every repo, and IMAP passwords MUST live in the Keychain; no secret may appear in argv, env files, logs, asks, the status file, or git
- **FR:safe.injection** (P1): Model input MUST carry email text only as escaped, fenced data, with no tools, and model output MUST be re-validated against the schema
  > - @req FR:email-runner/model.cli
  > - @req FR:email-voice/prompt.build
  - **FR:safe.injection.act** (P1): Model output MUST NOT set a recipient, header, link, folder, label, or rule
  - **FR:safe.injection.flag** (P1): A message with `injectionSuspected` MUST get no draft and no ask of its own; it MUST go to the spam batch as a candidate
- **FR:safe.links** (P1): Ask links MUST come only from provider `link()`; a draft MUST lose every URL that is not in the thread
- **FR:safe.pii** (P1): Asks MUST hold no message body (summary and draft head only, redacted); the status file MUST hold inbox ids and counts only; logs MUST hold no address, subject, or body
  > - @req FR:email-inbox-zero/sum.ask
- **FR:safe.sensitive** (P2): Each inbox MUST start with a sensitive-sender denylist seeded for banks, health, legal, and government domains; that mail never reaches a model
  > - @req FR:email-triage/rules.order

### Non-functional Requirements

- **NFR:cost.busy** (P2): On the 120-message replay day (`plan.md` test plan), one inbox MUST use at most 250,000 tokens
- **NFR:cost.idle** (P2): An empty pass MUST finish in under 10 seconds with at most 2 provider requests per inbox
- **NFR:fresh** (P2): While the Mac is awake, a new message MUST become an ask (when it needs one) within 30 minutes

## Data Model

- **FR:$inbox** (P1): **`Inbox`**: one mailbox the assistant serves.
  - `id` (string): `FR:inbox.id`
  - `provider` (`'graph' | 'gmail' | 'imap'`)
  - `address` (string): kept in the local credential only
  - `project` (string): Stack project for its asks
  - `mode` (`'observe' | 'drafts'`): from the granted scope
  - `dailyTokenCap` (int): default 1,000,000
  - `maxOpenAsks` (int): default 5
- **FR:$email-status** (P1): **`.stack/email.json`** in the content repo; written only by the runner; read by Stack System.
  - `version` (int): 1
  - `inboxes` (Record<string, InboxStatus>): key is inbox id
  - `InboxStatus.provider` (string)
  - `InboxStatus.mode` (string)
  - `InboxStatus.lastOk` (string?): ISO time of the last good pass (`FR:auto.heartbeat`)
  - `InboxStatus.lastError` (string?): error code only
  - `InboxStatus.days` (UsageDay[]): last 35 days, newest first
- **FR:$usage-day** (P1): **`UsageDay`**
  - `date` (string): `YYYY-MM-DD` in the owner's time zone
  - `calls` (int)
  - `input`, `output`, `cacheRead`, `cacheWrite`, `tokens` (int)
  - `usd` (double): list-price equivalent
  - `approx` (bool)
  - `messages`, `ruled`, `modeled`, `drafts`, `asks` (int)
  - `byModel` (Record<string, int>): tokens per model

## Architecture Constraints

- The runner MUST run on the owner's Mac under launchd, never in the Stack host; the host has no timers and holds no mail credentials.
- The Stack host MUST read only `.stack/email.json` and `tasks/asks/mail-*`; it MUST NOT call a mail provider.
- `src/email/` MUST NOT depend on `src/web`, `src/api`, or `src/host`.
- Graph and Gmail MUST be plain `fetch` behind the guard (no vendor SDK).
- Model calls MUST go through the injectable `claude -p` adapter (`FR:email-runner/model.cli`).

## External Dependencies

- `imapflow` (MIT): IMAP client for phase 3 only. It opens no SMTP connection; its own dependencies stay unreachable from `src/email/` imports (`FR:imap.nosmtp`).
- Google Cloud project with the Gmail API on (free) and a Desktop OAuth client: phase 2 only.
