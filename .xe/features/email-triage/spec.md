---
id: email-triage
title: Email Triage Module
author: flanakin
description: "Inbound email triage as a Stack module: reads a mailbox, decides what needs the owner, drafts replies (never sends), and writes asks into the ask queue. Plan: https://github.com/flanakin/todo/pull/93"
dependencies: [ask-queue, ai-triage-assist]
---

<!-- markdownlint-disable single-title -->

# Feature: Email Triage Module

## Purpose

Mail is the biggest source of interruptions. This module reads a mailbox on a schedule, settles most mail with rules, classifies the rest with models, drafts replies for what needs one, and gives the owner only the decisions, as asks in the live ask queue (`FR:ask-queue/*`). It never sends mail. The architecture, cost, and risk analysis is in the email assistant plan (todo PR 93); this spec fits that plan into Stack and covers what this repository ships first.

## Scope

- In (this repo, first slice): module layout `src/email/`; the Graph request allowlist that makes sending impossible in code; the deterministic prefilter; the mapping from a triage result to an ask; fixtures and tests with no real mail and no network.
- Out (next, needs the owner's one-time setup in plan section 9): device-code sign-in, delta sync, model tiers (Haiku classify, Sonnet draft, Opus high-stakes), SQLite state, launchd runner, usage meter. These plug into the interfaces below.

## Module contract

`src/email/` has no dependency on the web app or on any other module. It depends only on the ask queue core (`putAsk`) and exposes `MailProvider`, `Classifier`, and `Drafter` interfaces. A run is: provider delta, prefilter, classify, (draft), `putAsk`. Everything that needs a network call is injected, so tests run offline.

## Scenarios

### FR:safe: Never send

- **FR:safe.allowlist** (P1): `createGraphGuard()` allows only these (method, path) pairs against `https://graph.microsoft.com/v1.0`: `GET /me/mailFolders/{id}/messages` (and `/delta`), `GET /me/messages/{id}`, `POST /me/messages/{id}/createReply` (draft), `PATCH /me/messages/{id}` limited to `categories`. Any other request throws `GraphDenied` before the network is touched. Paths containing `send`, `sendMail`, `forward`, `reply` (other than `createReply`), `replyAll`, `move`, `copy`, or any `DELETE` are always denied
- **FR:safe.scopes** (P1): The requested scopes are exactly `Mail.Read` (observe mode) or `Mail.ReadWrite` (drafts mode), plus `offline_access`. `Mail.Send` is never requested; a test fails the build if the string appears in `src/email/` outside this requirement's test
- **FR:safe.draft-marker** (P1): A draft body starts with `⟦AI draft: review before sending⟧`. Recipients, subject, and thread come from the server's `createReply`, never from model output

### FR:rules: Prefilter

- **FR:rules.order** (P1): `prefilter(msg, config)` returns the first match, in order: already answered by the owner (last message in thread is from the owner) `skip`; calendar item `calendar`; sensitive sender (config denylist) `sensitive` (never sent to a model); bulk headers (`List-Unsubscribe`, `List-Id`, `Precedence: bulk|list`, `Auto-Submitted: auto-*`) `newsletter`; receipt or notification sender or subject with no question in the preview `receipt`; otherwise `null` (needs a model)
- **FR:rules.vip** (P2): A VIP sender is never settled by rules except `skip` and `calendar`; the result carries `vip: true` so the classifier floors urgency

### FR:ask: Triage result to ask

- **FR:ask.reply** (P1): A `needs_reply` result with a draft becomes an ask of kind `review` keyed `mail-<conversation hash>`: `ask` = `Review draft reply to <sender name>: <subject>`, `recommend` = `Send as drafted` or `Edit then send` by model confidence, `link` = the draft's Outlook web link, `default` = `Draft stays in Drafts (nothing is sent)`, `reversible: yes`, `project` from the mailbox, `from: email-triage`, `## Detail` = the first 600 characters of the draft
- **FR:ask.decide** (P1): A `needs_decision` result becomes kind `decide` with 2-4 options from the model and a recommendation; `sensitive` becomes kind `go-do` with sender and subject only, no body
- **FR:ask.quiet** (P1): `newsletter`, `receipt`, `calendar`, `skip` and `fyi` results create no ask; they only increase counters in the run summary. Idempotent: the same conversation twice updates one ask
- **FR:ask.resolve** (P2): When the owner replies in the thread (seen on the next delta), the module handles the ask as `resolved`

## Dependencies

- ask-queue (`putAsk`, `handleAsk`), ai-triage-assist (redaction)
