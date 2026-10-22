---
id: storage-git
title: Task Storage (Git)
description: Storage interface for task files with byte-exact reads, atomic writes, git direct-commit adapter, conflict handling, and in-memory/filesystem adapters
dependencies: [task-parser]
---

<!-- markdownlint-disable single-title -->

# Feature: Task Storage (Git)

## Purpose

Give every surface one way to list, read, and write task markdown files, with git as the source of truth, so edits land as direct commits (no PRs) and concurrent edits never silently overwrite each other.

## Scenarios

### FR:interface: Storage interface

Surfaces need a backend-neutral contract so they work the same on git, disk, or memory.

- **FR:interface.@type** (P1): Interface: `Storage { list(): Promise<string[]>; read(path): Promise<StoredFile>; write(path, content, opts?): Promise<WriteResult> }`
- **FR:interface.list** (P1): `list` MUST return sorted repo-relative paths of `tasks/*.md` files
- **FR:interface.read** (P1): `read` MUST return the exact content and an opaque `version` token, and throw `NotFoundError` when the file is missing
- **FR:interface.bytes** (P1): Content MUST round-trip byte-exact (BOM, CRLF, trailing whitespace, emoji) with no normalization. Content is UTF-8 text: invalid UTF-8 sequences or lone surrogates are not byte-exact (replaced on decode/encode)
- **FR:interface.paths** (P1): Adapters MUST reject paths that are absolute, contain `..`, backslashes, or NUL, or fall outside `tasks/*.md` (dotfiles such as `tasks/.x.md` are outside, matching `list`), with `PathError`
- **FR:interface.version** (P1): `version` MUST be derived from content only, identical across adapters

### FR:write: Atomic writes

- **FR:write.atomic** (P1): Writes MUST be atomic: a reader never sees partial content, and a failed write leaves the prior content intact
- **FR:write.expected** (P1): When `opts.expectedVersion` is given (`null` meaning the file must not exist), `write` MUST throw `ConflictError` if the current version differs
- **FR:write.result** (P1): `write` MUST return the new `version`
- **FR:write.serial** (P2): Writes through one adapter instance MUST be serialized

### FR:git: Git adapter

- **FR:git.commit** (P1): `GitStorage.write` MUST create one direct commit containing only the written path, with `opts.message` or a default message
- **FR:git.noop** (P2): A write whose content equals the current content MUST NOT create a commit
- **FR:git.isolation** (P1): Unrelated dirty or staged files in the work tree MUST NOT be committed or lost, and MUST keep their staged/unstaged state across remote sync (stash + `stash apply --index`, no `--autostash`)
- **FR:git.remote** (P1): With a remote configured, `write` MUST sync (fetch + rebase) before checking the version, and push after committing
- **FR:git.push-retry** (P1): When the push is rejected as non-fast-forward, `write` MUST fetch, rebase, and retry (max 3 attempts). Other push failures (auth, network, hook rejection) MUST NOT be retried: roll back the commit and throw `StorageError`
- **FR:git.conflict** (P1): When rebase conflicts or the retried version check fails, `write` MUST abort the rebase, drop its own commit (tracked by SHA across rebases, via soft reset plus path-limited restore so unrelated staged files survive), leave the work tree clean, and throw `ConflictError`. A write overwrites any earlier uncommitted edit to the same path (it is restored to the remote version on conflict)
- **FR:git.failure** (P1): Non-conflict git failures (lock files, hooks, non-rejection push errors) and failed re-apply of locally stashed changes MUST throw `StorageError`, not `ConflictError`; a failed commit MUST roll back the path while keeping the user's own staged edit of it. A failed post-rollback resync MUST NOT mask the original error
- **FR:git.branch** (P1): With a remote or explicit `branch`, `write` and `sync` MUST throw `StorageError` when the configured branch is not checked out
- **FR:git.concurrency** (P2): Serialization is per adapter instance; multiple instances or processes on one repo are unsupported (may fail on `index.lock` with `StorageError`)
- **FR:git.exec** (P1): Git MUST run via argument arrays (no shell)

### FR:fs: Filesystem and memory adapters

- **FR:fs.fs** (P1): `FsStorage` MUST implement the interface on a directory with write-to-temp then rename
- **FR:fs.memory** (P1): `MemoryStorage` MUST implement the interface in memory for tests

## Data Model

- **FR:$stored-file** (P1): **`StoredFile`** — `{ path, content, version }`
- **FR:$write-opts** (P1): **`WriteOptions`** — `{ expectedVersion?: string | null; message?: string }`
- **FR:$errors** (P1): `StorageError` base; `NotFoundError`, `ConflictError`, `PathError`

## Architecture Constraints

- Core module `src/core/storage.ts` (interface, errors, memory/fs adapters); git adapter `src/core/storage-git.ts`.
- Node built-ins only (`fs`, `child_process`, `crypto`); requires `git` on PATH.

## External Dependencies

git CLI
