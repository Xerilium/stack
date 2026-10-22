---
features: [web-app]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: web-app

## Active State

**Model**: Preact + Vite SPA under `web/`, static on SWA free tier, talks to `/api` with the SWA session cookie.

**Decisions**: See plan. Two additive api routes (`tasks.edit`, `tasks.move`) because the api has no way to edit row text or reorder. `catalyst check` is broken in 0.3.2; spec checked by hand.

**Open**: None

**Next**: PR review loop.

**Pins**: `web/`, `src/api/edit.ts`

**Assumptions**: None

## Run 1: web-app

> **Execute**: `/catalyst:create web-app`

### Features

#### web-app

- [x] Spec
- [x] Plan
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review
