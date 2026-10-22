---
id: summaries
title: Summaries Plan
---

# Plan: Summaries

## Approach

One module, `src/core/summaries.ts`, a line-for-line port of the legacy generators over the existing scoring engine. Legacy outputs are the oracle: `tests/parity/generate-legacy.ps1` runs the real PowerShell on a case directory with a frozen clock; the Jest parity test compares the TypeScript output byte for byte.

## Data Model

See spec `## Data Model`. Internal `STask` carries id, text, level, parent, leaf, emojis, quotes, lists, project, score, breakdown.

## Contracts

- `generateSummaries(input): SummaryFiles`
- `formatNumber(n)`, `roundHalfEven(n, digits)`, `netSort(items, compare)` exported for tests

## Decisions

- Callers do all I/O; the module takes text and returns text
- Tasks come from a legacy-faithful line scan (not the structural parser) because summaries need quote/list lines and exact ids; project metadata reuses `toScoringProject`
- Unstable PowerShell sorts are reproduced with a port of .NET introsort so equal scores order identically
- Tests: unit tests in `tests/core/summaries.test.ts`; parity in `tests/core/summaries.parity.test.ts` with committed fixtures in `tests/fixtures/summaries/` and `STANDARD` env override `STACK_LEGACY_DIR`
