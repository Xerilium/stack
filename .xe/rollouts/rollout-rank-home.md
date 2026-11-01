---
features: [scoring-engine, task-lifecycle, api, cli, ask-queue, web-app]
status: in-progress
created: 2026-11-01
last_updated: 2026-11-01
---

# Rollout: rank-home

## Active State

**Model**: One ranking, in core. `rankStack` = `stack` engine order (blockers, due lens, time block) then `.stack/priorities.json` overrides (tiers `top` / normal / `down`, `hide` removes). `nextTask` = first of it; `GET /api/rank` and `stack next --top n` expose it; Home draws only what the server ranks (leaf → root row for display). Needs you = CoS-written `.stack/needs-you.json` (title, recommendation, default-if-silent, link, optional ref; Stack only adds `answer`); anything in Needs you is excluded from Home. Home NOW card = title + one context line + Start + Done + `…`; key hints hidden until a key is pressed.

**Decisions**:

- Overrides are a small JSON file with three effects (`top`, `down`, `hide`) — rejected a score multiplier (CoS and owner cannot reason about it) and a markdown format (parsing)
- Home ranks only via the server — rejected keeping `rankNow` in sync (that duplicate is why Home and `/next` disagreed); `rankNow` stays for My day (stack-schedule's area), noted as follow-up
- Needs-you items are answered by writing `answer` into the same file — rejected an inbox relay (the CoS rule: no relay messages)
- Format upgrade limited to adding the missing H2 sections (content verbatim) on task-lifecycle, api, ask-queue, web-app — rejected a full rewrite of 39-warning web-app spec in this PR

**Open**:

- None

**Next**: Phase 1 spec edits, `catalyst check`, then plan, then failing tests (golden fixture first).

**Pins**:

- `src/core/lifecycle.ts:285-300` — `findNext` (to become `rankStack`)
- `src/core/scoring.ts:514-560` — `stackEngine`, `rankTasks`
- `web/src/home.ts` — client ranking to remove; `web/src/now.ts:182` `rankNow`
- `web/src/needs.ts`, `web/src/useAsks.ts` — Needs you merge

**Assumptions**:

- The CoS and the owner both write `.stack/priorities.json` and `.stack/needs-you.json` by hand or by agent; Stack validates and ignores bad entries
- stack-schedule keeps `plan.ts` (My day) on `rankNow` for now

## Overview

Michael asked "who do I trust": Home (client-side `rankNow`) disagreed with the CoS `/next` ranking and with stack.md. This makes one ranking in core, adds an override file, a CoS-owned Needs-you file, and simplifies Home. Execution mode: autonomous (branch `xe/rank-home`, PR, pr-loop, not merged). Requested by Xe CoS.

## Run 1: rank-home

> **Execute**: `/catalyst:change scoring-engine task-lifecycle api cli ask-queue web-app — one ranking, needs-you file, simpler Home`

### Features

#### scoring-engine

- [ ] Spec FR:overrides; tests (golden fixture, apply/hide/until/invalid); code `src/core/priorities.ts`

#### task-lifecycle

- [ ] Spec FR:rank; tests; code `rankStack`, `nextTask` = first

#### api

- [ ] Spec routes.rank, routes.needs; tests; code; openapi; scope mapping

#### cli

- [ ] Spec cmd.next --top; tests; code

#### ask-queue

- [ ] Spec FR:needs (file, answer, dedupe); tests; core `src/core/needs-you.ts`, web merge, no-duplicate test

#### web-app

- [ ] Spec home3 (card, menu, keys, quiet) + amended home.*/now.*; tests; code (Home draws server rank)
- [ ] Designer screenshot loop (element count ≤5 on NOW)

### Post-implementation

- [ ] PR + `/catalyst:pr-loop`; report to Xe CoS (PR URL + head SHA) and `local_2adbb948-45fd-4a31-8711-b47fdcd4cdf7`

## Notes

- Follow-up (not this PR): My day (`plan.ts`) still ranks client-side with `rankNow`; move it to `GET /api/rank` (stack-schedule).
- Follow-up: full template upgrade of the web-app / task-lifecycle / api / ask-queue specs (opener, one-requirement style warnings are pre-existing).

## Final Review

- [ ] Confirm all runs complete
- [ ] Clean up temporary files and this rollout plan
- [ ] Close out — PR
