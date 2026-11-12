---
id: session-inventory
title: Session Inventory
author: flanakin
description: "Stack reads the Claude app session store, classifies each session, and ranks one Needs-you list. It also keeps the owner's ordered priorities. Both live in ~/.stack. No LLM call."
dependencies: [status-ingest, api, auth-security, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: Session Inventory

## Purpose

The owner runs hundreds of Claude sessions across projects. The app sidebar does not show which sessions wait on him, which are stuck, and which are done. This feature reads the app session store (read-only), classifies each session, and gives one ranked **Needs you** list with a deep link per session. It also keeps the owner's ordered priorities in the same local store. Stack makes no LLM call: the inventory is token-free.

## Scope

- In: read the session store and `scheduled-tasks.json`, classify sessions, rank Needs you, list archive candidates, cache by mtime in `~/.stack/sessions.json`, the priorities model in `~/.stack/pris.json` with a one-time seed, CLI `stack sessions` and `stack pris`, API routes `inventory.list`, `pris.get`, `pris.put`.
- Out: any UI (chunk 3), the archive action (chunk 3 calls the app archive), any write to the session store, any transcript text in output or in the store, any LLM call.

## Scenarios

### FR:read: Read the session store

The owner needs Stack to see every session without risk to the app's own files.

- **FR:read.files** (P1): Stack reads `<sessions>/*/*/local_*.json` and `<sessions>/*/*/scheduled-tasks.json`, where `<sessions>` is `STACK_SESSIONS_DIR` or `~/Library/Application Support/Claude/claude-code-sessions`. Stack never writes, renames, or deletes a file there
- **FR:read.tail** (P1): For a session that is not archived, Stack reads the last 64 KiB of its transcript, and more (at most 4 MiB) only when no whole event fits (`<transcripts>/<cwd with each non-alphanumeric character as "-">/<cliSessionId>.jsonl`, where `<transcripts>` is `STACK_TRANSCRIPTS_DIR` or `~/.claude/projects`). It keeps only the kind of the last main-chain event: `turn-end`, `question` (a pending `AskUserQuestion` or `ExitPlanMode`), `tool` (another pending tool call), `tool-result`, `user` (a user line that starts `[Request interrupted by user` is `turn-end`, and so is a local command or shell line that starts `<command-name>`, `<local-command-`, `<bash-input>`, `<bash-stdout>` or `<bash-stderr>`; compact summaries are skipped), `assistant-text`, `api-error` (a system `api_error` line, or an assistant line marked `isApiErrorMessage`), or `none`. No transcript text leaves the reader
- **FR:read.bad** (P1): A file that is missing, not JSON, or has no `sessionId` is skipped. One bad file never fails the inventory
- **FR:read.cache** (P1): Stack caches the facts of each session file in `<home>/sessions.json` by file path, file mtime and size, and transcript mtime. A file whose stats did not change is not read again. Entries for files that are gone are dropped. A cache of another version or another transcripts folder is not used
- **FR:read.fast** (P2): An inventory of 1,000 session files with a warm cache completes in under 1 s

### FR:state: Classify each session

The owner needs one state per session so that he knows where to look.

- **FR:state.archived** (P1): A session with `isArchived` true is left out of the inventory
- **FR:state.waiting** (P1): A session is `waiting` when one of these is true: the last event is a `question`; `interruptedAwaitingPerson` is true; `turnWrapUp.needsUser` is set; the turn is closed and the current `postTurnSummary` (it summarizes `lastAssistantUuid`) has `status_category` `blocked`; or the last event is a pending `tool`, no activity for 5 minutes, and the session can ask for permission (`permissionMode` is not `bypassPermissions`) and is not a scheduled run
- **FR:state.stuck** (P1): A session is `stuck` when it is not waiting and one of these is true: `error` is set and `errorAt` is after the last turn edge; `lastTurnCutShort` is true and the last event is not `turn-end`; the last event is `api-error` with no activity for 5 minutes; or the turn is open (`tool`, `tool-result`, `user`) with no activity for 30 minutes. A scheduled run at a pending `tool` with no activity for 5 minutes is also stuck (no person sees its prompt)
- **FR:state.running** (P1): A session is `running` when its turn is open and it had activity in the last 30 minutes, and it is not waiting or stuck
- **FR:state.done** (P1): A session is `done` when its turn is closed, it is not pinned, and it has a PR that is not dismissed, and every such PR is `MERGED` or `CLOSED`, with at least one `MERGED`
- **FR:state.pinned** (P1): A pinned session (`isStarred` true) that is otherwise idle is `pinned`. Every session has `pinned` true or false
- **FR:state.idle** (P1): Every other session is `idle`
- **FR:state.activity** (P1): Activity time is the latest of `lastActivityAt`, the transcript mtime, and, while a `tool` call is pending, the newest file mtime in `<transcript without .jsonl>/subagents/`. A turn is open when the last event is `tool`, `tool-result` or `user`. With no transcript, a turn is open when `lastActivityAt` is more than 1 s after `lastTurnEdgeAt`

### FR:needs: Needs you

The owner needs one ranked list so that he acts on the most important session first.

- **FR:needs.list** (P1): Needs you holds every `waiting` and `stuck` session, except a superseded scheduled run (`FR:session-inventory/archive.superseded`)
- **FR:needs.rank** (P1): Needs you is ordered by project rank, then `waiting` before `stuck`, then newest activity first. Project rank: `allyte` (Allyte and FinOps hubs), `ftk`, `focus`, `f4`, `xerilium` (Stack, Catalyst, Printer, Prime), then `other`
- **FR:needs.project** (P1): The project comes from the first folder under `dev/` in the session `cwd` (any `.worktrees`, `-wt` or other suffix is ignored): `finops-hubs*` and `allyte*` are `allyte`; `finops-toolkit*` is `ftk`; `focus*` (any case) is `focus`; `f4*` is `f4`; `todo*`, `stack*`, `catalyst*`, `printer*`, `prime*` and `pr-sweep*` are `xerilium`; any other is `other`
- **FR:needs.item** (P1): Each session item has `id` (the `sessionId`), `title`, `project`, `state`, `reason`, `pinned`, `lastActivityAt` (ISO), `link` = `claude://claude.ai/epitaxy/<sessionId>`, `prs` (`{url, state}`), and when set `ask` (the summary `needs_action`, one line, at most 200 characters) and `scheduled` (`{id, name}` from `scheduled-tasks.json`)
- **FR:needs.reason** (P1): `reason` names the rule that set the state: `question`, `permission`, `needs-user`, `blocked`, `error`, `cut-short`, `api-error`, `dead-turn`, `pr-merged`, `superseded`, `turn-open`, or `idle`

### FR:archive: Archive candidates

The owner needs a short list of sessions to archive, and Stack must not edit the app's files.

- **FR:archive.list** (P1): Archive candidates are every `done` session and every superseded scheduled run. Stack only lists them; it never changes a session file
- **FR:archive.superseded** (P1): A scheduled run is superseded when a newer run of the same `scheduledTaskId` exists (archived or not) and the run is not pinned and not running

### FR:store: Inventory result

- **FR:store.result** (P1): The inventory result is `{at, total, counts, needsYou, archive, sessions}`. `counts` has one number per state; `needsYou` and `archive` are session items; `sessions` is every item, newest activity first
- **FR:store.write** (P1): Each inventory writes `<home>/sessions.json` (`{version, at, projectsDir, cache, inventory}`) with a temp file and a rename, mode `0600`. `<home>` is `STACK_HOME` or `~/.stack`. A failed write never fails the inventory. Nothing is written to the content repo

### FR:pris: Priorities

The owner needs his ordered priorities in Stack so that the CoS and the Needs-you view use one source of truth.

- **FR:pris.model** (P1): `<home>/pris.json` is `{version: 1, rev, updatedAt, seed?, pris}`. `pris` is ordered, most important first, at most 30. Each priority is `{id, title, status, items, backlog, weekly}`: `id` matches `[a-z0-9][a-z0-9-]{0,23}` and is unique; `title` is one line of 1-200 characters; `status` is `active`, `paused`, `blocked` or `done`; `items` (at most 20) and `backlog` (at most 50) are `{text, status}` with `text` one line of 1-300 characters and `status` `todo`, `doing`, `blocked` or `done`; `weekly` (at most 12, newest first) is `{week, text}` with `week` an ISO week `YYYY-Www` and `text` one line of 1-500 characters, one entry per week
- **FR:pris.validate** (P1): `parsePris` checks the whole list and throws one `PrisInvalid` that lists every issue as `{field, message}`. Unknown keys are rejected. Nothing is written when the list is invalid
- **FR:pris.seed** (P1): `stack pris seed --file <md>` reads each numbered line `N. ...` of the file as one priority, in order, with `id` `p<N>`; a later line with a number already seen is skipped. The title is the text before the first `:` outside parentheses. With no such `:`, the title is the text before the first `;` outside parentheses, or the whole line. The rest splits into items at `;` and at sentence ends outside parentheses; when the title ends at `:` and that gives one part, at `, ` outside parentheses. A leading `N.M` and a final `.` are removed. Items start as `todo`, priorities as `active`
- **FR:pris.seed.once** (P1): The seed runs only when `pris.json` does not exist. When it exists, the seed changes nothing and reports `already seeded`. The seed stores `{source, at, sha256}`
- **FR:pris.broken** (P2): A file that is not JSON, has no whole-number `rev`, or fails `parsePris` is broken. A write that finds `pris.json` broken moves it aside as `pris.json.broken-<ms>` before writing. Read shows a broken file as an empty list at `rev` 0
- **FR:pris.write** (P1): Each write increments `rev`, sets `updatedAt`, and goes through a temp file and a rename under the single-writer lock `<home>/pris.lock` (same lock rules as `FR:status-ingest/store.lock`). A write with a `rev` that is not the current one fails `conflict` and changes nothing

### FR:cli: CLI

- **FR:cli.sessions** (P1): `stack sessions [--json]` runs the inventory and needs no content repo. Text output is one counts line, then one line per Needs-you item (`<n>. [<project>] <state> <title> - <ask or reason> <link>`), then `archive candidates: <n>`. `--json` prints the inventory result
- **FR:cli.pris** (P1): `stack pris [--json]` prints the priorities in order (`<n>. <title> [<status>]`, then each item indented) and needs no content repo. With no `pris.json` it prints `no priorities (run: stack pris seed --file <md>)`. `stack pris seed --file <md>` runs `FR:session-inventory/pris.seed`. A missing `--file` or a file that cannot be read exits `2`

### FR:api: API

- **FR:api.inventory** (P1): `GET /session-inventory` (route `inventory.list`, scope `tasks:read`) returns the inventory result to the owner only (another caller gets `403`). A host with no inventory (demo, cloud) returns `404`
- **FR:api.pris.get** (P1): `GET /pris` (route `pris.get`, scope `tasks:read`) returns the priorities file to the owner only, or `{version: 1, rev: 0, pris: []}` when none exists. A host with no store returns `404`
- **FR:api.pris.put** (P1): `POST /pris` (route `pris.put`, scope `tasks:write`) takes `{rev, pris}` from the owner only and replaces the list. A list that fails `parsePris` returns `400 bad_request` with every issue; a stale `rev` returns `409 conflict`; success returns `200` with the new file

## Data Model

- **FR:$session** (P1): **`SessionItem`** — One Claude app session as Stack sees it: `id`, `title`, `project`, `state` (`running`, `waiting`, `stuck`, `done`, `pinned`, `idle`), `reason`, `pinned`, `lastActivityAt`, `link`, `prs`, `ask?`, `scheduled?`
- **FR:$pri** (P1): **`Pri`** — One owner priority: `id`, `title`, `status`, `items`, `backlog`, `weekly`

## Architecture Constraints

- The session store is read-only to Stack
- Inventory and priorities are live state under `~/.stack`, never in the content repo or git
- No LLM call; no transcript text in output or in the store

## External Dependencies

- The Claude desktop app session store layout (undocumented; fields read are listed in `FR:session-inventory/state.*`). Unknown or missing fields fall back to `idle`

## Dependencies

- status-ingest (`~/.stack` home, lock rules, host), api (routes, errors), auth-security (scope table), cli (exit codes)
