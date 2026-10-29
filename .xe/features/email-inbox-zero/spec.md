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

- **FR:gate.answered** (P1): Each batch ask is written once and never rewritten: its key is `mail-<archive|spam>-<hash of its ids>`, and the state records exactly its ids and a fingerprint of what the owner sees (author, ask line, detail). While a batch of a kind is open, new mail waits for the next batch. `approvedChoice(ctx, key)` returns `go` or the picked option only for an `answered` ask written by `email-triage`; a batch acts only when its ask still matches the fingerprint. The fingerprint covers every field the owner sees (author, kind, ask, why, recommendation, options, default, detail, link, reversible); the ask must be `approve`, and an ask changed after it was answered (even back to its original text) does not act. Batches hold at most 200 messages. A rewritten ask (by any agent) is handled as "Changed outside email-triage; nothing moved". A retracted answer is open again and nothing happens
- **FR:gate.guard** (P1): `createGraphGuard({ mode: 'drafts', approvedMoves })` additionally allows `POST /me/messages/{id}/move` with body exactly `{ "destinationId": <folder> }` when `approvedMoves` maps that id to that folder (`archive` for archive batches, `junkemail` for spam). `approvedMoves(ctx, state)` builds the map only from intact batches answered `go`. Without it, or for any other id, folder, or body, the request is denied as before. `DELETE`, `send`, `forward`, `reply`, `copy` stay denied in every case
- **FR:gate.once** (P1): Moves are saved one by one, so a pass that dies mid-batch never moves twice; a 404 counts as already moved. After acting, the ask is handled with counts and the batch removed

### FR:batch: Batch asks for settled mail

- **FR:batch.archive** (P1): Messages settled as `newsletter`, `receipt`, `calendar`, `fyi`, or `skip` (owner already answered) that are older than `archiveAfterHours` (default 24) go into one `approve` ask: `ask` = `Archive <N> settled messages?`, `recommend` = `Archive`, `default` = `Nothing moves`, `reversible: yes`, `## Detail` = counts by class and up to 20 lines `class · sender · subject` (never a body). VIP mail and mail the owner declined never enter a batch. Only the triaged message is batched; its class never spreads to older messages in the thread
- **FR:batch.spam** (P1): Messages classified `spam` (model) or with failing authentication (`Authentication-Results` with `dmarc=fail`, or `spf=fail` and `dkim=fail`) go into a separate `approve` ask: `Move <N> spam messages to Junk?`. Spam is never drafted and never gets its own ask
- **FR:batch.act** (P1): `applyApproved(ctx, {state, actions, http})` runs before new asks are written in each pass. `go` moves exactly the batch's ids via `MailActions.move`; failed ids (other than 404) return to the pending list and are asked again. `no` records the ids as declined (never asked again). A reply or question is not an approval: nothing moves and the mail is asked again in the next batch. Without `actions` (observe mode) no batch or subscription ask is written, so every `go` can act

### FR:sub: Subscriptions

- **FR:sub.ledger** (P1): Each bulk sender (by `List-Id`, else sender address) has a ledger row: first and last seen, issues received, issues read (from `isRead` on later deltas), the unsubscribe method (`one-click`, `link`, `mailto`, `none`), and the owner's decision. Anyone can claim a `List-Id`, so only an issue whose receiving-server `Authentication-Results` shows `dkim=pass` with `header.d` equal to the From domain or a parent of it may set or change the unsubscribe target, and `one-click` needs that too (RFC 8058 section 4)
- **FR:sub.value** (P1): On the second issue from a sender with no decision, `Judge.newsletterValue(sender, subjects)` states in one sentence what the owner gets from it. The module writes one `decide` ask `sub-<hash>`: `Keep <sender>?`, `why` = the stated value, options `Keep` / `Unsubscribe` / `Archive on arrival`, `recommend` from the read rate (`Unsubscribe` when under 20% of at least 3 issues were read), `default` = `Keep (nothing changes)`
- **FR:sub.revisit** (P1): `Keep` records the stated value, the counts at that moment, and a revisit date 30 days out. At the revisit the module re-asks with evidence since the decision: `Still worth it? <sender>`, why `Expected "<value>" Read <r> of <n> issues since <date>.`, and the same options. A `no`, a reply, or a question counts as keep until the revisit (no nagging). `Archive on arrival` adds the sender to the archive batch automatically (still only moved after a `mail-archive` approval)
- **FR:sub.unsubscribe** (P1): `Unsubscribe` on a one-click sender sends the RFC 8058 `POST` (body `List-Unsubscribe=One-Click`, no cookies, no redirects followed, 10 s timeout) through the injected `Http`, only to an `https` URL with a public host name (no IP literals, no single-label names, no `localhost` with or without a trailing dot, no `.local`, `.internal`, `.lan`, `.home.arpa` and similar, no credentials); the runner's client also checks DNS and refuses redirects (`FR:email-runner/http.safe`). Success handles the ask; failure or any other method converts the ask to `go-do` with the link (`https` only) and the reason

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
