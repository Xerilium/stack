---
features: [inbox-page, ui-kit]
status: in-progress
created: 2026-11-19
last_updated: 2026-11-19
---

# Rollout: inbox-detail

## Active State

**Model**: The item file holds summaries only. The detail reads the message live from Graph on the local host and never stores it.

**Decisions**:

- Thread read uses three folder reads (inbox, sent items, archive) with a `conversationId` filter — rejected a new `GET /me/messages` allowlist entry (the guard stays as it is).
- Selection is page state — rejected a `#/inbox/<id>` route (keeps the change small).

**Open**:

- None

**Next**: Open the PR, run the PR loop, then delete this file.

**Pins**:

- `src/inbox/detail.ts` — reader contract
- `src/email/graph-mail.ts` — `readThread`

**Assumptions**:

- A thread fits in 25 messages per folder.

## Overview

Michael: Inbox "doesn't feel like email". Part 1 of 3: an item detail view (full message, thread, sender, account). Parts 2 and 3: junk section; reply draft with Send.

## Run 1: Item detail

> **Execute**: `/catalyst:change inbox-page — item detail view`

### Features

#### ui-kit

- [x] `Message` component and `SplitView` `reader` layout, with tests

#### inbox-page

- [x] Spec `FR:detail.*`
- [x] Tests first: `tests/email/read-thread.test.ts`, `tests/api/inbox-detail.test.ts`, `web/tests`, `web/e2e/inbox-detail.spec.ts`
- [x] `readThread` (guarded GET only), `GET /inbox-items/{id}/detail`, host wiring
- [x] Web: split view, detail pane
- [x] Screenshots at 375 px and desktop

## Notes

### Planning record

- **Approach**: Reader contract in `src/inbox/detail.ts`; Graph read in `src/email/graph-mail.ts` behind the guard in `observe` mode; the API returns the text and stores nothing.
- **Planning subagent**: None (small change).
- **Critique**: Guard allowlist unchanged; no body in the data repo; hosted app degrades to the summary.
- **Traceability**: 11/11 `FR:detail.*` mapped.
