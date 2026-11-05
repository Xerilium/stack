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

### FR:web: Page

- **FR:web.view** (P1): `#/inbox` lists items. Each row: source, sender, subject, summary, one primary button for the suggested action, a menu of other actions. Missing actions show "Request this action".
- **FR:web.draft** (P1): `reply-draft` opens an editable text area first. Confirming creates the draft and shows an "Open in Outlook" link. The page has no send button.
- **FR:web.phone** (P1): At 375 px width rows stack and nothing scrolls sideways.

### FR:api: API

- **FR:api.read** (P1): `GET /inbox-items` returns `{ items, actions }`.
- **FR:api.act** (P1): `POST /inbox-items/{id}/action` takes `{ action, text?, until? }`. Owner only.

## Interfaces

`InboxStore { read(): Promise<InboxItem[]>; write(items): Promise<void> }`, `ChatConnector`, `IssueFiler { file(issue): Promise<{ url }> }`.

## Dependencies

email-triage, email-inbox-zero, email-voice, ask-queue, web-shell.
