---
id: query-tasks
title: Query Tasks Plan
---

# Plan: Query Tasks

## Approach

One module, `src/core/query-tasks.ts`: pure text transform (`expandQueryTasks`) over an injectable `QueryClient`, plus a thin `refreshQueryTasks` over `Storage` and a `gh`-backed client. Port of legacy `Update-StackQueryTasks.ps1`.

## Contracts

- `findQueryTriggers`, `expandQueryTasks`, `refreshQueryTasks`, `createGhClient`, `QueryClient`

## Decisions

- Compute the whole new content before touching anything; every trigger runs in its own try/catch and only a fully validated result is applied, so a failure cannot lose data
- Triggers are processed bottom-up so earlier line indexes stay valid
- Lines are split keeping their own endings (CRLF safe)
- `gh` is run with `execFile`-style args (no shell); exec is injected
- Tests: fakes only, in `tests/core/query-tasks.test.ts`
