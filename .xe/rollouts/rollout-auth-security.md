---
features: [auth-security]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: auth-security

## Active State

**Model**: Owner allow-list plus hashed scoped tokens behind the api `authorize` hook.

**Decisions**: See plan. `catalyst check` is broken in 0.3.2 (missing `check/runner`); spec checked by hand.

**Open**: None

**Next**: PR review loop.

**Pins**: `src/api/auth/`

**Assumptions**: None

## Run 1: auth-security

> **Execute**: `/catalyst:create auth-security`

### Features

#### auth-security

- [x] Spec
- [x] Plan
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review
