---
features: [storage-git]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: storage-git

## Active State

**Model**: `Storage` interface with Memory, Fs, and Git adapters; git writes are direct commits with optimistic version checks.

**Decisions**: None

**Open**: None

**Next**: Await owner review.

**Pins**: `src/core/storage.ts`, `src/core/storage-git.ts`

**Assumptions**: Task files live at `tasks/*.md`.

## Run 1: storage-git

> **Execute**: `/catalyst:create storage-git`

### Features

#### storage-git

- [x] Spec (`.xe/features/storage-git/spec.md`)
- [x] Plan
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review
