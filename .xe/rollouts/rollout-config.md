---
features: [config]
status: in-progress
created: 2026-10-21
last_updated: 2026-10-21
---

# Rollout: config

## Active State

**Model**: Pure function `parseConfig(json)` merges user JSON over baked-in legacy defaults and validates; `getTimeBlock(config, date)` resolves the active block.

**Decisions**: None

**Open**: None

**Next**: Open draft PR, run pr-loop.

**Pins**: `src/core/config.ts` — implementation

**Assumptions**: Legacy `.xe/config/stack.json` shape is the contract (see blueprint decisions Q6).

## Overview

First Catalyst 0.3 validation slice of the Stack blueprint: config parsing, defaults, time blocks.

## Run 1: config

> **Execute**: `/catalyst:create config — parse/validate legacy config with defaults and time-block lookup`

### Features

#### config

- [x] Spec (`.xe/features/config/spec.md`)
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review (pr-loop)

## Notes

- Autonomous mode; owner pre-delegated scope. Defects found in Catalyst 0.3 are logged in the PR description.
