# Design decisions: pr-priority

## Two files: a lean queue and a state file

**Decision**: The queue is `~/.stack/pr-priority.json`. Recommendations, edges, acks, escalations, PR facts and undo history are in `~/.stack/pr-priority-state.json`. One lock (`pr-priority.lock`) covers both.

**Date**: 2026-11-11

**Why**: The SM needs a small, stable file. The state changes often and grows. One lock keeps a decision (queue and state) consistent.

**Rejected**: One file (the SM contract would carry history and facts); SQLite (a native dependency for small JSON).

## One rich read: `list --json`

**Decision**: `list --json` merges the queue with cached PR facts, edges, the newest recommendation and decision, the newest per-PR report record, acks and escalation status. `GET /pr-priority` returns the same view.

**Why**: The SM asked for one read per sweep. The PR page uses the same shape, so there is one contract.

## PR facts come from `gh`, cached, only on `--refresh`

**Decision**: `list --refresh` reads facts with `gh pr view` (4 at a time) and caches them. A plain list reads the cache only.

**Why**: The owner's rule is token-free (no LLM). `gh` is already signed in on the machine. A cache keeps the plain read fast and offline. The host API does not refresh, so a page load never calls GitHub.

**Rejected**: The host `PrStatusProvider` (needs `GITHUB_TOKEN` in the host and lacks author, labels, review and mergeable).

## SM per-PR records live in the PR priority state

**Decision**: `stack pr-pri record <ref>` stores one record per PR; the newest `ts` wins. `list` shows it as `report`, with `stale` when the cached head SHA differs.

**Why**: `stack report` has no per-PR shape, and its asks feed Needs you. Records belong with the queue the SM reads in one call.

**Rejected**: A `prs` list in `stack report` (changes a merged schema and spreads one PR across many reports).

## Pinned items and default top

**Decision**: Pinned PRs come first. Add puts a PR at the top of the unpinned items. An unpinned PR never passes a pinned one.

**Why**: The owner's goal is the fastest nudge to the top. Pasting a link must enqueue at the top, and pins must hold.

## Idempotent actions and undo

**Decision**: An action that changes nothing writes nothing and returns `changed: false`. Each queue write keeps the prior items (newest 20); undo restores them as a new `rev`.

**Why**: The PR page and agents may retry. Undo makes a wrong drag safe without a confirm step.

## Rejection memory by word overlap

**Decision**: A rejection blocks the same PR for 14 days when the new reason shares at least 60% of the smaller stemmed word set.

**Why**: No LLM call is allowed. Word overlap catches rephrasing ("blocking the release" vs "release blocker") and lets a new reason through.

## Recommendations are Needs you decisions

**Decision**: Open recommendations join `GET /needs-you` with `kind: "decision"`, `actions` and a `decide` path. `go` on the existing answer route accepts.

**Why**: Needs you is the owner's one list. Edit and reject need a reason, so they use the decide route; the PR page adds the buttons.

## Exclusions in a config file

**Decision**: `~/.stack/pr-priority.config.json` `{exclude: [...]}` lists PRs the queue never holds (for example 918).

**Why**: The rule is the owner's, not an agent's. A file he edits keeps it out of the CLI and API surface.
