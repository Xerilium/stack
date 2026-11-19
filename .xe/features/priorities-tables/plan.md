# Plan: Priorities report

Base: PR 179 (`xe/pri-first-ranking`, day order). Rebase on main when 179 merges.

1. `src/core/pris.ts`: parse `perProject` (with `label`, `action`, `session`, `windows`; `FR:$window`).
2. `src/core/tiered-tasks.ts`: pure `tieredTasks(path, src)` (`FR:tasks.*`). Reads tier, agent, more agents, status, text, project and aliases.
3. `src/core/priorities-view.ts`: pure `prioritiesView` over priorities and tiered tasks. QM section, Now, Today, Next 3 days, gap rows, PR table (live board only, sorted by Time), agent links, stamps. Reuses `priOrder`, `linker`.
4. `src/cli/priorities.ts`: reads task files through the CLI storage; prints markdown sections.
5. `src/api/handler.ts`: `GET /priorities` reads task files from `deps.storage`; `openapi.ts` schema.
6. `web/src/priorities.ts`, `PrioritiesTables.tsx`, `priorities.css`: five sections, four columns, stacked rows below 600 px.
7. Tests: `tests/core/tiered-tasks.test.ts`, `tests/core/priorities-view.test.ts`, `tests/cli/priorities.test.ts`, `tests/api/priorities.test.ts`, `web/tests/priorities.test.ts`, `web/e2e/priorities-tables.spec.ts`.
8. Data: the owner list (labels, the FOCUS fixed action, QM `perProject` with keyword `QM` and day slots) stays outside this public repo. Load it after merge with `stack pris put --file`.
