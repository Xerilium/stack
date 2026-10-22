---
features: [formatter-clean]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: formatter-clean

## Active State

**Model**: `Formatter` interface over the task-parser `Project`; emoji default, clean YAML second; config `format`/`alsoWrite`; converters.

**Decisions**: Lossless is defined for canonical files (see spec Scope).

**Open**: None

**Next**: PR review loop.

**Pins**: `src/core/formatter.ts`

**Assumptions**: None

## Run 1: formatter-clean

> **Execute**: `/catalyst:create formatter-clean`

### Features

#### formatter-clean

- [x] Spec
- [x] Plan
- [ ] Failing tests with `@req`
- [ ] Implementation
- [ ] Review
