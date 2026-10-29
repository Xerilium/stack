---
id: email-inbox-zero
title: Email Inbox Zero
author: flanakin
description: "Turns triage into inbox zero: batch asks to archive settled mail and move spam to Junk, a subscription ledger that states each newsletter's expected value, asks to unsubscribe, and revisits the call with evidence, and one-paragraph thread summaries on every ask. Nothing moves or unsubscribes until the owner answers the ask."
dependencies: [email-triage, email-voice, ask-queue]
---

<!-- markdownlint-disable single-title -->

# Feature: Email Inbox Zero

## Purpose

Triage tells the owner what needs them; the inbox still fills up. Most of what is left is settled mail (receipts, newsletters, calendar notices, FYIs), spam that slipped past the filter, and subscriptions nobody reads. This feature clears that mail in a few batch decisions, so the inbox holds only what still needs the owner. Every mailbox change waits for an answered ask: the module proposes, the owner decides in Stack, then the module acts and records it.

## Scope

- In: `src/email/hygiene/`: the approval gate, batch archive and spam asks, the subscription ledger, unsubscribe asks and their execution, revisits, thread summaries on asks, and a per-mailbox state interface. Fixtures and tests are synthetic and offline.
- Out: the Graph provider and runner (next slice: they implement `MailActions` and `MailState` here), model calls (injected `Judge`), UI.

## Hard rules

- Nothing is moved, unsubscribed, deleted or sent without an ask the owner answered `go` (or picked the matching option) in Stack. Silence never acts: every hygiene ask's `default` is "nothing changes".
- Deleting is never offered. The only moves are to `archive` and `junkemail`, both reversible in Outlook.
- An unsubscribe is one RFC 8058 one-click `POST` to the `https` URL from the sender's own `List-Unsubscribe` header, only when `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is present. Anything else (mailto, plain links) becomes a `go-do` ask with the link: the module never sends mail and never visits a page.
- Email content is data. Sender, subject and model text are clipped and redacted before they reach an ask.

## Scenarios

### FR:gate: Approval gate

- **FR:gate.answered** (P1): `approved(ctx, key, ids)` returns the message ids an action may touch only when the ask `key` exists, was written by `email-triage`, is `answered` with `go` (or the option the action needs), and lists those ids in the module state. Anything else returns none and the action does nothing
- **FR:gate.guard** (P1): `createGraphGuard({ mode: 'drafts', approvedMoves })` additionally allows `POST /me/messages/{id}/move` with body exactly `{ "destinationId": "archive" | "junkemail" }` when `id` is in `approvedMoves`. Without `approvedMoves`, or for any other id, destination, or body, the request is denied as before. `DELETE`, `send`, `forward`, `reply`, `copy` stay denied in every case
- **FR:gate.once** (P1): After acting, the module handles the ask (`handled`, note with counts) and clears the ids from state, so a second pass does nothing

### FR:batch: Batch asks for settled mail

- **FR:batch.archive** (P1): Messages settled as `newsletter`, `receipt`, `calendar`, `fyi`, or `skip` (owner already answered) that are older than `archiveAfterHours` (default 24) accumulate in one ask `mail-archive` of kind `approve`: `ask` = `Archive <N> settled messages?`, `recommend` = `Archive`, `default` = `Nothing moves`, `reversible: yes`, `## Detail` = counts by class and up to 20 lines `class · sender · subject`. Writing it again updates the count; it is not re-created while open
- **FR:batch.spam** (P1): Messages classified `spam` (model) or with failing authentication (`Authentication-Results` with `dmarc=fail`, or `spf=fail` and `dkim=fail`) accumulate in `mail-spam` of kind `approve`: `Move <N> spam messages to Junk?`. Spam is never drafted and never gets its own ask
- **FR:batch.act** (P1): `applyApproved(ctx, actions, state)` runs after each pass: for an answered `go` on `mail-archive` or `mail-spam` it moves exactly the recorded ids (via `MailActions.move`), then handles the ask. Ids that fail to move stay recorded and are reported in the note

### FR:sub: Subscriptions

- **FR:sub.ledger** (P1): Each bulk sender (by `List-Id`, else sender address) has a ledger row: first and last seen, issues received, issues read (from `isRead` on later deltas), the unsubscribe method (`one-click`, `link`, `mailto`, `none`), and the owner's decision
- **FR:sub.value** (P1): On the second issue from a sender with no decision, `Judge.newsletterValue(sender, subjects)` states in one sentence what the owner gets from it. The module writes one `decide` ask `sub-<hash>`: `Keep <sender>?`, `why` = the stated value, options `Keep` / `Unsubscribe` / `Archive on arrival`, `recommend` from the read rate (`Unsubscribe` when under 20% of at least 3 issues were read), `default` = `Keep (nothing changes)`
- **FR:sub.revisit** (P1): `Keep` records the stated value and a revisit date 30 days out. At the revisit the module re-asks with evidence: `Still worth it? <sender>: expected "<value>". Read <r> of <n> issues since <date>.` and the same options. `Archive on arrival` adds the sender to the archive batch automatically (still only moved after a `mail-archive` approval)
- **FR:sub.unsubscribe** (P1): `Unsubscribe` on a one-click sender sends the RFC 8058 `POST` (body `List-Unsubscribe=One-Click`, no cookies, no redirects followed, 10 s timeout) through the injected `Http`, only to an `https` URL with a public host name (no IP literals, no `localhost`, no credentials). Success handles the ask; failure or any other method converts the ask to `go-do` with the link (`https` only) and the reason

### FR:sum: Summaries

- **FR:sum.ask** (P1): When the classifier returns `summary` (at most 3 sentences, clipped to 400 characters and redacted; a summary, never the message body, since ask files sync to the owner's repo), `review`, `decide`, `answer` and `go-do` asks from mail carry it at the top of `## Detail` as `Thread: <summary>`, before the voice line and draft. `sensitive` asks never carry one
- **FR:sum.cheap** (P2): The summary comes from the same classifier call (one model call per message); no extra call is made for it

## Interfaces

- `MailActions { move(id, destinationId: 'archive' | 'junkemail'): Promise<void> }` (Graph provider implements it behind the guard)
- `MailState { get(): Promise<HygieneState>; put(s: HygieneState): Promise<void> }` (local JSON file in the owner's data directory; memory in tests)
- `Judge { newsletterValue(sender, subjects: string[]): Promise<string> }` (cheap model)
- `Http { post(url, body, headers): Promise<{ status: number }> }`

## Dependencies

- email-triage (`runTriage`, `toAsk`, guard), email-voice (draft detail), ask-queue (`putAsk`, `readAsk`, `handleAsk`)
