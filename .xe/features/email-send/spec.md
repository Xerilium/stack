---
id: email-send
title: Email Send
author: flanakin
description: "A reply draft ready in the Inbox detail: the owner edits it in place and sends it with one click. Off by default."
dependencies: [connect-accounts, email-triage, email-voice, graph-signin, inbox-page]
---

<!-- markdownlint-disable single-title -->

# Feature: Email Send

## Purpose

The owner needs to answer mail where he reads it. Stack shows a reply in his voice, ready to edit, and sends it only when he clicks Send.

## Scenarios

### FR:draft: Reply draft

The owner needs a reply ready when he opens a mail that needs one so that an answer takes one edit and one click.

- **FR:draft.web** (P1): Interface: the Inbox item detail shows a `Reply` box for an email item that has a stored draft.
- **FR:draft.api** (P1): Interface: `POST /inbox-items/{id}/draft` takes `{ text }` and stores it as the draft of the item.
  - **FR:draft.api.owner** (P1): API MUST answer 403 to a token.
  - **FR:draft.api.detail** (P1): `GET /inbox-items/{id}/detail` MUST return `draft` (`text`, `canSend`, optional `link`) when the item has a stored draft.
- **FR:draft.store** (P1): Runner MUST store each new reply draft of a pass in `<data>/email/<account>/drafts.json`.
  - **FR:draft.store.mode** (P1): Store MUST write the file with mode `0600`.
  - **FR:draft.store.keep** (P1): Runner MUST keep the stored draft of a message when a later pass reuses its draft.
- **FR:draft.local** (P1): Runner MUST keep reply drafts out of the mailbox for an account with Send on.
  - **FR:draft.local.ask** (P2): Review ask of a local draft MUST say `Draft stays in Stack (nothing is sent)`.
- **FR:draft.show** (P1): Detail MUST show the stored draft in an editable text box, without the AI draft marker.
- **FR:draft.edit** (P1): Page MUST store an edited draft when the owner leaves the text box.
- **FR:draft.outlook** (P1): Detail MUST show `Open draft in Outlook` in place of `Send` for an account with Send off.

### FR:send: Send

The owner needs one click to send a reply, and no other way for mail to leave, so that he can trust the Inbox.

- **FR:send.web** (P1): Interface: the `Reply` box has one `Send` button.
- **FR:send.api** (P1): Interface: `POST /inbox-items/{id}/send` takes `{ text }` and returns `{ ok: true }`.
  - **FR:send.api.owner** (P1): API MUST answer 403 to a token.
  - **FR:send.api.off** (P1): API MUST answer 409 for an account with Send off.
- **FR:send.click** (P1): Page MUST call the send route only on a click on `Send`.
- **FR:send.guard** (P1): Guard MUST allow `POST /me/messages/{id}/reply` only for a message id in `approvedSends` whose value is the SHA-256 of the `comment`.
  - **FR:send.guard.body** (P1): Guard MUST refuse a reply body that has a field other than `comment`.
  - **FR:send.guard.rest** (P1): Guard MUST refuse `send`, `sendMail`, `forward`, `replyAll` and each `create` form of them in every case.
- **FR:send.approve** (P1): Sender MUST approve one message id and one text for each click.
- **FR:send.text** (P1): Sender MUST send the text without the AI draft marker.
  - **FR:send.text.empty** (P1): Sender MUST refuse an empty text.
- **FR:send.done** (P1): API MUST remove the stored draft and the item, and resolve the ask, after a send.
  - **FR:send.done.fail** (P1): API MUST keep the stored draft and the item when the send fails.
- **FR:send.runner** (P1): Runner MUST NOT send mail in any mode.
- **FR:send.optin** (P1): Send MUST be off for an account until the owner turns it on.
  > - @req FR:connect-accounts/scope.send
- **FR:send.demo** (P2): Demo copy MUST NOT offer a reply box.

## Data Model

- **FR:$draft** (P1): **`StoredDraft`**: `messageId` (the Graph message the reply answers), `text`, `at` (ISO time), and optional `link` (the Outlook link of a mailbox draft).

## Architecture Constraints

- `src/email/reply-send.ts` is the only module that builds a send request.
- Recipients, subject and thread come from the server's `reply`. The request body is the `comment` only.
- Draft text stays on this machine: the local file and the mailbox. It never enters the data repo beyond the ask detail (`FR:email-triage/ask.reply`).

## External Dependencies

- Microsoft Graph `POST /me/messages/{id}/reply` (delegated `Mail.Send`).
