---
features: [inbox-page]
status: in-progress
created: 2026-11-18
last_updated: 2026-11-18
---

<!-- markdownlint-disable no-duplicate-heading -->

# Rollout: inbox-calm

## Active State

**Model**: Inbox shows mail only. Setup lives in Settings > Accounts. Inbox keeps one quiet status line that links there.

**Decisions**:

- Remove the sources panel and Check connection from Inbox — rejected: fold the panel to one line (still setup UI on a work page)
- Rows keep the current markup; `AskCard` comes with product-reset Stage 4 — rejected: build `AskCard` here (Stage 4 owns it)

**Open**:

- None

**Next**: Write failing tests, then code.

**Pins**:

- `web/src/InboxView.tsx` — page
- `web/src/InboxSources.tsx` — panel to remove

**Assumptions**:

- The CLI (`stack inbox sources`) keeps the per-source steps for agents.

## Overview

Issue [169](https://github.com/Xerilium/stack/issues/169): the Inbox page has setup noise. Make it calm: mail only, honest empty states, one quiet link to Settings > Accounts.

## Run 1: inbox-calm

> **Execute**: `/catalyst:change inbox-page — calm Inbox, setup moves to Settings`

### Features

#### inbox-page

- [x] Spec: `FR:web.view`, `FR:web.empty`, `FR:web.status`, `FR:web.nocmd`; drop `FR:web.sources`, `FR:web.check`
- [ ] Tests: unit (`statusLine`) and e2e (`inbox-status.spec.ts`)
- [ ] Code: `InboxView`, remove `InboxSources`, CSS

### Post-implementation

- [ ] Present work for review

## Notes

- Downstream impact: none (`catalyst deps inbox-page --reverse`).
- Traceability gaps outside `FR:web.*` deferred.

## Final Review

- [ ] Confirm all runs complete
- [ ] Clean up this rollout plan
- [ ] Close out — PR
