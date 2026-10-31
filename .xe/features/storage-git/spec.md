---
id: storage-git
title: Task Storage (Git)
description: One storage contract for task files; adapters for memory, disk, git direct commits, and batched git commits
dependencies: []
---

<!-- markdownlint-disable single-title -->

# Feature: Task Storage (Git)

## Purpose

Give every surface one way to list, read, and write task markdown files, with git as the source of truth, so edits land as direct commits (no PRs) and concurrent edits never silently overwrite each other.

## Scenarios

### FR:interface: Storage interface

Stack System needs a backend-neutral contract for task files so that every surface works the same on git, disk, or memory.

- **FR:interface.@type** (P1): Interface: `Storage { list(): Promise<string[]>; read(path): Promise<StoredFile>; write(path, content, opts?): Promise<WriteResult> }`
- **FR:interface.list** (P1): `list` MUST return sorted repo-relative paths of `tasks/*.md` files
- **FR:interface.read** (P1): `read` MUST return the exact content and an opaque `version` token (@req FR:$stored-file)
  - **FR:interface.read.missing** (P1): `read` MUST throw `NotFoundError` when the file is missing
- **FR:interface.bytes** (P1): Content MUST round-trip byte-exact (BOM, CRLF, trailing whitespace, emoji) with no normalization
  - Content is UTF-8 text: invalid UTF-8 sequences or lone surrogates are not byte-exact (replaced on decode/encode)
- **FR:interface.paths** (P1): Adapters MUST reject paths that are absolute, contain `..`, backslashes, or NUL, or fall outside `tasks/*.md` and the summary files `README.md`, `stack.md`, `projects.md`, `my-day.md`, with `PathError`
  - Dotfiles such as `tasks/.x.md` are outside, matching `list`
- **FR:interface.version** (P1): `version` MUST be derived from content only, identical across adapters

### FR:write: Atomic writes

Stack System needs writes that either land whole or not at all so that a reader never sees a torn file and a stale writer never overwrites a newer edit.

- **FR:write.input** (P1): Path (string), content (string), options (@req FR:$write-opts)
- **FR:write.atomic** (P1): Writes MUST be atomic: a reader never sees partial content, and a failed write leaves the prior content intact
- **FR:write.expected** (P1): When `opts.expectedVersion` is given (`null` meaning the file must not exist), `write` MUST throw `ConflictError` if the current version differs
- **FR:write.result** (P1): `write` MUST return the new `version`
- **FR:write.many** (P1): Optional `writeMany(writes, opts?)` MUST write several files atomically as one operation (@req FR:$file-write)
  - **FR:write.many.check** (P1): `writeMany` MUST check every `expectedVersion` first; any mismatch throws `ConflictError` and nothing is written
  - **FR:write.many.rollback** (P1): A failure MUST roll every file back
  - **FR:write.many.commit** (P1): `GitStorage` MUST make ONE commit for all changed paths, pushing once
  - **FR:write.many.duplicates** (P2): `writeMany` MUST reject duplicate paths
  - **FR:write.many.fallback** (P2): `writeAll(storage, writes, message)` MUST fall back to sequential `write` for adapters without `writeMany`
- **FR:write.delete** (P2): In `writeMany`, a `FileWrite` with `content: null` MUST delete that path in the same atomic operation (version checked first, rolled back with the rest, part of the one commit in `GitStorage`)
  - **FR:write.delete.fallback** (P2): `writeAll` MUST reject a delete for adapters without `writeMany`
- **FR:write.serial** (P2): Writes through one adapter instance MUST be serialized
- **FR:write.output** (P1): WriteResult `{ version }`

### FR:git: Git adapter

Stack System needs every write to be a direct commit on the task repo so that history is the audit trail and two writers (local and remote) reconcile through git.

- **FR:git.@function** (P1): Interface: `new GitStorage(root, { remote?, branch?, env? })`, implements `Storage` with `writeMany` and `sync()`
- **FR:git.commit** (P1): `GitStorage.write` MUST create one direct commit containing only the written path, with `opts.message` or a default message
- **FR:git.noop** (P2): A write whose content equals the current content MUST NOT create a commit
- **FR:git.isolation** (P1): `GitStorage` MUST NOT commit or lose unrelated dirty or staged files in the work tree
  - **FR:git.isolation.state** (P1): `GitStorage` MUST keep their staged/unstaged state across remote sync (stash + `stash apply --index`, no `--autostash`)
- **FR:git.remote** (P1): With a remote configured, `write` MUST sync (fetch + rebase) before checking the version, and push after committing
- **FR:git.push-retry** (P1): When the push is rejected as non-fast-forward, `write` MUST fetch, rebase, and retry (max 3 attempts)
  - **FR:git.push-retry.other** (P1): Other push failures (auth, network, hook rejection) MUST NOT be retried: roll back the commit and throw `StorageError`
- **FR:git.conflict** (P1): When rebase conflicts or the retried version check fails, `write` MUST abort the rebase, drop its own commit (tracked by SHA across rebases, via soft reset plus path-limited restore so unrelated staged files survive), leave the work tree clean, and throw `ConflictError`
  - A write overwrites any earlier uncommitted edit to the same path (it is restored to the remote version on conflict)
- **FR:git.failure** (P1): Non-conflict git failures (lock files, hooks, non-rejection push errors) and failed re-apply of locally stashed changes MUST throw `StorageError`, not `ConflictError`
  - **FR:git.failure.rollback** (P1): A failed commit MUST roll back the path while keeping the user's own staged edit of it
  - **FR:git.failure.mask** (P1): A failed post-rollback resync MUST NOT mask the original error
- **FR:git.branch** (P1): With a remote or explicit `branch`, `write` and `sync` MUST throw `StorageError` when the configured branch is not checked out
- **FR:git.concurrency** (P2): Serialization is per adapter instance; multiple instances or processes on one repo MAY fail on `index.lock` with `StorageError`
- **FR:git.env** (P1): `GitStorage` MUST take an optional base environment for spawned git (default `process.env`) and never mutate the process environment
- **FR:git.exec** (P1): Git MUST run via argument arrays (no shell)

### FR:batch: Batched commits

Owner needs edits from the app to land in the checked-out task files at once and be committed in quiet stretches so that the files stay the single source of truth and the history reads as sessions, not taps.

- **FR:batch.@function** (P1): Interface: `new BatchedGitStorage(root, { idleMs?, remote?, branch?, env?, onError? })` extends `GitStorage` with `pending(): Pending`, `flush(): Promise<string | null>`, `onPending(fn): () => void`, `close(): Promise<void>`
- **FR:batch.input** (P1):
  - Writes as `GitStorage` takes them (@req FR:$write-opts, FR:$file-write)
  - Idle time `idleMs` (number) — quiet milliseconds before a commit. Default: 300000
- **FR:batch.write** (P1): `BatchedGitStorage` MUST write the file at once, under the same path, atomicity, and symlink rules as `FsStorage`, and make no commit
  - **FR:batch.write.expected** (P1): `BatchedGitStorage` MUST check `expectedVersion` against the work-tree content (pending writes included) and throw `ConflictError` with nothing written on a mismatch
  - **FR:batch.write.pending** (P1): `BatchedGitStorage` MUST add the write's paths and message to the pending batch
  - **FR:batch.write.noop** (P2): `BatchedGitStorage` MUST leave a write whose content equals the current file content out of the batch
  - **FR:batch.write.many** (P1): `writeMany` MUST join the batch as one write covering all of its paths
- **FR:batch.pending** (P1): `pending()` MUST answer the pending writes (@req FR:$pending), with a count of 0 and no `since` when nothing is pending
- **FR:batch.idle** (P1): `BatchedGitStorage` MUST flush on its own `idleMs` after the last pending write; each write restarts the timer
  - **FR:batch.idle.zero** (P1): With `idleMs` 0, `BatchedGitStorage` MUST flush after every write
  - **FR:batch.idle.close** (P1): `close()` MUST flush what is pending and stop the timer
  - **FR:batch.idle.error** (P2): A timer flush that fails MUST be reported to `onError` (dropped when none is given); the batch stays pending
- **FR:batch.flush** (P1): `flush()` MUST make one commit containing only the pending paths (`commit --only`), leaving the owner's other dirty files uncommitted
  - **FR:batch.flush.subject** (P1): The commit subject MUST read `Stack: <verb> <n>, …`, one entry per verb in first-seen order, built from each pending message's leading verb in past tense: `Complete` → done, `Suspended until` → deferred, `Add task`/`Add project` → added, `Edit` → edited, `Move` → moved, `Note` → noted, `Start` → started, `Park` → parked, `Resume` → resumed, `Update` → updated, `Remove` → removed, `Roll` → rolled, `Due` → due, `Ask …` → asked; any other message counts under `other`
    - A batch with no recognized verb reads `Stack: <n> changes` (`1 change`)
  - **FR:batch.flush.body** (P2): The commit body MUST list every pending message on its own line, in order
  - **FR:batch.flush.remote** (P1): With a remote, `flush()` MUST commit first, then fetch and rebase onto the remote, then push with the `FR:git.push-retry` retry (a rebase conflict aborts cleanly and the written files stay)
  - **FR:batch.flush.empty** (P1): `flush()` MUST make no commit and return `null` when nothing is pending or the pending content equals HEAD
  - **FR:batch.flush.output** (P1): The new commit sha (string), or `null`
- **FR:batch.failure** (P1): A failed flush (commit, rebase conflict, push) MUST keep the files as written and the batch pending, leave no rebase or extra commit behind, and throw `ConflictError` or `StorageError` as `FR:git.conflict` and `FR:git.failure` do
  - **FR:batch.failure.retry** (P1): The next write or `flush()` MUST try again, with the idle timer restarted
- **FR:batch.events** (P2): `onPending` MUST call its listener with the new count each time the pending count changes
- **FR:batch.reads** (P1): `read` MUST return the work-tree content, so pending writes are visible at once to every reader of the checkout (the owner's editor included)

### FR:fs: Filesystem and memory adapters

Stack System needs the same contract on a plain directory and in memory so that copies without git and tests work the same way.

- **FR:fs.fs** (P1): `FsStorage` MUST implement the interface on a directory with write-to-temp then rename
- **FR:fs.contain** (P1): `FsStorage` MUST refuse any symlink on a storage path (read, write, list) with `StorageError`, so a tracked link cannot read or write outside the work tree
- **FR:fs.memory** (P1): `MemoryStorage` MUST implement the interface in memory for tests

## Data Model

- **FR:$stored-file** (P1): **`StoredFile`** — One file as read.
  - `path` (string) — repo-relative
  - `content` (string) — exact bytes as UTF-8 text
  - `version` (string) — content hash, identical across adapters
- **FR:$write-opts** (P1): **`WriteOptions`**
  - `expectedVersion` (string | null?) — the version the writer read; `null` means the file must not exist
  - `message` (string?) — commit message for git adapters
- **FR:$file-write** (P1): **`FileWrite`** — One file in a multi-file write.
  - `path` (string)
  - `content` (string | null) — `null` deletes the path
  - `expectedVersion` (string | null?)
- **FR:$pending** (P1): **`Pending`** — What a batched adapter has not committed yet.
  - `count` (number) — pending writes (a `writeMany` counts once)
  - `since` (Date | null) — time of the first pending write
  - `paths` (string[]) — distinct pending paths in first-write order
- **FR:$errors** (P1): **`StorageError`** base; **`NotFoundError`**, **`ConflictError`**, **`PathError`** extend it

## Architecture Constraints

- Core module `src/core/storage.ts` (interface, errors, memory/fs adapters); git adapter `src/core/storage-git.ts`; batched adapter `src/core/storage-batch.ts`.
- Node built-ins only (`fs`, `child_process`, `crypto`); requires `git` on PATH.
- Optimistic concurrency uses the content-hash `version`, never a git sha, so adapters match (design-decisions.md).

## External Dependencies

git CLI
