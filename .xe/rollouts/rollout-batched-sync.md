---
features: [storage-git, cli, live-deploy, web-shell]
status: in-progress
created: 2026-10-31
last_updated: 2026-10-31
---

<!-- markdownlint-disable no-duplicate-heading -->

# Rollout: batched-sync

## Active State

**Model**: Live mode works on the owner's real checkout (`~/dev/todo/tasks` on whatever branch is checked out). Writes land in files at once; one summarized commit per quiet stretch (5 min idle), on page hide, on `POST /api/sync`, on shutdown; pushed to origin when there is one. Phone access = push, so flush-on-hide closes the gap. All four specs are old-format and get a full format upgrade in Phase 1 before the new FRs go in.

**Decisions**:

- Batch commits with idle + hide + explicit flush — rejected per-write commits (noisy history, a round-trip per tap), daily commits (phone never sees the day), and a manual "cart" (burden on the owner)
- Live mode targets the checked-out branch, `main` included — rejected the `stack-web` worktree branch (two copies of the truth, owner merges by hand)
- Upgrade all four specs to the current template as part of this run — rejected touching only the changed scenarios (specs stay mixed)
- Add `web/src` to traceability code paths — rejected leaving web FRs "uncovered" by scanner config

**Open**:

- None

**Next**: Phase 1: run feature-format on storage-git, cli, live-deploy, web-shell (content verbatim, FR IDs kept), then add the new FRs per feature-spec; run `npx catalyst check` and `traceability` on each; commit each spec.

**Pins**:

- `src/core/storage-git.ts:148-190` — `lockedMany` (version check, `commit --only`, rollback); `push()` retry loop below it
- `src/cli/run.ts:395-424` — `web` command (`--live`, `prepareLive`, SIGINT wait); `src/cli/web.ts:63-77` `prepareLive` worktree (to replace), `:139` `new GitStorage(o.dir)`
- `src/api/handler.ts:693-700` — `GET /sync` route; `src/api/openapi.ts:171` its OpenAPI entry
- `web/src/App.tsx:335-348` — `run()` mutation wrapper (calls `refresh()` after every write); `:722-738` rail brand / `.who` footer / `.phone-brand`
- `web/e2e/mock.ts:153` — mock `/sync`
- `.xe/config/catalyst.json` — traceability paths (`src/` only)

**Assumptions**:

- The hosted app (live-deploy GitHubStorage) never batches, so `pending`/`since` are simply absent there and the chip never shows
- Agents run by `stack web` write through the same storage instance, so their edits batch too
- catalyst 0.3.3 playbooks match the 0.3.2 copies read at scope time (diff checked in Phase 1)

## Overview

The owner wants Stack to manage `todo/tasks/` directly (the files are the source of truth, edited in the app and in an editor), without a commit per tap and without losing a change made right before walking to the phone. This rollout adds a batched git adapter, points live mode at the real checkout, exposes pending/flush on `/api/sync`, and shows an `Unsaved · n` chip in the shell that saves on click and on hide. Execution mode: autonomous (branch `xe/batched-sync`, PR, pr-loop; owner merges).

Context: conversation with the owner on 2026-10-31 (risk of live mode; batching options); `docs/cli.md` and `README.md` describe the current `--live` worktree mode and need updating.

## Run 1: batched-sync

> **Execute**: `/catalyst:change storage-git cli live-deploy web-shell — batched live sync on the owner's real checkout`

### Pre-implementation

- [x] Update `@xerilium/catalyst` to 0.3.3 (0.3.2 CLI is broken: missing `check/runner`)
- [ ] Add `web/src/` to `.xe/config/catalyst.json` traceability code paths

### Features

#### storage-git

- [ ] Format upgrade (feature-format), then spec: `FR:batch` scenario (write now, pending, idle flush, flush, summary message, failure, close, events)
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Traceability

#### cli

- [ ] Format upgrade, then spec: `FR:web.live` (real checkout, current branch, `--branch` assert, remote), `FR:web.batch` (`--batch`, shutdown flush, startup line, pill)
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Traceability

#### live-deploy

- [ ] Format upgrade, then spec: `FR:sync.pending`, `FR:sync.flush`, `FR:web.unsaved`
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Traceability

#### web-shell

- [ ] Format upgrade, then spec: `FR:state.unsaved`
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Traceability

### Post-implementation

- [ ] Update `README.md` and `docs/cli.md` for the new live mode
- [ ] Designer screenshot loop on the chip (desktop + phone, light + dark)
- [ ] PR + `/catalyst:pr-loop`; report ready to the owner
- [ ] Route external issues discovered during implementation

## Notes

- Traceability 2026-10-31 (catalyst 0.3.3): storage-git 97%, cli 97%, live-deploy 74%, web-shell 0%. live-deploy `FR:web.*` and all web-shell FRs read as uncovered only because `.xe/config/catalyst.json` scans `src/` and not `web/src`; fixing the config is in Pre-implementation.
- Downstream impact (`catalyst deps --reverse`): none for all four features.
- Temporary files: hand-drafted spec edits in the four spec.md files and `tests/core/storage-batch.test.ts` existed before this rollout started; they are rewritten by Phase 1 and 3, not kept as-is.

## Final Review

- [ ] Confirm all runs complete — no unchecked tasks, no unresolved blockers in Notes
- [ ] Clean up temporary files and this rollout plan
- [ ] Close out — commit, PR, or defer
