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
- Add `web/src`, `web/tests`, `web/e2e` to traceability paths — rejected leaving web FRs "uncovered" by scanner config
- Flush commits before it rebases — rejected rebase-then-commit (stash conflict would `reset --hard` the pending files)

**Open**:

- None

**Next**: Phase 3 TDD: rewrite `tests/core/storage-batch.test.ts` (red), then `src/core/storage-batch.ts`; then cli, api, web per the Features tasks.

Phase 1 done: all four specs on the current template, `catalyst check` clean, `catalyst deps` clean (storage-git now has no upstream deps; web-shell gained agent-sessions and live-deploy). Commits 854e7c1, 56946dc, 149dcd9, d8d656a. New nested FR ids from the format split (e.g. `git.isolation.state`, `write.many.check`) need `@req` tags on existing code/tests in Phase 3.

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
- [x] Add `web/src/`, `web/tests/`, `web/e2e/` to `.xe/config/catalyst.json` traceability paths

### Features

#### storage-git

- [x] Spec: FR:batch (@function, input, write.*, pending, idle.*, flush.*, failure.*, events, reads), $file-write, $pending; format split ids
- [ ] Tests (red): rewrite `tests/core/storage-batch.test.ts` to the spec verb map, soft-reset expectations, wider idle timings; add onPending unsubscribe, expectedVersion null, delete in writeMany, push-rejected retry (`beforePush`), non-rejection push failure, failure.retry, close stops timer, read sees pending, onError
- [ ] Tests: add nested `@req` ids to existing tests in `tests/core/storage.test.ts` (interface.read.missing, write.many.check/rollback/commit/duplicates/fallback, write.delete.fallback, $file-write, git.isolation.state, git.push-retry.other, git.failure.rollback/mask, $errors)
- [ ] Code: `FsStorage.putAll`; `GitStorage` protected `git/tryGit/remote/branch/checkBranch/fetch/rebase`, extract `stage()` and `pushRetry()`; new `src/core/storage-batch.ts` (`BatchedGitStorage`, `batchSummary`); `@req` on code
- [ ] `pnpm exec jest tests/core` green; traceability storage-git 100%

#### cli

- [ ] Tests (red): replace `prepareLive` block in `tests/cli/web.test.ts` (real checkout on main, --branch mismatch, detached HEAD, non-repo, startWeb with BatchedGitStorage idleMs 0 and large + close, GET/POST /api/sync through startWeb, `liveLine` with/without remote and batch 0); discover test for `remote`/`batch` keys
- [ ] Code: `prepareLive(repo, branch?)` → `{ dir, branch, remote? }`; `WebOpts.storage`; `startWeb.close()` awaits `storage.close()`; `web()` `--batch`, `liveLine`; COMMANDS usage/help; `userConfig` type; `docs/cli.md`, `README.md`
- [ ] `pnpm exec jest tests/cli` green; traceability cli 100% (annotate web.serve.*, web.demo.*, run.git.worktree, run.help.version, ref.format/invalid, cmd.update.*, parity.script on existing tests/code)

#### live-deploy

- [ ] Tests (red): new `tests/api/sync.test.ts` (pending/since on GET, absent for plain storage, POST owner → flushed/rev, nothing pending → 0, token/anonymous → 403, ConflictError → 409 with message, StorageError → 500 with message, batch kept); `tests/api/openapi.test.ts` parity line for `sync.flush`
- [ ] Code: `batchOf()` duck-typing in handler, GET extension, POST route; `openapi.ts` schemas; `pnpm openapi`
- [ ] Tests (red, web): `web/tests/unsaved.test.ts` controller (count/since, absent → 0, flush saving + re-read, error keeps count, hidden+pending → keepalive post, hidden+0 → none, visible → check, pagehide → post, stop); `web/tests/api.test.ts` syncState/flush keepalive; `web/e2e/unsaved.spec.ts` (chip text/tooltip, click → Saving… → gone + POST, re-read after a task action, absent without pending, failed flush keeps chip + toast)
- [ ] Code: `api.ts` syncState/flush; `web/src/unsaved.ts`; `App.tsx` check in refresh + chip; `styles.css`; `mock.ts` pending/since/POST
- [ ] Traceability live-deploy 100% (annotate gh.*, setup.*, NFRs: documented skips where not automatable)

#### web-shell

- [ ] Tests (red): `web/e2e/unsaved.spec.ts` chip placement (rail footer desktop, phone header mobile), `Live · main` pill + brand `Stack` under a live `/.auth/me`
- [ ] Code: pill + chip placement in `App.tsx`, `.phone-brand` flex row
- [ ] Traceability web-shell 100% (move file-level `@req` to test cases in `web/tests`/`web/e2e`; annotate split ids)

### Post-implementation

- [ ] Update `README.md` and `docs/cli.md` for the new live mode
- [ ] Designer screenshot loop on the chip (desktop + phone, light + dark)
- [ ] PR + `/catalyst:pr-loop`; report ready to the owner
- [ ] Route external issues discovered during implementation

## Notes

- Spec clarifications from the planning critique (autonomous mode, auto-approved): storage-git `batch.flush.remote` now says commit first, then fetch/rebase/push (a pre-commit rebase would stash the pending files and a stash conflict runs `reset --hard`, destroying them); `batch.@function` gains `onError` and `batch.idle.error` (a timer flush has no caller to throw to); cli `web.batch.startup` says `committed on every edit` for `--batch 0`; live-deploy `$flush-result.rev` is the flush's commit sha.
- Out of scope, noted: cli `FR:web.demo.pill` (`Demo copy · <branch>`) is specified but not implemented and home3.spec asserts no pill in demo; left as is.

### Planning record

- **Approach**: `BatchedGitStorage extends GitStorage`; `FsStorage.putAll` extracted so the batch adapter can write + version-check without `GitStorage.lockedMany`'s commit; `GitStorage` exposes `stage()` and `pushRetry()` (protected) so flush reuses the commit --only and push-retry machinery; flush runs on the same serial queue as writes (`enqueue`), timer `unref`'d; undo on failure = `reset --soft <sha>^` + `reset -- paths` (files stay written, unstaged). CLI: `prepareLive(repo, branch?)` validates the real checkout (no worktree); `WebOpts.storage` injection; `close()` flushes. API: duck-typed `pending()/flush()` on the storage; explicit ConflictError/StorageError → 409/500 with message. Web: `createUnsaved()` controller (same shape as `connectLive`) + `useUnsaved` hook; `refresh()` triggers `check()` so own writes and change events both re-read.
- **Planning subagent**: Claude Code `Plan` agent (read-only), 28 tool uses.
- **Critique**: engineering (KISS: reuse over copy; YAGNI: no new events channel, pending read piggybacks on `refresh`), architecture (handler never imports an adapter; API route shared by local and host), spec consistency (four clarifications above), test feasibility (hide/pagehide covered in vitest, not Playwright; idle timings widened for real git).
- **Traceability**: 68/68 in-scope FRs mapped to a test file and a code file (table in the planner output, folded into the Features tasks); 7 `@req` deps verified (`catalyst deps` clean). Gaps: none.

- Traceability 2026-10-31 (catalyst 0.3.3): storage-git 97%, cli 97%, live-deploy 74%, web-shell 0%. live-deploy `FR:web.*` and all web-shell FRs read as uncovered only because `.xe/config/catalyst.json` scans `src/` and not `web/src`; fixing the config is in Pre-implementation.
- Downstream impact (`catalyst deps --reverse`): none for all four features.
- Temporary files: hand-drafted spec edits in the four spec.md files and `tests/core/storage-batch.test.ts` existed before this rollout started; they are rewritten by Phase 1 and 3, not kept as-is.

## Final Review

- [ ] Confirm all runs complete — no unchecked tasks, no unresolved blockers in Notes
- [ ] Clean up temporary files and this rollout plan
- [ ] Close out — commit, PR, or defer
