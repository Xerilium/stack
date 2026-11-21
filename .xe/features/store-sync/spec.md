---
id: store-sync
title: Task store sync with main
author: flanakin
description: The host merges the remote main branch into the live branch on start and every few minutes, aborts cleanly on a conflict, and shows the drift in the app and in `stack doctor`
dependencies: [storage-git, ui-kit, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: Task store sync with main

## Purpose

Owner needs the live branch (`stack/live`) to keep up with the tasks that agents and he push to `main` so that the app never shows a stale list without saying so.

## Scope

- In: a merge of `<remote>/main` into the checked-out live branch by the local host (`stack web --live` and the desktop app), the drift state on `GET /api/sync`, a banner in the app, and `stack doctor`.
- Out: merging the live branch back into `main`, the hosted (GitHub API) storage, and conflict resolution. A conflict is for the owner to fix by hand.

## Scenarios

### FR:merge: Merge main into the live branch

Owner needs every commit on main to reach the live branch without a rebase or a force so that no app write and no main commit is lost.

- **FR:merge.@function** (P1): Interface: `GitStorage.mergeFrom(base): Promise<DriftState | null>` and `GitStorage.drift(base, { fetch? }): Promise<DriftState | null>` (@req FR:$drift-state)
- **FR:merge.skip** (P1): Both MUST answer `null` when the storage has no remote or the live branch is `base`
- **FR:merge.fetch** (P1): Both MUST fetch `<remote>/<base>` first; `drift` skips the fetch when `fetch` is `false`
  - **FR:merge.fetch.offline** (P1): A failed fetch MUST change nothing and answer `offline`, with `behind` from the last fetched ref (0 when there is none)
- **FR:merge.ok** (P1): With `HEAD` not behind `<remote>/<base>`, both MUST answer `ok` and change nothing
- **FR:merge.check** (P1): Before a merge, both MUST find the conflicting files with `git merge-tree --write-tree`, which changes no file and no ref
  - **FR:merge.check.conflict** (P1): Conflicting files MUST answer `conflict` with the files, and `mergeFrom` MUST NOT start the merge
- **FR:merge.dirty** (P1): An uncommitted or untracked file in the work tree that `<base>` also changed MUST answer `blocked` with those files, and `mergeFrom` MUST NOT start the merge
  - Uncommitted app writes (a pending batch) are such files until the batch commits
  - **FR:merge.dirty.paths** (P1): Paths MUST be compared with renames off and NUL-separated, so a file main renames or a non-ASCII name still blocks
  - **FR:merge.dirty.staged** (P1): A staged file MUST also answer `blocked` with the staged files, since git merges only when the index matches `HEAD`
- **FR:merge.behind** (P1): Else `drift` MUST answer `behind` (a merge would be clean) and change nothing
- **FR:merge.run** (P1): Else `mergeFrom` MUST run `git merge --no-ff --no-edit <remote>/<base>` (a merge commit, so a later sync rebase keeps the base commits as they are; no rebase, no force) and answer `merged` with `behind` 0
  - **FR:merge.run.keep** (P1): Uncommitted files that `<base>` did not change MUST stay as they were, staged state included
  - **FR:merge.run.abort** (P1): A merge that fails anyway MUST be aborted (`git merge --abort` when a merge is in progress), leave `HEAD`, the index and the work tree as before, and answer `conflict` with the unmerged files, or `error` with the message when no file is unmerged (a hook, a lock)
- **FR:merge.push** (P1): After a merge, `mergeFrom` MUST push the live branch to the remote once, without force; a failed push MUST NOT undo the merge (the next flush pushes it) and sets `message`
- **FR:merge.live** (P1): Before it merges the base, `mergeFrom` MUST bring in `<remote>/<live branch>` the same way (checks first, fast-forward allowed), so the push after the merge is a fast-forward
  - **FR:merge.live.keep** (P1): When `HEAD` holds an unpushed merge commit, a `GitStorage` sync MUST merge `<remote>/<live branch>` instead of rebasing onto it, so the merge and main's commits stay as they are
- **FR:merge.lock** (P1): `mergeFrom` MUST run in the storage write queue under `stack-write.lock` (`FR:storage-git/git.concurrency`)

### FR:host: Host loop

Owner needs the host to merge on its own so that drift never waits for him to notice it.

- **FR:host.@function** (P1): Interface: `startStoreSync(storage, { base?, intervalMs?, onState? }): { state(): DriftState | null; tick(): Promise<DriftState | null>; stop(): Promise<void> }` (`stop` waits for a tick in flight)
- **FR:host.input** (P1):
  - Base branch `base` (string). Default: `main`
  - Interval `intervalMs` (number). Default: 180000
- **FR:host.start** (P1): The loop MUST tick once at start and every `intervalMs` after, one tick at a time
- **FR:host.flush** (P2): When a tick answers `blocked` and the storage batches commits with writes pending, the tick MUST flush the batch and merge once more
  - **FR:host.flush.fail** (P2): A failed flush MUST keep the `blocked` state and its files, with the flush error as `message`
- **FR:host.errors** (P1): A tick that throws MUST keep running the loop and answer `error` with the message
- **FR:host.event** (P2): `onState` MUST hear each new state
- **FR:host.wire** (P1): `startWeb` MUST start the loop for a storage with `mergeFrom`, and stop it on close
  - **FR:host.wire.demo** (P1): A demo copy (`info.mode` `demo`) or `storeSync: false` MUST run no loop
- **FR:host.api** (P1): `GET /api/sync` MUST add `drift` (@req FR:$drift-state) when the host runs the loop and it has a state
- **FR:host.event.page** (P2): A new state MUST tell open pages (`change`, kind `sync`) so the banner shows without a reload

### FR:banner: Drift banner

Owner needs a clear warning when the live branch cannot keep up with main so that he fixes it before he trusts the list.

- **FR:banner.component** (P1): `DriftBanner` (ui-kit) MUST show nothing unless the state is `conflict`, `blocked` or `error`
- **FR:banner.text** (P1): The banner MUST read `Task store out of sync with <base branch>: <n> commit(s) behind` (`main`, or the live branch when its own remote copy is what conflicts), then the files (`Conflicts: a, b` or `Uncommitted: a, b`), or the error message
- **FR:banner.role** (P1): The banner MUST be a `role=alert` region
- **FR:banner.app** (P1): The app MUST show the banner at the top of the main pane from the `drift` of `GET /api/sync`

### FR:doctor: Doctor command

Owner and agents need the same drift state from the terminal so that a check does not need the app.

- **FR:doctor.@cli** (P1): Interface: `stack doctor [--json]`
- **FR:doctor.check** (P1): `doctor` MUST fetch and answer `drift` for the repo's current branch against `main` on `--remote` (default `origin`)
- **FR:doctor.text** (P1): Text MUST be one line per check: `store: ok (in sync with origin/main)`, `store: <state> (<n> behind origin/main)`, or `store: skipped (<reason>)`
  - **FR:doctor.text.files** (P1): Files and messages MUST follow on indented lines: `  Conflicts: a, b`, `  Uncommitted: a, b`, `  <message>`
  - **FR:doctor.text.skip** (P2): The reasons are `on main` and `no remote <name>`
- **FR:doctor.exit** (P1): Exit MUST be 1 for `conflict`, `blocked` or `error`, else 0
- **FR:doctor.readonly** (P1): `doctor` MUST NOT merge or change the work tree

## Data Model

- **FR:$drift-state** (P1): **`DriftState`**
  - `base` (string) — the remote ref, e.g. `origin/main`
  - `state` (`ok` | `behind` | `merged` | `conflict` | `blocked` | `offline` | `error`)
  - `behind` (number) — commits on the base that the live branch does not have
  - `files` (string[]) — conflicting or blocking files; empty otherwise
  - `at` (string) — ISO time of the check
  - `message` (string?) — an error or a failed push

## Architecture Constraints

- Merge and drift logic is in `GitStorage` (`src/core/storage-git.ts`) so it shares the git runner, queue and lock. The loop is `src/core/store-sync.ts`.
- `git merge-tree --write-tree` needs git 2.38 or later.
- Never stash, reset, rebase or force for this sync.

## External Dependencies

git CLI 2.38+
