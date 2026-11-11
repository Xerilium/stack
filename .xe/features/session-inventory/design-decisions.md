# Design decisions: session-inventory

## Read the app store, never write it

**Decision**: Stack reads `local_*.json` and `scheduled-tasks.json` read-only. Archive candidates are a list only; the archive action comes in the UI chunk through the app's own archive call.

**Date**: 2026-11-11

**Why**: The app owns these files and rewrites them often. A write from Stack can race the app and corrupt a session.

**Rejected**: Set `isArchived` in the file (races the app; undocumented format).

## State from app fields plus the transcript tail kind

**Decision**: Classify from app fields (`postTurnSummary`, `interruptedAwaitingPerson`, `error`, `prs`, `isStarred`) and the kind of the last transcript event. Stack reads at most 64 KiB of the transcript and keeps only the event kind.

**Why**: A pending permission prompt or a dead scheduled run shows only in the transcript (last event is a tool call with no result). The kind alone is enough; no text leaves the reader. Real store: 635 files, 272 live; a cold scan takes about 250 ms.

**Rejected**: Read the whole transcript (slow, privacy risk); LLM summary (costs tokens; the app summary already exists).

## Timing thresholds

**Decision**: A pending tool call with no activity for 5 minutes is a permission prompt (interactive, not bypass) or stuck (scheduled run). An open turn with no activity for 30 minutes is stuck.

**Why**: A long build can hold a tool call for minutes. 5 minutes keeps builds out of Needs you; 30 minutes catches dead turns the same day.

## Cache facts, classify every time

**Decision**: `~/.stack/sessions.json` caches facts per file (mtime, size, transcript mtime). The state is computed on each run from the facts and the current time.

**Why**: The state depends on the time (running becomes stuck). Facts change only when a file changes, so a warm run reads no session file.

## Fixed project rank

**Decision**: Rank is a fixed list (Allyte/FH, FTK, FOCUS, F4, Xerilium, other), mapped from the first folder under `dev/`.

**Why**: The owner gave this order. Mapping from the priorities model can come later when priorities name projects.

## Priorities in their own file, owner only

**Decision**: `~/.stack/pris.json` with `rev` for optimistic concurrency and the shared lock file rules (extracted to `file-lock.ts` from the report store). Seeded once from the CoS markdown; the seed never overwrites an existing file. API routes are owner only.

**Why**: The list is live state the owner edits; `rev` stops a stale UI from overwriting a newer list. A seed that could rerun would wipe edits.

**Rejected**: Reuse `.stack/priorities.json` (that file holds scoring overrides in git).
