---
features: [api, config, recurring-rows, task-model]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: api and recurring follow-ups

## Active State

**Model**: OpenAPI generated from the route table; `shiftWeekends` config; `offsetMonths` for `Quarterly-EOM+1`; config time-check ordering.

**Decisions**: `offsetMonths` added to `Recurrence` (unit differs from `offsetDays`).

**Open**: None

**Next**: PR review loop.

**Pins**: `src/api/openapi.ts`, `src/core/config.ts`, `src/core/recurring.ts`

**Assumptions**: None

## Run 1: followups

> **Execute**: `/catalyst:change api and recurring follow-ups`

### Features

#### followups

- [x] Spec deltas
- [x] Plan
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review
