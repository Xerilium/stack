---
features: [inbox-page, ui-kit, email-inbox-zero, email-runner, email-triage]
status: in-progress
created: 2026-11-19
last_updated: 2026-11-19
---

# Rollout: inbox-junk

## Active State

**Model**: Junk is a view of the item file: an email item of kind `spam` or `newsletter` that the owner did not restore. Nothing moves until the owner clicks.

**Decisions**:

- Cold outreach is class `spam` (one prompt line) — rejected a new triage class (schema, hygiene and ask changes for one label).
- The owner's click on `Archive all` is the approval; the guard gets exactly the clicked ids as `approvedMoves` — rejected an answered ask per click (two steps for one decision).
- `Not junk` is a flag on the item that later passes keep — rejected a sender allowlist (needs the sender address in the item file).

**Open**:

- None

**Next**: Open the PR on top of `xe/inbox-detail`, run the PR loop, then delete this file.

**Pins**:

- `src/inbox/junk.ts` — `isJunk`, `clearJunk`
- `src/inbox/junk-mailbox.ts` — guarded archive and one-click unsubscribe

**Assumptions**:

- Archive is the right target for every junk item (reversible in Outlook).

## Overview

Part 2 of 3 for "Inbox doesn't feel like email": a collapsed Junk section with `Not junk`, `Archive all` and `Unsubscribe and archive all`. Never deletes. Stacked on `xe/inbox-detail`.

## Run 1: Junk section

> **Execute**: `/catalyst:change inbox-page — junk section`

### Features

#### ui-kit

- [x] `Fold` component with tests

#### inbox-page

- [x] Spec `FR:junk.*`
- [x] Tests first: `tests/inbox/junk.test.ts`, `tests/inbox/junk-mailbox.test.ts`, `tests/api/inbox-junk.test.ts`, web unit and e2e
- [x] `isJunk`, `not-junk` action, `clearJunk`, `POST /inbox-junk`, host wiring
- [x] Web: Junk section
- [x] Screenshots at 375 px and desktop

#### email-inbox-zero, email-triage, email-runner

- [x] Hard rule and allowlist wording: an approval is an answered ask or a click on a Junk action
- [x] Classifier prompt: cold outreach is `spam`

## Notes

### Planning record

- **Approach**: Pure core in `src/inbox/junk.ts` with an injected `JunkMailbox`; the Graph side reuses `createGraphActions` (guard, `approvedMoves`) and `unsubscribeTarget` with the safe HTTP client.
- **Planning subagent**: None.
- **Critique**: Guard code unchanged; only `archive` is a target; no delete path; read-only accounts are kept and counted.
- **Traceability**: all `FR:junk.*` mapped.
