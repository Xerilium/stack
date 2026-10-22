---
features: [deploy-docs]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: deploy-docs

## Active State

**Model**: Build-only IaC, workflows, docs; tests cross-check docs against code.

**Decisions**: None

**Open**: Reconcile web build script names after web-app (#31) merges.

**Next**: PR review loop, then squash-merge on green CI.

**Pins**: `infra/`, `docs/`, `.github/workflows/`

**Assumptions**: Autonomous mode; agents never deploy.

## Run 1: deploy-docs

> **Execute**: `/catalyst:create deploy-docs`

#### deploy-docs

- [x] Spec
- [x] Plan
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Review (pr-loop)
