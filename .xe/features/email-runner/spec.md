---
id: email-runner
title: Email Runner
author: flanakin
description: "One command runs a triage pass on the owner's mailbox: Graph delta, deterministic rules, a cheap model to classify, a bigger model only for drafts, inbox-zero asks, and approved actions. Models run through the owner's Claude login (`claude -p`, no tools). Runs where Claude Code runs (launchd or a scheduled task), never in the Stack host."
dependencies: [email-triage, email-voice, email-inbox-zero, graph-signin, day-inputs]
---

<!-- markdownlint-disable single-title -->

# Feature: Email Runner

## Purpose

The triage, voice and inbox-zero modules are pure and injected. This feature wires them to the real mailbox and real models in one pass the owner can schedule. It is token-efficient by design: rules settle most mail for free, Haiku classifies the rest from a clipped preview, Sonnet writes only the drafts, and a draft that fails the voice check is redrafted once. The Stack host has no timers (`FR:deploy`), so the runner is a CLI command that launchd or a Claude Code scheduled task calls.

## Scope

- In: `stack email run|voice|status`; the `claude -p` model adapter and the three model roles; Graph message details, sent items and approved moves; the one-click unsubscribe HTTP client; the per-mailbox state file and run lock.
- Out: sign-in (`graph-signin`), the ask UI, the launchd install itself (owner approves it as a `go-do` ask), Gmail/IMAP.

## Scenarios

### FR:cli: Commands

- **FR:cli.run** (P1): `stack email run [--mode observe|drafts] [--max n] [--dry-run]` signs in from the Graph token cache, runs one triage pass on the inbox, writes asks to the content repo (committed and pushed by the repo's storage), and prints the run summary (`--json` for JSON). Mode defaults to `drafts` when the token holds `Mail.ReadWrite`, else `observe`. `--dry-run` uses a memory store for asks and state and writes nothing to the mailbox. `--max` caps the messages one delta may bring (default 200): more stops the pass before any model call or write, with exit `4` and the count, so mail is never skipped; rerun with a higher `--max`. A first pass (no saved cursor) looks back 14 days only (`receivedDateTime ge`), so an old backlog never floods it. Rules come from the account (owner) plus an optional `rules.json` (VIP, sensitive, receipt patterns) beside the state. A message whose classification fails twice becomes an open question to the owner (`modelErrors` counts it), and a failed draft becomes a plain "Reply to" ask; neither stops the pass
- **FR:cli.voice** (P1): `stack email voice [--extra file.json]` reads up to 200 Sent items (mail to sensitive recipients in the rules is never an example; `--extra` must be a JSON array of `{subject?, body, sentAt?}`), learns the voice (`FR:email-voice/learn.profile`), adds `kind: 'other'` samples from `--extra`, saves the profile (`FR:email-voice/learn.store`) and the style guide next to it, and prints the sample count and the profile path. It never prints mail text
- **FR:cli.status** (P1): `stack email status` prints the account, mode, last pass time and summary, pending archive and spam counts, and whether a voice profile exists. Exit `4` when not signed in
- **FR:cli.lock** (P1): One pass per mailbox at a time: a lock file in the data directory holding a token, touched every 5 minutes while held, removed only by its holder; a second run exits `4` with "a pass is already running". A lock untouched for 30 minutes is stale: it is renamed aside (one taker wins) and taken over
- **FR:cli.schedule** (P1): `stack email schedule [--remote origin]` prints a LaunchAgent plist that runs `email run` every 15 minutes with absolute paths for node, the CLI and `claude` (launchd has no shell PATH) and logs beside the state. It prints only; the owner installs it with `launchctl bootstrap`
- **FR:cli.account** (P1): `--account` must be the signed-in mailbox when the token names one

### FR:model: Model tiers

- **FR:model.cli** (P1): `claudeJson({model, system, user, schema})` runs `claude -p` with `--safe-mode` (no CLAUDE.md, plugins, hooks or MCP; about a quarter of the tokens), `--tools ""` (no tools, so injected text cannot act), `--no-session-persistence`, `--strict-mcp-config`, `--output-format json`, `--json-schema`, the system prompt from a 0600 file (it holds the owner's writing samples, so not argv), and the user prompt on stdin, in a private empty working folder. It returns `structured_output` and the cost; a non-zero exit, a timeout (120 s), or a missing structured output throws. The binary is `STACK_CLAUDE_BIN` or `claude`
- **FR:model.classify** (P1): The classifier sends sender, subject, and the first 1500 characters of the message's own text (`uniqueBody`, HTML stripped) fenced as untrusted data, to `claude-haiku-5-5`, and asks for class, urgency, confidence, reason, options, recommend, summary, and `injectionSuspected`. A result under 0.6 confidence is asked again of `claude-sonnet-5-5` once
- **FR:model.draft** (P1): The drafter uses `draftPrompt` (`FR:email-voice/prompt.build`) with `claude-sonnet-5-5` and returns the reply text only
- **FR:model.judge** (P1): The newsletter judge asks `claude-haiku-5-5` for one sentence on what the owner gets from a sender, from its recent subjects only
- **FR:model.usage** (P2): Each pass sums model calls and cost in the summary (`modelCalls`, `costUsd`)

### FR:graph: Mailbox access

- **FR:graph.details** (P1): For each message the rules or models will see, the runner reads `internetMessageHeaders`, `uniqueBody` and `isRead` with one guarded `GET /me/messages/{id}`. The body becomes plain text (tags dropped, entities decoded, line breaks kept), clipped to 4000 characters
- **FR:graph.read** (P1): Delta selects `isRead` too, so later passes see reads for the subscription ledger
- **FR:graph.sent** (P1): Sent items are read with guarded `GET /me/mailFolders/sentitems/messages` pages (`$select` subject, body, recipients, sent time; `$top` 50; at most 4 pages)
- **FR:graph.move** (P1): `MailActions.move` posts `{destinationId}` to `/me/messages/{id}/move` through a guard built for this pass with `approvedMoves` = the ids listed on the batch asks (`FR:email-inbox-zero/gate.guard`). Only in `drafts` mode

### FR:http: One-click unsubscribe

- **FR:http.safe** (P1): The HTTP client posts once, only to port 443, only when every address the host name resolves to is public (no private, loopback, link-local, CGNAT, multicast, unique-local, IPv4-mapped, NAT64 or documentation ranges, in any written form), and connects to the address it checked (no second lookup, so no DNS rebinding). No cookies or credentials, a 10 s timeout, redirects never followed (a redirect counts as failure)

### FR:state: State

- **FR:state.file** (P1): Per mailbox `<data>/email/<account>/state.json` (mode 0600) holds the delta cursor, the inbox-zero state, and the last summary. Written atomically after each pass; a pass that throws keeps the previous cursor so nothing is skipped

## Dependencies

- graph-signin (`FileTokenCache`, `graphToken`), day-inputs (`createGraphMail`, `graphTransport`), email-triage, email-voice, email-inbox-zero
