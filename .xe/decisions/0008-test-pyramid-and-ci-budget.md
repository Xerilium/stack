# 0008: Test pyramid and CI budget

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

| Layer                       | Files | CI time |
| --------------------------- | ----- | ------- |
| Jest (core, api, cli, desktop) | 228 | 1m50s   |
| Vitest (web logic)          | 68    | 6s      |
| Playwright on a mock API    | 45 (406 tests, 2 views) | 7m19s |
| Real host and real page     | 0     | 0       |

- CI takes 8 minutes. Playwright is 7 of them.
- No test starts `stack web` and loads the real page.
- `pnpm lint` and `pnpm build` both type-check all 8 projects (34 s + 35 s).
- 36 open PRs each pay the 8 minutes on every push.

## Decision

- Budget: CI MUST finish in 5 minutes at p50.
- A rule is tested at the lowest layer that can see it: `core` first, then API, then Vitest.
- Playwright is for layout, focus and flows only. Not for rules.
- A Playwright test runs in both views only when the layout differs. Else desktop only.
- Add at most 5 smoke tests on the real local host with fixture tasks. They catch wiring errors the mock hides.
- Shard Playwright when the budget fails. Keep the check names `test` and `e2e` stable for branch rules.
- Type-check once: use `tsc -b` with project references.
- Each store or adapter with more than one implementation has one contract suite (as `Storage` has today).

## Consequences

- Faster PR loop for 36 open PRs.
- Wiring bugs (a store not passed, a route 404) fail in CI.
- Cost: tag each Playwright test with its views; one `tests/deploy` rule about the e2e job must change.

## Evidence

- CI run 44539028766. `web/playwright.config.ts:20-26`. `tests/core/storage.test.ts:72`.
