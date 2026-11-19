# 0006: Local host runs in the Electron main process

- **Status**: Accepted (records the current state)
- **Date**: 2026-11-19

## Context

- The host spawns agents with `child_process` and needs their stdin.
- Electron `utilityProcess` has no stdin.
- The shell and the host share one process today (`desktop/src/host.ts`).

## Decision

- Keep the host in the Electron main process.
- `desktop/src/main.ts` stays the only file that imports `electron`.
- The shell owns the lifecycle in this order: instance lock, login `PATH`, host start, window, tray.
- Quit order: stop timers, close the host (flush the batch, 15 s limit), then start the update helper.
- A host that cannot start MUST tell the owner why, then quit (`FR:desktop-shell/host.fail.show`).
- The host MUST NOT hold unsaved task edits in memory. Edits go to disk first; only the commit is batched.

## Consequences

- One process to start, stop and update. Simple.
- A crash in the host ends the window too. A relaunch is the recovery.
- Because edits are on disk before the commit, a crash loses no edit.
- To add later: log to a file under `stackHome()`, and handle `render-process-gone` and `did-fail-load` with one reload.

## Evidence

- `desktop/src/shell.ts:146-176`, `.xe/features/desktop-shell/spec.md` (`FR:host.*`, `FR:quit.*`), `src/core/storage-batch.ts`.
