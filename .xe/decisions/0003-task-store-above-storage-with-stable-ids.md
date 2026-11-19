# 0003: Task store above storage, stable IDs first

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

- The task-store spec adds `TaskStore` with memory and Cosmos adapters.
- It says a store swap is an adapter, not a model change.
- Today that is not true. The seam is one level lower:
  - `Storage` reads and writes whole files by path (`src/core/storage.ts:27`).
  - `lifecycle.ts` edits markdown lines. A task ref is `{path, line}` (`src/core/lifecycle.ts:25`).
  - The API and the web app send those refs.
  - `Storage` has git-only methods: `lineActivity`, `commitSubjects`.
- Asks, agents, inbox and wake files also ride `Storage` by path pattern.

## Decision

Do the model change on markdown first. Add Cosmos last.

1. Give each task row a stable ID in markdown. No store change.
2. Change API, MCP, CLI and web refs from path and line to ID. Keep path and line as a fallback for one release.
3. Add `TaskStore` in `core` with a markdown adapter that wraps `lifecycle`. Callers use `TaskStore` only.
4. Run one contract suite on the markdown and memory adapters.
5. Add the Cosmos adapter. Then follow the spec: shadow, sandbox, cutover gates.

Also:

- `Storage` stays the file port for the markdown adapter. It is not the task port.
- Replace `lineActivity` and `commitSubjects` with an `Activity` port. Cosmos answers it from `updatedAt`.
- Asks, agents and inbox get their own small ports. They do not move to Cosmos in v1.
- Live state in `~/.stack` stays local in v1 (0004).

## Consequences

- Steps 1 to 4 need no Azure account and can ship one by one.
- Stable IDs fix broken refs today, before any cutover.
- The Cosmos PR becomes one adapter and one config flag.
- Cost: plan PR 6 ("store-surfaces") splits into three smaller PRs.
- Risk: agents that edit `tasks/*.md` by hand must keep the ID marker. `task-lint` must check it.

## Evidence

- `src/core/lifecycle.ts` (1,172 lines), 16 files import `Storage`.
- Task-store spec: "Architecture Constraints", `FR:write.surfaces`, `FR:cutover`.
