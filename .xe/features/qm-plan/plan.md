---
id: qm-plan
title: QM Plan Plan
---

# Plan: QM Plan

## Approach

One core module `src/core/qm-plan.ts` (`parseQmPlan`, `QmStore`). API route, CLI and page stay thin.

## Decisions

- Put replaces the whole file, so no lock: `writeAtomic` alone (no read-modify-write)
- `#/qm` is a standalone page like `#/live` (rendered by `main.tsx`), so the `View` type, rail and chords do not change
- Sorting is a pure helper in `web/src/qm.ts` so it is unit tested without a DOM
- Tests first: `tests/core/qm-plan.test.ts`, `tests/api/qm.test.ts`, `tests/cli/qm.test.ts`, `web/tests/qm.test.ts`
