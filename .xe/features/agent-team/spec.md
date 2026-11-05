---
id: agent-team
title: Agent Team
author: flanakin
description: "AI on every page: agents from Stack and Claude definitions with a reporting line, CoS first on every task, org tree"
dependencies: [agent-sessions, ask-queue, agent-inbox, ai-triage-assist, api, auth-security, storage-git, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Team

## Purpose

`agent-sessions` runs Claude sessions from the dashboard and shows them in one view. This feature makes those sessions belong to the tasks and to a team: every agent the owner has defined (in the task repo or as a Claude agent) is known with its scope and who it reports to; every task knows its agents, the Chief of Staff first; a task can be handed to its agent in one keystroke from the row it sits on; and a review says, before any work starts, whether the agent can do it and what it needs from the owner. Research and decision: `docs/design/agents-research.md`.

## Scope

- In: agent definition files (`tasks/agents/<slug>.md` and `.claude/agents/<slug>.md`), scope and reporting-line resolution, the team route, per-prompt options on the agent driver (persona, model, title, tool limits, JSON answer), starting a session for an agent on a task or in a project's repo, task review with a JSON verdict recorded in the result log and needs written as asks, the reviews route, CLI `stack agents`, and the web: the agent chip on rows, the inline talk composer, review verdict chips, the org tree on the Agents page, the agent picker in the new-session composer, agents' sessions counted as owned.
- Out: automatic review of every task (one keystroke, one read-only session each; a session start costs about 50k context tokens), a second runner (ACP; the driver interface is ready), agents on the Azure host (no runner there: the page says so), editing `.claude/agents/*.md` from Stack (they belong to Claude; Stack reads them).

## Agent file formats

**Stack format (v1)**, one file per agent at `tasks/agents/<slug>.md` (slug `[a-z0-9][a-z0-9._-]{0,39}`). Fields are `- key: value` lines; the body under `## Prompt` is the system prompt addition.

```markdown
# Agent: cid-manager

<!-- stack-agent v1. Scope is a list of project or project/section prefixes; `*` is everything. -->

- name: 🎧 Cid Manager
- role: Label manager and F4 chief of staff
- scope: flantastic-4
- reports-to: cos
- model: sonnet
- mode: long-running

## Prompt

Read `.stack/cos-charter.md` first. You own every task under your scope ...
```

**Claude format**, one file per agent at `.claude/agents/<slug>.md`: YAML frontmatter (`name`, `description`, `tools`, `model`, and the Stack keys `scope`, `reports-to`, `mode`, which Claude ignores) and a markdown body that is the agent's prompt.

A project's `- **Agents:**` metadata (existing) names its team; an agent named there without a file still exists with a generated prompt. The agent whose scope is `*` is the roll-up: it owns every task and sits at the top of the reporting line. `cos` is the roll-up by convention when it declares no scope.

## Scenarios

### FR:agent: Definitions and scope

Owner needs every agent he has defined, in the task repo or for Claude, known to Stack with its scope and who it reports to so that the team on the page is the team he actually runs.

- **FR:agent.path** (P1): Storage accepts `tasks/agents/<slug>.md` and lists the folder (`listAgents`, filesystem and memory adapters). Agent files are never listed as projects
  > - @req FR:storage-git/interface.paths
  - **FR:agent.path.claude** (P1): Storage MUST read and list `.claude/agents/<slug>.md` (`listClaudeAgents`, filesystem and memory adapters) and refuse to write there
- **FR:agent.format** (P1): `formatAgent`/`parseAgent` round-trip the v1 format: `name` (1-60 chars), `role` (one line), `scope` (comma-separated prefixes `project` or `project/section` or `*`; default: the projects whose `Agents` metadata names the agent, else none), `reports-to` (a slug), `model` (`sonnet`, `opus`, `haiku`, or a model id), `tools` (comma list), `mode` (`long-running` or `ad-hoc`, default `ad-hoc`), then `## Prompt`. Unknown lines kept; bad values dropped
  - **FR:agent.format.claude** (P1): `parseClaudeAgent` MUST read the Claude format: `slug` from the file name, `name` from the first H1 (the text before a `:`), else the frontmatter `name`; `role` from the first sentence of `description` (cut at 80); `model`, `tools` (comma list), `scope`, `reports-to`, `mode` from the frontmatter; the body as `prompt`
    - A file without frontmatter is an agent with the file name as its name and the whole file as its prompt
- **FR:agent.team** (P1): `listTeam(ctx)` returns every agent from files plus agents named only in project metadata (`` `name` — role``; a backticked token inside a longer head is the name, so `` Subagent `allyte-cos` — prioritizes Allyte `` names `allyte-cos`; slug from the name without emoji), each with `slug`, `name`, `role`, `scope`, `model`, `mode`, `defined` (has a file), `source` (`stack`, `claude`, or `metadata`), `reportsTo`, and `projects` (scope projects resolved)
  - **FR:agent.team.order** (P1): `listTeam` MUST list Stack files first (file order), then Claude files (file order), then metadata-only agents (project order); a slug defined in both file folders keeps the Stack file
  - **FR:agent.team.rollup** (P1): `listTeam` MUST give the agent `cos` the scope `*` when it declares none; the first agent with scope `*` is the roll-up
  - **FR:agent.team.reports** (P1): `listTeam` MUST set `reportsTo` to the agent's `reports-to` when that slug exists, else to the narrowest other agent with a definition file whose projects strictly contain the agent's projects (fewest projects, then team order), else to the roll-up; the roll-up itself reports to no one
    - A metadata-only agent never manages by default: a project line naming a broad worker (a PR sweeper across five projects) is not a reporting line
    - A cycle in `reports-to` lines (`a → b → a`) breaks at the agent that sorts first in team order, which then reports to the roll-up
- **FR:agent.resolve** (P1): `agentFor(team, project, section?)` returns the agents whose scope covers the task, the roll-up first, then most specific first: `project/section` beats `project` beats `*`; ties keep team order. The first is the active agent and the default `To` of a talk. A task with no match has none (the page says so)
  - The roll-up owns every task (the owner's model: his Chief of Staff delegates); a specialist that also covers the task is second

### FR:driver: Per-prompt options (additive to agent-sessions)

Stack System needs to pass a persona, a model, a title, tool limits and a JSON answer shape with a prompt so that a session can act as a named agent on a task.

- **FR:driver.options** (P1): `PromptRequest.options` may carry `systemPrompt` (appended to the Claude Code preset), `model`, `title` (the session's title), `allowedTools` and `disallowedTools`, and `schema` (a JSON schema for a structured answer). The SDK driver passes them to `query()`; the `done` update then carries `text` (the final assistant text) and `structured` (the parsed answer when a schema was given). An agent's own `tools` list is never put in `allowedTools` (a bare entry auto-approves the tool and would skip the permission ask); only a read-only review pre-approves the read tools and forbids `Bash`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`
  > - @req FR:agent-sessions/driver.interface
- **FR:driver.cwd** (P1): `createRunManager({cwd})` names the served folder; a new session without `cwd` runs there, so a task session always works in the repo its task file lives in

### FR:talk: A session for an agent on a task

Owner needs to hand a task, a project, or a brief to one of his agents in a keystroke so that work starts without him opening a chat window.

- **FR:talk.start** (P1): `startAgentRun(runs, ctx, {agent?, ref?, project?, cwd?, text})` resolves the agent (the given slug, else the active agent for the task's project and section, else 404 `No agent for <project>`; a `project` that has no file is 404), builds the task context (project title, section, parent, the row with its notes and subtasks; 404 for a missing row), and starts a new session with `options.systemPrompt` = the agent's persona (name, role, scope, the ask rule) plus its prompt plus the context, `options.model` from the agent, and `options.title` = `<agent name> · <task title> · <ref>` cut so the whole title stays within the 80 characters the session store keeps and the suffix survives (`· <project>` without a task, the agent name alone without either). The page maps sessions to tasks by that title suffix
  - **FR:talk.start.cwd** (P1): `startAgentRun` MUST run the session in `cwd` when given, else in the served folder
- **FR:talk.api** (P1): `POST /sessions` (route `sessions.new`, unchanged scope and owner rule) accepts `agent` and `ref` (or `project`) beside `text`; `cwd` is optional (default: the served folder) and may come with any of them, so an agent can be started in its project's repo. With any of `agent`, `ref`, `project` the handler calls `FR:talk.start`; the reply is the run and session id plus `agent` and `title`
  > - @req FR:agent-sessions/run.prompt

### FR:review: Task review

Owner needs an agent to say whether it can do a task and what it needs first so that he learns the gaps before any work starts.

- **FR:review.run** (P1): `reviewTask(runs, ctx, ref, agent?, onError?)` refuses a 🙋 row (403 `Needs a human`: no paid run for the owner's own work) and otherwise starts an `ad-hoc` read-only session (`Read`, `Grep`, `Glob`, `TodoWrite` pre-approved; the web tools and every writer still ask) for the active agent (or the given one) with the review prompt and the JSON schema `{verdict: 'can'|'partial'|'cannot', plan: string (one line), estimate: string (e.g. 2h), needs: [{what: string, kind: 'answer'|'go-do'|'approve', why?: string}], risks?: string[]}` and returns `{runId, sessionId}` at once; the rest happens when the run's `done` arrives
- **FR:review.record** (P1): The verdict is written as a result log entry (`recordResult` with `action: review`, `outcome` `done` for `can`, `partial` for `partial`, `blocked` for `cannot`, `summary` `<verdict>: <plan> (<estimate>)`), which never adds a 🙋 row or completes the task. A run that ends without a verdict (error, cancel, no JSON) records nothing; a failure while recording (a storage conflict) goes to `onError` (default: the server log), never silently
  > - @req FR:ai-triage-assist/result.log
- **FR:review.needs** (P1): Each `need` (at most 9) becomes an ask `rev-<task slug>-<line>-<stamp>-<n>` (`kind` from the need, else `answer`; `from` the agent; `project`; `why` the task title and the need's why; `priority: normal`; `blocks: 1`; `effort: 2m`; `reversible: no`). Open asks of an earlier review of the same row are resolved first (`reviewed again`)
  > - @req FR:ask-queue/flow.put
- **FR:review.read** (P1): `reviewOf(ctx, ref, openAskKeys)` returns the newest review entry for the row `{at, verdict, plan, estimate, agent, needs: open ask keys}` or null; `listReviews(ctx, project)` returns every row's newest review in that project
- **FR:review.api** (P1): `POST /tasks/review` `{ref, agent?}` (route `tasks.review`, scope `tasks:write`, owner only: a token gets 403; 404 without a runner like every sessions route) returns `202 {runId, sessionId}`. `GET /reviews?project=` (route `reviews.list`, scope `tasks:read`) returns `{items: [{ref, at, verdict, plan, estimate?, agent, needs}]}`. `GET /team?project=&section=` (route `team.list`, scope `tasks:read`) returns `{items}` from `FR:agent.team`, filtered to the scope when `project` is given, in `FR:agent.resolve` order. All in `docs/api/openapi.yaml`

### FR:cli: Commands

Owner needs the team from the command line so that scripts and agents read the same model the page shows.

- **FR:cli.agents** (P1): `stack agents list [--project p --section s] [--json]` prints the team (`slug  name  scope  reports-to`) or the api shape. `stack agents add <slug> --name n --scope s [--role r --reports-to a --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]` writes the Stack-format file

### FR:web: AI on every page

Owner needs the right agent one keystroke away from any task, ask, or project so that handing off work costs nothing.

- **FR:web.chip** (P1): Every task row shows its active agent as a quiet chip after the chips when the row is the cursor or hovered (`👔 CoS`; `No agent` muted when none). A reviewed row shows the verdict in the chip instead: `Can · 2h`, `Partial · needs 2`, `Can't`; the title attribute carries the plan. A row with a session running for it shows `Working` with the accent dot; one waiting on a permission shows `Needs you`. The chip opens the inline talk
  - **FR:web.chip.live** (P1): Page MUST drop from a task's agents every metadata-only agent (no file) that no session has matched in 7 days; agents with a file are never dropped
    - A session matches an agent when its title starts with the agent's name or slug (emoji and case ignored), or carries the ` · <ref>` suffix of a session the page started for it
  - **FR:web.chip.title** (P1): Chip title MUST list the task's agents in order (`👔 CoS › 🎧 Cid Manager`) so the chain is readable on hover
- **FR:web.talk** (P1): `a` on a row (or the chip) opens an inline composer under the row: `To <agent> ▾` picks from the task's team (the roll-up first, then most specific first), three quick actions `Review` (`R`), `Do it`, `Plan`, a text line, and `Keep open`. `Enter` starts a session with the text (`Do it`: "Do this task. Bring me anything you need as an ask."; `Plan`: "Plan this task in steps; do not start it."); `Esc` closes. With `Keep open` the session drawer (from agent-sessions) opens on the new session and stays; without it the row's chip follows the session (`Working`, then `Done · 41k` for 10 minutes) and the drawer is one click away. Only one composer is open at a time; typing in it never triggers shortcuts
- **FR:web.anything** (P1): The same composer opens from an ask card (`a`: the ask's agent when it is a team member, else the project's active agent; the ask text is the context) and from a project tile (`a`: the project's active agent, no task). The composer says what it is about (`About: <title>`)
- **FR:web.review** (P1): `R` on a row (or `Review` in the composer) calls `POST /tasks/review`; the chip shows `Reviewing…` until the run ends, then the verdict. `needs n` in the chip opens Asks. On a project list the header shows the project's active agent (`Agent: 👔 CoS`)
- **FR:web.norunner** (P1): Without a runner (`/.auth/me` `agents: false`) the chip and the review verdicts still show, but the composer's Send is replaced by `Runs in stack web on your machine`
- **FR:web.keys** (P1): `a` talk, `R` review, in the composer `Enter`, `Esc`, `↓`/`↑` through the agent picker; every action is in the palette and the `?` help. Keys are ignored while typing
- **FR:web.a11y** (P1): The composer is a labelled region; focus moves into it on open and back to the row on close; the chip is a button with a full label; 44 px targets on touch; contrast at least 4.5:1; motion 120-200 ms and off with `prefers-reduced-motion`; works at 390, 1024 and 1440 px, light and dark

### FR:org: The team on the Agents page

Owner needs the Agents page to show his agents as the reporting structure they have so that he reads who runs what, and what each one is doing, without a flat list.

- **FR:org.tree** (P1): Agents view MUST open in the **Team** grouping (`t`, kept in browser storage as `stack.agents.group` = `team`): the roll-up at the top, each agent nested under the one it reports to, and under each agent its sessions
  > - @req FR:agent-sessions/web.groups
  - **FR:org.tree.row** (P1): An agent row MUST show its name, its role muted, the projects it covers as quiet chips, and its usage over the last 7 days (the sum of its sessions' tokens); an agent with no session shows `No sessions` muted and a `Talk` action
  - **FR:org.tree.fold** (P1): Under one manager, agents with no session and no reports of their own MUST fold into one quiet `Also: a · b · c` line (each name opens the composer with that agent), so a team of many idle workers stays one screen
  - **FR:org.tree.sessions** (P1): Under an agent the page MUST list its sessions in attention order (`needs-you`, `running`, `active`, then newest), the first 3, the rest behind `n more` on that agent
  - **FR:org.tree.unmatched** (P1): Sessions of an owned project that match no agent MUST sit under an `Unassigned` branch at the end, grouped by project in priority order
  - **FR:org.tree.pinned** (P1): A pinned session MUST keep its place in the tree and be marked; pins never reorder the tree
  - **FR:org.tree.phone** (P1): On phones the tree MUST indent one step per level with the agent row on one line (name, usage) and its sessions as the usual phone rows
- **FR:org.order** (P1): Agents view MUST order the agents under one manager by the priority of the first project each covers (the Home project order), then by team order; an agent covering no listed project sorts last
  > - @req FR:agent-sessions/web.order
  - **FR:org.order.scope** (P1): Agents view MUST show by default only agents that cover at least one project, or that have a pinned or attention-state (`needs-you`, `running`) session; `Show all` (`A`) reveals the rest
    > - @req FR:agent-sessions/web.scope
- **FR:org.match** (P1): Page MUST tie a session to an agent when its title starts with the agent's name, slug, or short role (at most four words, so `Chief of Staff` claims `👩 💼 Chief of Staff`; emoji and case ignored) or ends with the ` · <ref>` / ` · <project>` suffix of a session started for that agent; a session tied to an agent counts as owned, whatever its repo
  > - @req FR:agent-sessions/web.scope
- **FR:org.keys** (P1): `t` Team grouping, `p` by project, pressing the active one again returns to the flat list; `Enter` on an agent row opens the new-session composer with that agent chosen; every action is in the palette and `?` help
- **FR:org.a11y** (P1): The tree MUST be a `tree` with `treeitem` rows and `aria-level`, the agent rows buttons with full labels (`👔 CoS, Chief of Staff, 4 sessions, 1.2M tokens`), 44 px targets on touch, contrast at least 4.5:1, light and dark designed

### FR:compose: Agent-first new session

Owner needs to start a session by picking one of his agents and writing the brief so that the folder and the persona follow from the choice.

- **FR:compose.agent** (P1): The new-session composer (`n`, **New**, `Enter` on an agent row) MUST open with an **Agent** chooser above the prompt listing the team in `FR:org.order` (the roll-up first, then by project priority), each with its name, role and projects, plus `No agent (plain session)` last
  > - @req FR:agent-sessions/web.new
  - **FR:compose.agent.default** (P1): The chooser MUST preselect the agent of the cursor row (its session's agent, or the agent row itself), else the roll-up
  - **FR:compose.agent.filter** (P2): Typing in the chooser MUST filter agents by name, slug, role or project
- **FR:compose.folder** (P1): Choosing an agent MUST set the folder to the repo the agent last ran in (its newest matched session, worktrees resolved), else the repo of its first project with one (that project's newest session), else the served folder; the folder reads `Runs in <repo>` with `Change` to edit it
  > - @req FR:agent-sessions/sessions.owner
- **FR:compose.prompt** (P1): The prompt box MUST stay the first focused element; the chooser is reached with `Shift+Tab` or a click, and `Cmd+Enter` / `Ctrl+Enter` starts the session with `{agent, project, cwd, text}` (`{cwd, text}` for a plain session)
  > - @req FR:talk.api
- **FR:compose.after** (P1): After start the drawer MUST follow the new session (its title `<agent> · <project>`), and the Agents page reloads so the session appears under its agent

## Data Model

- **FR:$team-agent** (P1): **`TeamAgent`** — One agent as the team route reports it.
  - `slug` (string) — `[a-z0-9][a-z0-9._-]{0,39}`
  - `name` (string) — display name, 1-60 characters, may start with an emoji
  - `role` (string?) — one line
  - `scope` (string[]) — `project`, `project/section`, or `*`
  - `reportsTo` (string?) — the slug of the manager; absent on the roll-up
  - `model` (string?)
  - `tools` (string[]?)
  - `mode` (string)
    - Allowed: `long-running`, `ad-hoc`. Default: `ad-hoc`.
  - `prompt` (string) — the system prompt addition, at most 20,000 characters
  - `defined` (boolean) — true when a file exists
  - `source` (string)
    - Allowed: `stack`, `claude`, `metadata`
  - `projects` (string[]) — the scope resolved to project names (`*` lists every project)
  - Relationships: `reportsTo` names another `TeamAgent`; the graph is a tree rooted at the roll-up.

## Architecture Constraints

- Stack reads `.claude/agents/*.md` and never writes there (`FR:agent.path.claude`): those files belong to Claude
- An agent's own `tools` list never reaches `allowedTools` (`FR:driver.options`): a bare entry would skip the permission ask
- The page mirrors the server's scope and match rules in pure helpers (`web/src/team.ts`) so a row never waits on a round trip to show its agent

## External Dependencies

None
