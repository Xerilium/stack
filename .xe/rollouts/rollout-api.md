---
features: [api]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: api

## Active State

**Model**: Framework-neutral Fetch handler over core; Azure adapter separate.

**Decisions**: None

**Open**: None

**Next**: PR review loop, then squash-merge on green CI.

**Pins**: `src/api/` — implementation

**Assumptions**: Autonomous mode; owner pre-delegated scope.

## Run 1: api

> **Execute**: `/catalyst:create api — REST over core`

#### api

- [x] Spec (`.xe/features/api/spec.md`)
- [x] Plan
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Review (pr-loop)
