# Plan: Priority-first ranking

1. Pure core in `src/core/pris-rank.ts`: `priAction(pri)` parses the newest note; `priActions(pris)` returns one `PriAction` per priority; `priFirst(rows, link)` puts linked rows first by rank, stable, unlinked last.
2. Lifecycle: `LifecycleContext.pris?: () => Pri[]`. `rankDocs` runs `priFirst` before `applyOverrides`. The rank memo key holds the priorities, so a new note never reuses an old order.
3. CLI: `buildCtx` reads `PriStore` (missing or invalid file: no priorities). `next` and `rank` (default `stack` engine) put the action rows first. An explicit `--engine autopri|pris` keeps the engine order for bake-offs.
4. Explain: `explainStack` adds `serves=` for linked rows and action rows; JSON adds `link`.
5. API: the handler passes `deps.pris` to the lifecycle context. `/rank` and `/next` return task rows only (Home renders tasks).
6. Day order: `pris.ts` accepts `slot` and `days`; `priOrder(pris, at, tz)` sorts by the weekday slot, else `slot`, else the file position, and drops `off`. `dayPris(ctx, at)` feeds every ranking path. `stack pris put --file` replaces the list.
7. Daily goal: `dailyGoal(ctx, at)` names each project's first ranked task and checks `lineActivity` for a checked row changed today. `next --daily`, `rank --daily`, `GET /rank?daily=1`; Home shows `done today` or `not yet today` per project row.
8. Tests first: `tests/core/pri-first.test.ts` (parse, order) and `tests/cli/pri-first.test.ts` (12-priority fixture with the 2026-11-17 notes, blog backlog and sweep rows).

Not in scope: README and `stack.md` summaries keep the engine order.
