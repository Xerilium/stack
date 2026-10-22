---
id: scoring-bakeoff
title: Scoring Bake-off Plan
---

# Plan: Scoring Bake-off

## Approach

One module, `src/core/bakeoff.ts`. The balanced engine reuses the legacy `score` output and recomputes only the final number from its breakdown, so parts, leaves and parking cannot drift. Comparison is a pure function over two engines; the runner is the only code that touches the file system. Report text is built from aggregates only, so it is safe to commit to a public repo.

## Contracts

- `balancedEngine`, `registerBalancedEngine()`
- `compareEngines(a, b, projects, config, topN)`
- `renderReport(result, recommendation)`
- `runBakeoff(tasksDir, outFile, recommendation)`; `pnpm bakeoff <tasksDir> <outFile>` runs it from the build

## Decisions

- Square-root divisor: halfway between ignoring effort and legacy's full division
- Sign-aware: avoids legacy's negative-score inversion
- Examples show emojis and ranks only; text and project names never leave the process
- Tests: `tests/core/bakeoff.test.ts` with synthetic tasks; the real-data run is manual and committed only as `docs/scoring-bakeoff.md`
