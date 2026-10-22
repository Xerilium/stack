---
id: ai-triage-assist
title: AI Triage Assist
author: flanakin
description: "Triage suggestions, 🪄/🙋 subtasks, per-task autonomy, deny-by-default autonomy gate, and an in-repo result log; exposed as core, API routes, MCP tools, and `stack triage`."
dependencies: [mcp-server]
---

<!-- markdownlint-disable single-title -->

# Feature: AI Triage Assist

## Purpose

Let an external agent (the MCP client) triage tasks and do the work it is allowed to do, never more. Anything that needs a person becomes a 🙋 subtask and the agent moves on. Every agent action is logged in the repo. No model calls live in this repo.

## Scope

- In: 🪄 (agent can do) and 🙋 (needs human) subtasks; per-task autonomy marker; autonomy gate; triage application; claim; result log; API routes, MCP tools `triage`, `claim`, `record-result`; `stack triage`.
- Out: model calls, prompts, scheduling agents, merge/deploy (never), changing autonomy through the API or MCP, web UI.

## Scenarios

### FR:autonomy: Autonomy

- **FR:autonomy.marker** (P1): A task's autonomy is the marker `🤖:triage`, `🤖:assist`, or `🤖:full` in its text. No marker means `none`. A subtask without its own marker inherits the nearest ancestor's. Unknown levels are ignored (`none`)
- **FR:autonomy.set** (P1): Only the owner sets autonomy (`stack triage <ref> --autonomy <level>`); the API and MCP can never set, raise, or remove it. Every agent-reachable text write (`add`, `capture`, `edit`, `complete` summary, triage subtasks) rejects `🤖`. A marker in ordinary owner text counts, so owners keep it out of prose
- **FR:autonomy.gate** (P1): `authorize(level, action)` is deny-by-default: unknown level or action is denied. `triage` and `record` need `triage` or higher; `claim` and `complete-subtask` need `assist` or higher; `complete-task` needs `full`. `merge` and `deploy` are denied at every level
- **FR:autonomy.structure** (P1): Only the owner session moves rows or changes gate markers; tokens cannot move rows and token edits cannot add or remove gate markers (🪄 🙋 🤖 and hold marks), so autonomy by subtree cannot be gamed
- **FR:autonomy.scope** (P2): The autonomy gate binds only `triage`, `claim`, and `record-result`. The existing `start`, `complete`, `set`, and `skip` tools stay `tasks:write` and are not autonomy-gated. To bound an agent, give it only the three tools or a narrower token
- **FR:autonomy.owner** (P2): Owner callers (the CLI) skip the autonomy gate but not input checks

### FR:triage: Triage

- **FR:triage.subtasks** (P1): A suggestion may add one 🪄 subtask (`agent`) and/or one 🙋 subtask (`human`) under an open task. Text is one line, 1-200 characters, no control or line-break characters, and none of `🪄 🙋 🤖 💤 🅿️ ⛔️ 🚧`. A matching subtask that already exists is not added twice. At most 20 children per task
- **FR:triage.props** (P1): A suggestion may set `priority`, `effort`, `impact` (never `None`, never status). A field the row already has is left as is, so an agent cannot overwrite the owner's choice
- **FR:triage.gate** (P1): Triage needs the task's autonomy to allow `triage`; otherwise nothing is written
- **FR:triage.open** (P1): Triage, claim, and results only act on open rows whose ancestors are all open
- **FR:triage.syntax** (P1): Subtask text cannot contain any row syntax (agent, human, and autonomy marks, status, priority, effort, impact, suspend, park, pin, due, start, recurrence), including forms without variation selectors or with zero-width characters
- **FR:triage.pin** (P1): Writes carry the row text that was read; if the row changed meanwhile the write fails with `conflict` instead of landing on another row

### FR:claim: Claim

- **FR:claim.start** (P1): Claim marks a row in progress. It needs `assist`, an open row, and refuses 🙋 rows (humans only) and held rows (blocked, parked, waiting, review, suspended). A row already in progress is `no change`
- **FR:claim.log** (P1): The claim is logged before the row changes; if the log cannot be written the row is untouched

### FR:result: Results and completion

- **FR:result.log** (P1): Recording a result appends an entry to `tasks/logs/<project>.md` (markdown, in the repo, append-only; a file over 256 KiB rolls to `<name>.2.md`, `.3.md`, ... up to 5 files; slugs never contain dots, so a rollover cannot equal another project's log; unusual project names map to a safe file name) with time, actor, ref, level, outcome (`done|partial|blocked|needs-human`), one-line summary, and whether completion happened. Needs `triage` or higher
- **FR:result.noleak** (P1): Log fields are one line and capped; secrets (bearer and API tokens, private keys, JWTs, `key=value` and `password x` credentials, cookies, `sig=`, `sk_live_` keys, any `ghX_` token, `?key=` params, quoted values, URL credentials, long random strings) are replaced with `[redacted]` after zero-width characters are removed. Fields are folded (NFKC, Cyrillic/Greek lookalikes) before matching, and `< > [ ] \` |` are escaped so rendered markdown cannot beacon or link. Best effort: agents are told not to send secrets
- **FR:result.nosilent** (P1): Completion happens only when requested, the outcome is `done`, the autonomy allows it (`assist` for a 🪄 subtask, `full` otherwise), the row is not 🙋 or held, it has no open 🙋 child, and no new 🙋 is being added. A row is a 🪄 subtask only when 🪄 is its leading token (after status or priority emoji) Otherwise the row stays open, a 🙋 review subtask is added, and the log says `completion: deferred`. Nothing completes silently
- **FR:result.noblock** (P1): Outcomes `blocked` and `needs-human` add a 🙋 subtask (the given `human` text or a default, validated like any subtask) and return normally; the agent never waits. The hand-off is written before the log, so a full log never stops it
- **FR:result.actor** (P1): The API derives the actor from the authenticated request (`token:<id>`, `owner`, or `api`); no route or tool takes an `actor`
- **FR:result.path** (P1): Log files live under `tasks/logs/`, are never listed as projects, and are accepted by storage only at that path

### FR:api: API and MCP

- **FR:api.routes** (P1): `POST /tasks/triage`, `/tasks/claim`, `/tasks/result` (route names `tasks.triage`, `tasks.claim`, `tasks.result`) need `tasks:write`; strict bodies like other routes
- **FR:mcp.tools** (P1): Tools `triage`, `claim`, `record-result` map one-to-one to those routes, hidden without `tasks:write`, closed schemas, descriptions under 100 characters, replies fixed text with refs only (`triaged <ref>`, `claimed <ref>`, `logged <ref>`, `logged <ref> completed`, `logged <ref> deferred <ref>`, or `no change`). Task text never appears in replies
- **FR:mcp.actor** (P1): The tools take no actor argument; the forwarded bearer token is the only identity

### FR:cli: CLI

- **FR:cli.triage** (P2): `stack triage <ref> [--autonomy l] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]` runs as owner. With no options it prints the effective autonomy. Existing commands are unchanged
