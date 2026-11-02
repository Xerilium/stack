
## Owner and CoS priorities are tiers in a small JSON file, not score edits

**Decision**: `.stack/priorities.json` holds rules (`match`, `effect` top, down, or hide, optional `until`, `why`, `by`). `applyOverrides` orders by tier (top, unmatched, down) and keeps the engine order inside a tier; hide removes.

**Date**: 2026-11-01

**Why**: The owner and the Chief of Staff need to say "FOCUS is not a priority now" or "pay bills first" without understanding score arithmetic, and the same words must hold for Home, `/next`, and the CLI. Tiers are predictable and reviewable in a diff.

**Rejected**: A score multiplier (nobody can reason about the result); editing emoji on the rows (changes the owner's task data for a temporary statement); a markdown format (needs a parser; JSON validates and the CoS already writes JSON).
