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
- **FR:autonomy.set** (P1): Only the owner sets autonomy (`stack triage <ref> --autonomy <level>`); the API and MCP can never set, raise, or remove it, and subtask text containing a `🤖` marker is rejected
- **FR:autonomy.gate** (P1): `authorize(level, action)` is deny-by-default: unknown level or action is denied. `triage` and `record` need `triage` or higher; `claim` and `complete-subtask` need `assist` or higher; `complete-task` needs `full`. `merge` and `deploy` are denied at every level
- **FR:autonomy.owner** (P2): Owner callers (the CLI) skip the autonomy gate but not input checks

### FR:triage: Triage

- **FR:triage.subtasks** (P1): A suggestion may add one 🪄 subtask (`agent`) and/or one 🙋 subtask (`human`) under an open task. Text is one line, 1-200 characters, no control or line-break characters, and none of `🪄 🙋 🤖 💤 🅿️ ⛔️ 🚧`. A matching subtask that already exists is not added twice. At most 20 children per task
- **FR:triage.props** (P1): A suggestion may set `priority`, `effort`, `impact` (never `None`, never status). A field the row already has is left as is, so an agent cannot overwrite the owner's choice
- **FR:triage.gate** (P1): Triage needs the task's autonomy to allow `triage`; otherwise nothing is written
- **FR:triage.open** (P1): Triage and claim only act on open (unchecked) rows

### FR:claim: Claim

- **FR:claim.start** (P1): Claim marks a row in progress. It needs `assist`, an open row, and refuses 🙋 rows (humans only). A row already in progress is `no change`
- **FR:claim.log** (P2): A claim appends a log entry

### FR:result: Results and completion

- **FR:result.log** (P1): Recording a result appends an entry to `tasks/logs/<project>.md` (markdown, in the repo, append-only) with time, actor, ref, level, outcome (`done|partial|blocked|needs-human`), one-line summary, and whether completion happened. Needs `triage` or higher
- **FR:result.noleak** (P1): Log fields are one line and capped; secrets (bearer and API tokens, private keys, JWTs, `key=value` credentials, URL credentials, long random strings) are replaced with `[redacted]`
- **FR:result.nosilent** (P1): Completion happens only when requested, the outcome is `done`, the autonomy allows it (`assist` for a 🪄 subtask, `full` otherwise), the row is not 🙋, and it has no open 🙋 child. Otherwise the row stays open, a 🙋 review subtask is added, and the log says `completion: deferred`. Nothing completes silently
- **FR:result.noblock** (P1): Outcomes `blocked` and `needs-human` add a 🙋 subtask (the given `human` text or a default) and return normally; the agent never waits
- **FR:result.actor** (P1): The actor is set by the server (the token id over MCP), never by tool arguments; it is single-line and limited to `[A-Za-z0-9._:-]`
- **FR:result.path** (P1): Log files live under `tasks/logs/`, are never listed as projects, and are accepted by storage only at that path

### FR:api: API and MCP

- **FR:api.routes** (P1): `POST /tasks/triage`, `/tasks/claim`, `/tasks/result` (route names `tasks.triage`, `tasks.claim`, `tasks.result`) need `tasks:write`; strict bodies like other routes
- **FR:mcp.tools** (P1): Tools `triage`, `claim`, `record-result` map one-to-one to those routes, hidden without `tasks:write`, closed schemas, descriptions under 100 characters, replies fixed text with refs only (`triaged <ref>`, `claimed <ref>`, `logged <ref>`, `logged <ref> completed`, `logged <ref> deferred <ref>`, or `no change`). Task text never appears in replies
- **FR:mcp.actor** (P1): The MCP layer sends `actor` itself (`mcp:<tokenId>`, `mcp:local` on stdio); the tools take no actor argument

### FR:cli: CLI

- **FR:cli.triage** (P2): `stack triage <ref> [--autonomy l] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]` runs as owner. With no options it prints the effective autonomy. Existing commands are unchanged
