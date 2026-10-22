---
id: formatter-clean
title: Clean Formatter Plan
---

# Plan: Clean Formatter and Dual Output

## Approach

- `src/core/formatter.ts` holds the interface, both formatters, registry, `convert`, `renderOutputs`. Reuses the task-parser `Project` so existing callers keep working.
- Emoji formatter delegates to `parser.ts` (unchanged). Canonical generation only when `lines` is empty.
- Clean formatter uses `yaml` with fixed key order; hand-validates shape.
- `config.ts` gains `format` and `alsoWrite`.

## Decisions

- Task text stays opaque; no model-level mapping (task-model Project has no emoji text).
- Tests: `tests/core/formatter.test.ts`, fixtures in `tests/fixtures/formatter/` (`*.md` canonical emoji, matching `*.yaml`).
