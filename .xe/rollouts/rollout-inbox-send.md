---
features: [email-send, connect-accounts, email-runner, email-triage, graph-signin, inbox-page]
status: in-progress
created: 2026-11-19
last_updated: 2026-11-19
---

# Rollout: inbox-send

## Active State

**Model**: A reply draft lives in a local file. Send is one guarded `POST /me/messages/{id}/reply` that only the owner's click can approve. Send is off until the owner turns it on for an account.

**Decisions**:

- Send is `reply` with the comment only — rejected `createReply` + `PATCH` + `send` (three calls, two more guard exceptions).
- The guard binds an approval to one message id and the SHA-256 of the text — rejected an id-only approval (a different text could ride on it).
- With Send on, the runner keeps drafts out of the mailbox — rejected mailbox drafts in both modes (a sent reply would leave a stale AI draft in Outlook).
- The CLI sign-in never asks for the send scope; only the in-app toggle does.

**Open**:

- Owner review: this change ends "Stack never sends". No Autopilot label until the owner agrees.

**Next**: Open the PR on top of `xe/inbox-junk`, run the PR loop, then delete this file.

**Pins**:

- `src/email/guard.ts` — `approvedSends`
- `src/email/reply-send.ts` — the only send call
- `src/email/draft-store.ts` — local drafts

**Assumptions**:

- Microsoft lets a user consent to `Mail.Send` for the Stack app at sign-in (dynamic consent); the setup script lists it too.

## Overview

Part 3 of 3 for "Inbox doesn't feel like email": a pre-drafted reply in the item detail, edit in place, Send with one click. Stacked on `xe/inbox-junk`.

## Run 1: Reply draft and Send

> **Execute**: `/catalyst:create email-send — reply draft with one-click Send`

### Features

#### email-send

- [x] Spec
- [x] Tests first: guard, send, draft store, runner local drafts, API, web
- [x] Guard `approvedSends`, `sendReply`, draft store, reply boxes, routes, web Reply box

#### connect-accounts, graph-signin

- [x] `Mail.Send` on the scope allowlist; per-account `Send` toggle (off by default); setup script lists the permission

#### email-triage, email-runner, inbox-page

- [x] Rules reworded: Stack sends only on the owner's click; the runner never sends
- [x] Runner keeps drafts local for an account with Send on

## Notes

### Planning record

- **Approach**: One new guard exception bound to message id and text hash; one module that sends; local JSON draft store; API builds the approval from the owner's request only.
- **Planning subagent**: None.
- **Critique**: Runner has no send path (tests prove it); tokens get 403; demo copies have no reply box; a failed send keeps the draft.
- **Traceability**: all `FR:email-send/*` mapped.
