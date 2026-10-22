# Plan: storage-git

## Approach

- `storage.ts`: `Storage` interface, error classes, `validatePath`, `versionOf` (sha256 hex of UTF-8 bytes), `MemoryStorage`, `FsStorage` (temp file in same dir + rename; write chain serializes).
- `storage-git.ts`: `GitStorage extends FsStorage`-style wrapper. Write flow under the serial queue: sync (fetch + `rebase --autostash` if remote) -> version check -> atomic write -> `git add` + `git commit --only -- path` -> push; on rejection fetch/rebase/retry up to 3; on conflict abort rebase, reset own commit, throw `ConflictError`.
- Content is handled as UTF-8 strings; decoding preserves BOM and CRLF.

## Tests (written first)

Real temp git repos (plus a bare remote and a second clone) under `os.tmpdir()`: interface contract run against all three adapters; git-specific commit, isolation, noop, remote push, divergent rebase, true conflict, retry.

## Decisions

- Optimistic concurrency via content-hash `version`, not git SHAs, so adapters match.
- Conflict never leaves a half-applied state.
