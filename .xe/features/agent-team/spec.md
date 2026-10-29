---
id: agent-team
title: Agent Team
author: flanakin
description: "AI on every page: agents defined per project folder with a scope, the active agent shown on every task, an inline way to hand a task to its agent (through the agent-sessions runner), and an explicit review that says whether the agent can do the task and turns what it needs into asks."
dependencies: [agent-sessions, ask-queue, agent-inbox, ai-triage-assist, api, auth-security, storage-git, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Team

## Purpose

`agent-sessions` runs Claude sessions from the dashboard and shows them in one view. This feature makes those sessions belong to the tasks: every task knows its agent (defined at the project folder level), can be handed to it in one keystroke from the row it sits on, and can be reviewed so the owner learns, before any work starts, whether the agent can do it and what it needs from him. Research and decision: `docs/design/agents-research.md`.

## Scope

- In: agent definition files and scope resolution, the team route, per-prompt options on the agent driver (persona, model, title, tool limits, JSON answer), starting a session for an agent on a task, task review with a JSON verdict recorded in the result log and needs written as asks, the reviews route, CLI `stack agents`, and the web: active-agent chip on rows, inline talk composer on tasks and asks, review verdict chips, the session drawer opened from a row.
- Out: automatic review of every task (one keystroke, one read-only session each; a session start costs about 50k context tokens), a second runner (ACP; the driver interface is ready), agents on the Azure host (no runner there: the page says so).

## Agent file format (v1)

One file per agent: `tasks/agents/<slug>.md` (slug `[a-z0-9][a-z0-9._-]{0,39}`). Fields are `- key: value` lines; the body under `## Prompt` is the system prompt addition.

```markdown
# Agent: cid-manager

<!-- stack-agent v1. Scope is a list of project or project/section prefixes; `*` is everything. -->

- name: 🎧 Cid Manager
- role: Label manager and F4 chief of staff
- scope: flantastic-4
- model: sonnet
- mode: long-running

## Prompt

Read `.stack/cos-charter.md` first. You own every task under your scope ...
```

A project's `- **Agents:**` metadata (existing) names its team; an agent named there without a file still exists with a generated prompt. `cos` (or any agent with `scope: *`) is the roll-up and matches everything.

## Scenarios

### FR:agent: Definitions and scope

- **FR:agent.path** (P1): Storage accepts `tasks/agents/<slug>.md` and lists the folder (`listAgents`, filesystem and memory adapters). Agent files are never listed as projects
- **FR:agent.format** (P1): `formatAgent`/`parseAgent` round-trip the v1 format: `name` (1-60 chars), `role` (one line), `scope` (comma-separated prefixes `project` or `project/section` or `*`; default: the projects whose `Agents` metadata names the agent, else none), `model` (`sonnet`, `opus`, `haiku`, or a model id), `tools` (comma list), `mode` (`long-running` or `ad-hoc`, default `ad-hoc`), then `## Prompt`. Unknown lines kept; bad values dropped
- **FR:agent.team** (P1): `listTeam(ctx)` returns every agent from files plus agents named only in project metadata (`` `name` — role``, slug from the name without emoji), each with `slug`, `name`, `role`, `scope`, `model`, `mode`, `defined` (has a file), and `projects` (scope projects resolved)
- **FR:agent.resolve** (P1): `agentFor(team, project, section?)` returns the agents whose scope covers the task, most specific first: `project/section` beats `project` beats `*`; ties keep file order then metadata order. The first is the active agent. A task with no match has none (the page says so)

### FR:driver: Per-prompt options (additive to agent-sessions)

- **FR:driver.options** (P1): `PromptRequest.options` may carry `systemPrompt` (appended to the Claude Code preset), `model`, `title` (the session's title), `allowedTools` and `disallowedTools`, and `schema` (a JSON schema for a structured answer). The SDK driver passes them to `query()`; the `done` update then carries `text` (the final assistant text) and `structured` (the parsed answer when a schema was given). An agent's own `tools` list is never put in `allowedTools` (a bare entry auto-approves the tool and would skip the permission ask); only a read-only review pre-approves the read tools and forbids `Bash`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`
- **FR:driver.cwd** (P1): `createRunManager({cwd})` names the served folder; a new session without `cwd` runs there, so a task session always works in the repo its task file lives in

### FR:talk: A session for an agent on a task

- **FR:talk.start** (P1): `startAgentRun(runs, ctx, {agent?, ref?, project?, text, actor})` resolves the agent (the given slug, else the active agent for the task's project and section, else 404 `No agent for <project>`), builds the task context (project title, section, parent, the row with its notes and subtasks; 404 for a missing row), and starts a new session with `options.systemPrompt` = the agent's persona (name, role, scope, the ask rule) plus its prompt plus the context, `options.model` from the agent, and `options.title` = `<agent name> · <task title> · <ref>` (or `· <project>` without a task). The page maps sessions to tasks by that title suffix
- **FR:talk.api** (P1): `POST /sessions` (route `sessions.new`, unchanged scope and owner rule) accepts `agent` and `ref` (or `project`) beside `text`; `cwd` becomes optional (default: the served folder). With `ref` the handler calls `FR:talk.start`; the reply is the run and session id as before

### FR:review: Task review

- **FR:review.run** (P1): `reviewTask(runs, ctx, ref, agent?, actor)` starts an `ad-hoc` read-only session for the active agent (or the given one) with the review prompt and the JSON schema `{verdict: 'can'|'partial'|'cannot', plan: string (one line), estimate: string (e.g. 2h), needs: [{what: string, kind: 'answer'|'go-do'|'approve', why?: string}], risks?: string[]}` and returns `{runId, sessionId}` at once; the rest happens when the run's `done` arrives
- **FR:review.record** (P1): The verdict is written as a result log entry (`recordResult` with `action: review`, `outcome` `done` for `can`, `partial` for `partial`, `blocked` for `cannot`, `summary` `<verdict>: <plan> (<estimate>)`), which never adds a 🙋 row or completes the task. A run that ends without a verdict (error, cancel, no JSON) records nothing
- **FR:review.needs** (P1): Each `need` (at most 9) becomes an ask `rev-<task slug>-<line>-<stamp>-<n>` (`kind` from the need, else `answer`; `from` the agent; `project`; `why` the task title and the need's why; `priority: normal`; `blocks: 1`; `effort: 2m`; `reversible: no`). Open asks of an earlier review of the same row are resolved first (`reviewed again`)
- **FR:review.read** (P1): `reviewOf(ctx, ref, openAskKeys)` returns the newest review entry for the row `{at, verdict, plan, estimate, agent, needs: open ask keys}` or null; `listReviews(ctx, project)` returns every row's newest review in that project
- **FR:review.api** (P1): `POST /tasks/review` `{ref, agent?}` (route `tasks.review`, scope `tasks:write`, owner only: a token gets 403; 404 without a runner like every sessions route) returns `202 {runId, sessionId}`. `GET /reviews?project=` (route `reviews.list`, scope `tasks:read`) returns `{items: [{ref, at, verdict, plan, estimate?, agent, needs}]}`. `GET /team?project=&section=` (route `team.list`, scope `tasks:read`) returns `{items}` from `FR:agent.team`, filtered to the scope when `project` is given, active first. All in `docs/api/openapi.yaml`

### FR:cli: Commands

- **FR:cli.agents** (P1): `stack agents list [--project p --section s] [--json]` prints the team (`slug  name  scope`) or the api shape. `stack agents add <slug> --name n --scope s [--role r --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]` writes the file

### FR:web: AI on every page

- **FR:web.chip** (P1): Every task row shows its active agent as a quiet chip after the chips when the row is the cursor or hovered (`🎧 Cid Manager`; `No agent` muted when none). A reviewed row shows the verdict in the chip instead: `Can · 2h`, `Partial · needs 2`, `Can't`; the title attribute carries the plan. A row with a session running for it shows `Working` with the accent dot; one waiting on a permission shows `Needs you`. The chip opens the inline talk
- **FR:web.talk** (P1): `a` on a row (or the chip) opens an inline composer under the row: `To <agent> ▾` picks from the task's team (most specific first), three quick actions `Review` (`R`), `Do it`, `Plan`, a text line, and `Keep open`. `Enter` starts a session with the text (`Do it`: "Do this task. Bring me anything you need as an ask."; `Plan`: "Plan this task in steps; do not start it."); `Esc` closes. With `Keep open` the session drawer (from agent-sessions) opens on the new session and stays; without it the row's chip follows the session (`Working`, then `Done · $0.12` for 10 minutes) and the drawer is one click away. Only one composer is open at a time; typing in it never triggers shortcuts
- **FR:web.anything** (P1): The same composer opens from an ask card (`a`: the ask's agent when it is a team member, else the project's active agent; the ask text is the context) and from a project tile (`a`: the project's active agent, no task). The composer says what it is about (`About: <title>`)
- **FR:web.review** (P1): `R` on a row (or `Review` in the composer) calls `POST /tasks/review`; the chip shows `Reviewing…` until the run ends, then the verdict. `needs n` in the chip opens Asks. On a project list the header shows the project's active agent (`Agent: 🎧 Cid Manager`)
- **FR:web.norunner** (P1): Without a runner (`/.auth/me` `agents: false`) the chip and the review verdicts still show, but the composer's Send is replaced by `Runs in stack web on your machine`
- **FR:web.keys** (P1): `a` talk, `R` review, in the composer `Enter`, `Esc`, `↓`/`↑` through the agent picker; every action is in the palette and the `?` help. Keys are ignored while typing
- **FR:web.a11y** (P1): The composer is a labelled region; focus moves into it on open and back to the row on close; the chip is a button with a full label; 44 px targets on touch; contrast at least 4.5:1; motion 120-200 ms and off with `prefers-reduced-motion`; works at 390, 1024 and 1440 px, light and dark

## Dependencies

- agent-sessions (driver, run manager, permission broker, Sessions view and drawer), ask-queue (asks as the need channel), agent-inbox (redaction), ai-triage-assist (`recordResult`), api, auth-security, storage-git, web-app
