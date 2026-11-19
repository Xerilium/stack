# Design Decisions: Task Bloat Lint

## The lint reads open rows only

**Decision**: A checked row and a `🌐` query row give no issue.

**Date**: 2026-11-19

**Why**: A checked row is history that `remove-completed` deletes. Stack writes a `🌐` title from GitHub, so no agent can fix it. On a real task repo of about 1,200 open rows the lint gives about 200 issues: A size an agent can clear.

**Rejected**: Lint every row (hundreds of old delegated prompts would fail forever).

## `stack update` fails, the refresh after a lifecycle command does not

**Decision**: `stack update` writes the summaries, then runs the lint and exits 1 on an issue. The refresh that follows `start`, `complete`, and the like does not run the lint.

**Date**: 2026-11-19

**Why**: Agents edit task files by hand and then run `stack update`. That is the save path, so the lint must fail there. The summaries are written first, so a lint issue never leaves them stale. A status change on an old bloated row must still work.

**Rejected**: Fail before the write (stale summaries). Lint only rows that changed since the last commit (needs git in a pure path; old bloat stays forever). A warning with exit 0 (agents ignore it).

## Write commands refuse a bad title in the CLI, not in the core or the API

**Decision**: `stack add`, `stack capture`, and `stack retitle` run the title rules before the write. The web app and the HTTP API do not.

**Date**: 2026-11-19

**Why**: Agents write through the CLI. The owner writes through the web app, and a refused quick capture costs the owner more than a long title.

**Rejected**: A gate in `addTask` and `editTask` (blocks the owner in the web app).

**Open**: The MCP `add` tool goes through the API, so it has no gate. Add one when agents use MCP to write tasks.

## Status prose is a fixed word list plus dates

**Decision**: `title-status` matches whole words (`done`, `waiting`, `blocked`, `merged`, `landed`, `shipped`, `parked`, `on hold`, `as of`) and dates (`Nov 18`, `2026-11-18`). Hyphenated compounds (`done-when`) do not match. Structured marks (`📅 Nov 5:`, `⏰ Apr 1:`, `💤 Nov 5:`) are not read.

**Date**: 2026-11-19

**Why**: The owner named these as the bloat. A fixed list is deterministic and costs no tokens. A rare false positive (`Decide when the release is done`) has a cheap fix: Reword the title.

**Rejected**: A model call (cost, not deterministic). Phrase patterns such as `waiting on` only (misses `-- blocked`, `PR 12 merged`).

## A numbered item, a quote line, and a code fence are not prose

**Decision**: `detail-nesting` passes `1. ` items, `>` lines, and fenced code under a row.

**Date**: 2026-11-19

**Why**: Stack writes `> ✅ **COMPLETED**:` and `> Prompt:` lines itself. A numbered list is a nested list. Real files use both.
