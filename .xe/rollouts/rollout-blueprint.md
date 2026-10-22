---
features: [blueprint]
status: in-progress
created: 2026-10-21
last_updated: 2026-10-21
---

<!-- markdownlint-disable no-duplicate-heading -->

# Rollout: blueprint

Implement the product per `.xe/features/blueprint.md`.

## Active State

**Model**: Blueprint migrated to Catalyst 0.3 single-file shape from the 0.1.3 multi-file draft; content unchanged.

**Decisions**: None

**Open**: Owner sign-off on the blueprint.

**Next**: Await sign-off; then run Run 1 waves via `/catalyst:create`.

**Pins**: `.xe/features/blueprint.md` — architecture, data model, roadmap

**Assumptions**: Phases 1-4 map to Product Strategy POC, Mainstream, Innovation, Platform.

## Run 0: Blueprint creation

- [x] Phase 0: Scope — interview complete (2026-10-21)
- [x] Phase 1: Plan — decomposition drafted
- [x] Phase 2: Implement — `.xe/features/blueprint.md` written; design-decisions.md created
- [ ] Phase 3: Review — awaiting owner sign-off

## Run 1: POC

### Wave 1.1

- [ ] `/catalyst:create task-model: format-neutral task types and validation`
  - Scope: types, validation, autonomy field; no parsing/IO
  - Dependencies: none

### Wave 1.2

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create task-parser: lossless emoji-markdown parse/serialize` (existing PR 7)
    - Dependencies: task-model
  - [ ] `/catalyst:create recurring-rows: cadence roll for 🔄 rows` (existing PR 6)
    - Dependencies: task-model
  - [ ] `/catalyst:create recurring-rows-v2: legacy row form, weekday names, Quarterly-EOM+1, nominal-day anti-drift`
    - Dependencies: recurring-rows
  - [x] `/catalyst:create config: legacy config, defaults, time blocks` (PR 10)
    - Dependencies: task-model

### Wave 1.3

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create scoring-engine: pluggable engine, legacy formula default`
    - Dependencies: task-parser, config
  - [ ] `/catalyst:create storage-git: storage interface and git adapter`
    - Dependencies: task-parser

### Wave 1.4

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create task-lifecycle: all task operations and sweeps`
    - Dependencies: scoring-engine, recurring-rows
  - [ ] `/catalyst:create summaries: README, stack, projects, my-day`
    - Dependencies: scoring-engine

### Wave 1.5

- [ ] `/catalyst:create cli: full command set`
  - Dependencies: task-lifecycle, summaries, storage-git

## Run 2: Mainstream

### Pre-implementation

- [ ] **Re-evaluate blueprint via `/catalyst:blueprint`** — incorporate Phase 1 learnings

### Wave 2.1

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create formatter-clean: clean structured formatter and dual output`
    - Dependencies: cli
  - [ ] `/catalyst:create api: REST over core`
    - Dependencies: cli

### Wave 2.2

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create auth-security: SWA allow-list, hashed scoped tokens, threat model`
    - Dependencies: api
  - [ ] `/catalyst:create quick-capture: natural-language and speech add`
    - Dependencies: api

### Wave 2.3

- [ ] `/catalyst:create web-app: desktop keyboard-first and mobile touch UI`
  - Dependencies: api, auth-security

## Run 3: Innovation

### Pre-implementation

- [ ] **Re-evaluate blueprint via `/catalyst:blueprint`**

### Wave 3.1

- 🔀 Execute in parallel:
  - [ ] `/catalyst:create mcp-server: token-efficient MCP tools`
    - Dependencies: api, auth-security
  - [ ] `/catalyst:create query-tasks: GitHub 🔎 generated subtasks`
    - Dependencies: task-lifecycle
  - [ ] `/catalyst:create chat-bots: iMessage/Slack, webhooks, Actions hooks`
    - Dependencies: api
  - [ ] `/catalyst:create scoring-bakeoff: alternative engine and comparison report`
    - Dependencies: scoring-engine

### Wave 3.2

- [ ] `/catalyst:create ai-triage-assist: triage and autonomy-bounded execution`
  - Dependencies: mcp-server

## Run 4: Platform

### Pre-implementation

- [ ] **Re-evaluate blueprint via `/catalyst:blueprint`**

### Wave 4.1

- [ ] `/catalyst:create deploy-docs: Bicep/SWA workflow, runbook, API/MCP reference, e2e CI`
  - Dependencies: web-app, mcp-server

## Notes

- Supersedes PR 5. Product-level scenarios (next task, AI works the stack, capacity, capture, secure anywhere access) staged for `.xe/product.md` merge; owner to confirm.
- Toolchain: pnpm 11, Catalyst 0.3.0-dev tarball (PR 9).

## Vision Checkpoint

- [ ] Re-run `/catalyst:blueprint` when planned phases are implemented
