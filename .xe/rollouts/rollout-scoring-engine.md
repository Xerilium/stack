---
features: [scoring-engine]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: scoring-engine

## Active State

**Model**: `ScoringEngine` interface (`score`, `filter`) with a registry; default `legacy` engine ports the PowerShell formula line for line. `toScoringProject` adapts parser output. `rankTasks` composes score, parked/leaf selection, time filter, stable sort.

**Decisions**: Fixtures are synthetic (repo is public; real tasks hold personal data). Goldens come from the legacy code via `tests/fixtures/scoring/generate-golden.ps1`. Legacy quirks preserved and listed in the spec.

**Open**: None

**Next**: Await owner review.

**Pins**: `src/core/scoring.ts` — implementation; `tests/fixtures/scoring/golden.json` — legacy output

**Assumptions**: Config defaults equal legacy `.xe/config/stack.json` (verified against the legacy copy).

## Overview

Phase 1 slice: golden-tested scoring at legacy parity, ready for task-lifecycle, summaries, and the bake-off.

## Plan

1. Spec (`.xe/features/scoring-engine/spec.md`).
2. Fixtures and goldens from legacy (read-only copy).
3. Failing tests with `@req`.
4. `src/core/scoring.ts`.
5. Real-data parity run against a copy of legacy tasks (local only, not committed).

## Run 1: scoring-engine

> **Execute**: `/catalyst:create scoring-engine — pluggable engine, exact legacy formula, goldens`

### Features

#### scoring-engine

- [x] Spec
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review (pr-loop)

## Notes

- Autonomous mode; owner pre-delegated scope.
