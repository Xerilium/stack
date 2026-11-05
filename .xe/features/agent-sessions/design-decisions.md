# Design Decisions: Agent Sessions

## A session's Stack project comes from project metadata on the server

**Decision**: The session list carries `owner`, the Stack project that owns the session's repo, resolved from project files: `Repos`, `Repository`, the project name, its `Aliases`, and `<name>-` prefixes, worktree folders resolved to their repo first. Sessions without an owner are hidden by default on the Agents page.

**Date**: 2026-11-01

**Why**: The owner has sessions from repos no Stack project tracks (a dormant project, experiments) and wants only his projects' agents on the page. Only the server sees both the session store and the project files, and the CLI and future hosts should read the same answer.

**Rejected**: Guessing on the page from folder names alone (the page has no aliases or `Repository` lines without another round trip); a separate mapping file (one more thing to maintain; the project file already names its repo).

## Usage reads as tokens; dollars are a muted list-price line

**Decision**: Rows, the strip, the drawer facts and the daily bars show tokens. The Usage panel ends with `≈ $n at list price · prepaid plan`. The API keeps `usd` as computed.

**Date**: 2026-11-01

**Why**: Everything runs on one prepaid plan, so a per-session dollar figure read like a bill and was wrong as one. Tokens are the real unit of the plan; the dollar equivalent still tells relative weight at a glance.

**Rejected**: Dropping dollars entirely (loses the only unit that compares models); keeping `$` as the primary number with a tooltip (the owner's first read was still "a cost").

## Pins lift rows; project priority orders them

**Decision**: Sessions sort by attention state, then the Home project order (the rank of each project's top task), then recency. Pinned rows always show and sit first under **Pinned**; they never reorder a project.

**Date**: 2026-11-01

**Why**: The owner should not hand-order agents; the stack already knows which project matters now. Pins stay for the exceptions (a session from an untracked repo he still watches).

**Rejected**: Pins as the primary order (manual upkeep); recency only (a busy low-priority repo would sit on top).
