# 0005: One writer path per store, one shared lock

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

- Many processes write: the Mac host, the CLI, MCP, the delivery loop, agents.
- Git writes are safe: an in-process queue, `stack-write.lock`, and version checks (`src/core/storage-git.ts:66`).
- Most live stores use `withFileLock` and `writeAtomic` (`src/core/file-lock.ts`).
- Some do not:
  - `DeliveryStore` has its own lock. Its takeover has no guard, and it blocks the event loop while it waits (`src/agents/delivery.ts:118-134`).
  - Six files hand-write "temp file, then rename".
- Each store with a watcher polls its file every 2 s and skips its own writes by hand (`src/cli/web.ts:323-337`).

## Decision

- Every live file has one store class. No other code writes the file.
- A read-modify-write store MUST use `withFileLock` and `writeAtomic`.
- A whole-file replace store MAY use `writeAtomic` with no lock (QM plan, sessions cache). The class comment MUST say so.
- No store has its own lock or temp-file code.
- Add one base class for a JSON file store: read, locked update, `onWrite`, `watch` with own-write skip.
- Agents write tasks with the CLI or MCP, not with plain git. Until the task store is live, the content repo lock is the only guard.

## Consequences

- One place to fix a lock bug.
- The host wiring loses its per-store watch code.
- Cost: `DeliveryStore.update` becomes async; its callers change.

## Evidence

- Lock copies: `src/core/file-lock.ts:19`, `src/agents/delivery.ts:118`, `src/email/runner.ts:52`.
- Atomic write copies: `delivery.ts`, `email/runner.ts`, `core/reports.ts:256`, `email/voice/store.ts:20`, `api/auth/tokens.ts:89`, `graph/auth.ts:220`.
