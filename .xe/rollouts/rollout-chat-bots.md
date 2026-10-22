---
features: [chat-bots]
status: in-progress
created: 2026-10-22
last_updated: 2026-10-22
---

# Rollout: chat-bots

## Active State

**Model**: Pure channel adapters over the api handler; HMAC verification, deny-by-default allow-lists.

**Decisions**: None

**Open**: None

**Next**: PR review loop, then squash-merge on green CI.

**Pins**: `src/bots/` — implementation

**Assumptions**: Autonomous mode; owner pre-delegated scope. Capture optional, not imported.

## Run 1: chat-bots

> **Execute**: `/catalyst:create chat-bots`

#### chat-bots

- [x] Spec (`.xe/features/chat-bots/spec.md`)
- [x] Plan
- [x] Failing tests with `@req`
- [x] Implementation
- [ ] Review (pr-loop)
