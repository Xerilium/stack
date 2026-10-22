---
id: quick-capture
title: Quick Capture Plan
---

# Plan: Quick Capture

## Approach

One pure module `src/core/quick-capture.ts` (parser, renderer, `captureTask`). API and CLI stay thin: validate input, call `captureTask`.

## Contracts

- `parseCapture`, `toTaskText`, `captureTask`, `CaptureSpec`, `CaptureError`

## Decisions

- Pipeline order: normalize (fillers, number words) -> recurrence -> effort -> project -> due -> title
- Dates computed on UTC calendar of the injected clock, matching the existing core
- Multi-weekday recurrence rejected (row format holds one weekday)
- Route added to `ROUTES` (OpenAPI test enforces docs); CLI command added to `COMMANDS`; no existing behavior touched
- Tests first: table-driven phrase table in `tests/core/quick-capture.test.ts`, route tests in `tests/api/capture.test.ts`, CLI in `tests/cli/capture.test.ts`
