---
id: agent-sessions
title: Agent Sessions
author: flanakin
description: "Local Claude sessions on the dashboard: by project priority, messaged and streamed, usage not cost, permissions as asks"
dependencies: [ask-queue, api, auth-security, web-app, task-model]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Sessions

## Purpose

The owner's agents run as Claude sessions (Claude Desktop, Claude Code, the SDK). Today he can only see or steer them in each chat window, and a permission prompt stalls an agent until he finds it. This feature puts the sessions on the dashboard: what is running, what it used, the last thing it said; a message box that resumes a session from the dashboard with its reply streaming in; permission prompts that arrive as asks on the home view (with a default, so a forgotten prompt never blocks an agent forever); and a usage view by day and project. It ends at sessions: who the agents are, how they report to each other, and which agent a task belongs to is the team's concern.

Design decision and the protocol comparison: `.xe/features/design-decisions.md` ("Drive agents through the Claude Agent SDK behind an ACP-shaped driver").

## Scope

- In: the `AgentDriver` interface (ACP vocabulary), the SDK driver, session list and transcript reads from the local session store, which Stack project owns a session's repo, prompt and cancel with a streamed update feed, permission requests as asks, usage aggregation, API routes, the Agents view with its drawer, pins, project scope, priority order and usage strip, the prompt-first new-session composer.
- Out: an ACP transport driver (next; the interface is shaped for it), driving remote or cloud sessions, editing session files, scheduling runs, per-token budgets by project, the artifact-based AI team panel on Today (`FR:agent-inbox/activity.*`, unchanged), the team of agents and its reporting line (the team feature layers those onto this view).

## Driver vocabulary (ACP-shaped)

A **session** is one transcript (`id`, `title`, `cwd`, `branch`, `lastActive`). A **run** is one prompt sent to a session from Stack and the stream of **updates** it produces until it stops. Updates: `message_chunk` (`role`, `text`), `tool_call` (`callId`, `title`, `kind`, `status`), `tool_update` (`callId`, `status`, `output?`), `permission` (`requestId`, `title`, `options[{optionId, name, kind}]`), `done` (`stopReason`: `end_turn`, `cancelled`, `max_budget`, `error`; `cost`: `{usd, tokens}`; `error?`). Permission option kinds are ACP's: `allow_once`, `allow_always`, `reject_once`.

## Scenarios

### FR:driver: Driver

Stack System needs one driver interface over the local Claude session store and runner so that the API and the web app never depend on a vendor SDK.

- **FR:driver.interface** (P1): `AgentDriver` exposes `listSessions({limit?})`, `getMessages(id, {limit?})`, `prompt({sessionId?, cwd?, text, onPermission})` returning a `Run` (`id`, `sessionId`, an async iterable of updates), and `cancel(runId)`. The API and the web app depend only on this interface; a driver is injected (`ApiDeps.agents`), and every route in `FR:sessions` and `FR:run` answers `404 not_found` when none is configured
- **FR:driver.sdk** (P1): `createSdkDriver({sdk?, store?, maxBudgetUsd?, activeMs?})` implements the interface over `@anthropic-ai/claude-agent-sdk`. `listSessions` comes from Stack's own store index (`createStoreIndex`): a stat scan of `<config>/projects/*/*.jsonl` newest first, and for the newest `limit` files a head and tail sample (cwd, branch, latest custom title, first prompt without system reminders, pull request links, side-chain flag) and a usage line scan that runs in the background one file at a time and re-reads only the bytes appended since the last scan (a file that shrank starts over), cached by size and mtime (the SDK's `listSessions` parses every transcript on every call: 70 s for 7,000 sessions). Side-chain transcripts are not sessions. `getMessages` uses the SDK's `getSessionMessages`; `prompt` calls `query({prompt, options: {resume, cwd, includePartialMessages: true, canUseTool, abortController, maxBudgetUsd}})` and maps `stream_event` text deltas to `message_chunk`, assistant `tool_use` blocks to `tool_call` (kind from the tool name: `Bash` → `execute`, `Read`/`Glob`/`Grep` → `read`/`search`, `Edit`/`Write` → `edit`, `WebFetch`/`WebSearch` → `fetch`, else `other`), `tool_result` blocks to `tool_update`, and the `result` message to `done` with `total_cost_usd` and the token sum of `modelUsage`. The SDK module is loaded lazily on first use, never at import time, so tests, the CLI, and the Azure host never load the native binary. `sdk` is injectable for tests
- **FR:driver.active** (P1): A session whose transcript changed within `activeMs` (default 120 s) is `active` (another client is writing it); a change this process made itself (its own run ended within the last 30 s) does not count. `prompt` on an active session is refused with `SessionBusy` (409: `Session is active elsewhere; message it through its inbox`), so two writers never append to one transcript. A session with a Stack run in flight is `running`; a second prompt to it is also `SessionBusy`
- **FR:driver.cost** (P1): A session's cost is the transcript's last `cost-state` record (the CLI's own accounting, exact up to that line) plus every assistant `usage` after it priced from the list-price table in `src/agents/store.ts` (input, output, 5-minute and 1-hour cache writes, cache reads; dated model ids price as their base id). Tokens are `input + output + cacheRead + cacheWrite`. Until the background scan has read a transcript to its end its cost is marked `approx` (and the list and usage report carry `indexing`, the number of files still queued); a model not in the table adds tokens but no dollars and also marks `approx`. A missing or unreadable transcript costs `{usd: 0, tokens: 0}`, never an error
  - Dollars are the list-price equivalent of the tokens, kept for relative weight; the owner runs on one prepaid plan, so the page reads them as usage, never as a bill (`FR:web.usage`)

### FR:sessions: Reading sessions

Owner needs the sessions on this machine listed with their project, state and usage so that he sees at a glance what his agents are doing and what it took.

- **FR:sessions.list** (P1): `GET /sessions?limit=` (route `sessions.list`, scope `tasks:read`, limit 1-200 default 50) returns `{items, total, indexing}`: per session `id`, `title` (custom title, else the summary, else the first prompt, trimmed to 80 characters, redacted like inbox fields), `project` (the repo folder name; a `.claude/worktrees/<x>` path reports the repo), `owner` (`FR:sessions.owner`), `cwd`, `branch`, `lastActive` (ISO), `state` (`running`, `needs-you` when a permission ask of this session is open, `active`, `idle` under 24 h, else `stale`), `cost` (`usd`, `tokens`, `approx?`), `prs` (pull request urls recorded in the transcript, at most 5). Order: `needs-you`, `running`, `active`, then newest `lastActive`
- **FR:sessions.owner** (P1): Session list MUST name on every session the Stack project that owns its repo (`owner`, a project name) or `null` when none does
  > - @req FR:task-model/$project
  - **FR:sessions.owner.repos** (P1): Project metadata MUST map repos to a project through `- **Repos:**` (a comma list or nested list of folder names or `owner/name` slugs), `- **Repository:**` (an `owner/name` link; its name part is the folder), the project name, and its `Aliases`
    - A folder matches when it equals one of those names, or starts with one of them followed by `-` (`allyte-web` belongs to `allyte`, `f4-music` to `flantastic-4` through the alias `f4`); folder names compare case-insensitively and `_` as `-`
    - A folder claimed by two projects goes to the one with the longer matching name, then the one whose file sorts first
  - **FR:sessions.owner.worktree** (P1): Session list MUST resolve a worktree folder (`<repo>/.claude/worktrees/<x>`, `<repo>.worktrees/<x>`, `<repo>-wt-<x>`) to its repo before matching
- **FR:sessions.messages** (P1): `GET /sessions/{id}/messages?limit=` (route `sessions.messages`, scope `tasks:read`, limit 1-200 default 30) returns the last `limit` turns (the newest, not the oldest page) as `{items: [{at, role, text}]}`: user and assistant text, with tool calls collapsed to one line `⚙ <tool>: <first 80 chars of input>`, each text cut at 2000 characters; message text is redacted like inbox fields, tool input only loses control characters (paths and commands must stay readable). Unknown id is 404
- **FR:sessions.cost** (P1): `GET /sessions/cost?days=` (route `sessions.cost`, scope `tasks:read`, days 1-90 default 7) returns `{indexing, days: [{date, usd, tokens, sessions}], projects: [{project, usd, tokens, sessions}], models: [{model, usd, tokens}], total: {usd, tokens, sessions}}`. A session's cost counts on the date of its `lastActive` in the owner's configured timezone (`config.timezone`, else UTC); one bucket per session, a long session is not split by day, and the response says `attribution: "lastActive"`. Days are listed oldest first with zero rows for quiet days
  - `projects` buckets by the session's `owner` when it has one, else by its repo folder, so the usage view can read by Stack project

### FR:run: Prompting a session

Owner needs to resume or start a session from the dashboard and watch its reply stream so that he never has to find the chat window.

- **FR:run.prompt** (P1): `POST /sessions/{id}/prompt` `{text}` resumes that session and `POST /sessions` `{cwd, text}` starts a new one (routes `sessions.prompt`, `sessions.new`, scope `tasks:write`). Only the owner session may call them: a token caller gets `403 forbidden`, so an agent can never speak as the owner to another agent. `text` is 1-4000 characters; `cwd` must be an absolute path that exists. Reply `202 {runId, sessionId}` (`sessionId` of a new session is set once the driver reports it). `SessionBusy` is 409
- **FR:run.events** (P1): `GET /sessions/{id}/events` on `stack web` (outside `/api`, same loopback and Host guards as `/events`) is a server-sent event stream for the session's current or last run: it sends its headers at once, replays the buffered updates, then streams, one `event: update` per update with the update as JSON, and closes after `done`. A run's updates are kept for 10 minutes after it stops so a reopened drawer still shows the result; a session with no run answers `204`
- **FR:run.cancel** (P1): `POST /sessions/{id}/cancel` (route `sessions.cancel`, scope `tasks:write`, owner only) aborts the run in flight; the run ends with `done` `{stopReason: "cancelled"}`. No run is `{changed: false}`
- **FR:run.record** (P2): Every run writes one line to `tasks/logs/sessions.md` when it stops: `- <iso> <sessionId8> <stopReason> $<usd> <tokens> tokens: <first 120 chars of the prompt>`. Secrets are redacted. This is the only task-repo write a run makes

### FR:perm: Permission prompts as asks

Owner needs an agent's permission prompt to reach him as an ask with a default so that a forgotten prompt never blocks an agent forever.

- **FR:perm.ask** (P1): A `permission` update becomes an ask `perm-<sessionId8>-<requestId>` (kind `decide`, from `session:<title>`, project from `cwd`) with `ask` = the request title (e.g. `Allow Bash: git push origin main`), `why` = the first 200 characters of the input (redacted), `options` = the request's option names in order (`Allow once`, `Allow for this session`, `Deny`), `recommend` = `Allow once` unless the driver flags the request as risky (`defaultToNo`), then `Deny`; `default` = `Denied; the agent continues without it`, `reversible: yes`, `by` = now + 10 minutes, `priority: high`, `effort: 1m`, `detail` = the full input as JSON (cut at 4000 characters). The run's `permission` update stays in the stream so the drawer shows `Waiting for you` with a link to Asks. Keys starting `perm-` are reserved for the broker: `POST /asks/{key}` with an API token on such a key is `403`, so no agent can rewrite another session's permission prompt (security review)
  > - @req FR:ask-queue/flow.put
- **FR:perm.answer** (P1): The broker watches that ask (storage reads every second, or the watcher when present) and resolves the driver's request: option `Allow once` → `{behavior: "allow"}`; `Allow for this session` → allow, and the same tool name is allowed without asking for the rest of that run; `Deny` or answer `no` → `{behavior: "deny", message: "Denied by the owner"}`; a `reply` or `ask` answer → deny with the owner's text as the message, so the agent reads his words. The broker then handles the ask (`handled`, note = the choice). A session with an open permission ask is `needs-you`
- **FR:perm.timeout** (P1): When `by` passes unanswered, the broker denies (`message: "No answer in 10 minutes"`), handles the ask as `defaulted`, and the run continues. Cancelling the run resolves any open permission ask as `resolved`. A `perm-*` ask left open by a process that no longer runs is defaulted the first time its deadline is seen to have passed, so no session stays `needs-you` for a run that is gone

### FR:web: Agents view

Owner needs one page of his agents' sessions, ordered by what matters now, so that he sees what to answer, what is running, and what each one used without reading every row.

- **FR:web.view** (P1): The `Agents` view (`#/agents`, rail after Needs you, `g s`) opens with a usage strip (`FR:web.usage`) and one row per session: a state dot and label (`Needs you`, `Running`, `Active`, `Idle`, muted for `Stale`), the title, `project · branch` (a worktree slug branch like `xe/zany-fox-1a2b3c` shows the project only; the branch is in the drawer), last active (`12 min ago`), and usage (`1.2M`, `≈` while indexing). On phones each row is the title, then state, last active and usage. 20 rows, the rest behind `Show n more`. The list reloads every 15 s while visible and after every run ends
- **FR:web.agents** (P1): The view is called **Agents** everywhere (rail, tab title, palette, help, copy): `#/agents` (old `#/sessions` still opens it), `g s`. Rows are agent sessions; the heading reads `Agents`
- **FR:web.scope** (P1): Agents view MUST show by default only the sessions whose repo a Stack project owns (`owner` set) or that are pinned
  > - @req FR:sessions.owner
  - **FR:web.scope.all** (P1): `Show all` (`A`) MUST reveal the hidden sessions, each marked with its repo folder, until the view is left; the count of hidden sessions reads `n more from other repos` under the list
  - A session a team feature ties to an agent counts as owned (that feature says how); this view only promises the repo rule
- **FR:web.order** (P1): Agents view MUST order sessions by attention (`needs-you`, `running`, `active`), then by the priority of the owning project, then newest `lastActive`
  > - @req FR:web-app/home2.order
  - **FR:web.order.project** (P1): Project priority MUST be the Home order of projects (the rank of each project's top task); sessions without an owner sort after every owned project
  - Pins never reorder a project; they only lift rows within what is shown (`FR:web.pins`)
- **FR:web.pins** (P1): Every row has a pin (★ on hover or cursor, `f` on the cursor row). Pinned rows always show, whatever their repo, and sit first under a **Pinned** header, in the order they were pinned, then the rest in `FR:web.order`. Pins are kept in browser storage (`stack.pins`, session ids) and survive reloads; unpinning returns the row to its place
- **FR:web.groups** (P1): `p` (or the **Projects** toggle) groups the rows by owning project with one header per project, projects in priority order, sessions without an owner last under `Other repos` (only when shown); pinned rows stay first. The choice is kept in browser storage (`stack.agents.group`, value `project`; a team feature may add other values)
- **FR:web.drawer** (P1): `Enter` or a click on a row opens a drawer (right side from 1024 px, full-height sheet on phones) with the session title and facts (state · last active · project · branch · usage), the last turns from `GET /sessions/{id}/messages` (newest at the bottom), and a message box. While a run streams, the drawer appends assistant text as it arrives, shows each tool call as one line with a status mark (`⚙ Bash: git status ✓`), shows `Waiting for you` with an `Open in Asks` link on a permission update, and ends with `Done · 41k tokens · 3 turns` (or the error). `Esc` closes; the list stays usable behind it; focus returns to the row
- **FR:web.message** (P1): In the drawer `Enter` sends the text (`Shift+Enter` newline); the box clears and the stream opens. `Stop` cancels; `Esc` only closes the drawer (the run keeps going and its updates replay when the drawer reopens). A `409` shows inline `This session is active in another window; message it there or through its inbox`. A `needs-you` row's action is `Answer in Asks` (jumps to the ask)
- ~~**FR:web.cost**~~: [deprecated: FR:web.usage]
- **FR:web.usage** (P1): Agents view MUST present spend as token usage: the strip reads `Today 1.2M tokens · 6 sessions`, then `7 days 31M`; rows and drawer facts show tokens (`fmtTokens`), never dollars
  > - @req FR:sessions.cost
  - **FR:web.usage.panel** (P1): `Usage` (`c` in the view) MUST expand under the strip: one line per day for the last 7 days (`Mon 27 · 410k · 4 sessions`, bar scaled to the week's max tokens), the per-project totals (`allyte 14M · stack 9.8M`), and the model mix as one muted line
  - **FR:web.usage.price** (P2): Usage panel MUST end with one muted line `≈ $31 at list price · prepaid plan` so the dollar weight stays readable without reading as a bill
- **FR:web.new** (P1): `n` (or **New**) MUST open the new-session composer as a drawer whose first element is the prompt box, focused, with the folder as a secondary field under it (the cursor session's repo prefilled, every known repo offered, any absolute path accepted)
  - **FR:web.new.submit** (P1): In the composer `Cmd+Enter` / `Ctrl+Enter` MUST start the session; plain `Enter` is a newline, and **Start** shows the chord (`⌘⏎`)
  - **FR:web.new.context** (P1): The composer MUST let a team feature put a chooser above the prompt that sets the folder; the folder field then reads as `Runs in <repo>` with `Change` to edit it
  - A prompt is a brief, often several lines: the chord keeps a stray Enter from sending half of it
- **FR:web.states** (P1): Empty (`No sessions for your projects yet.` with `Show all` when other repos have some, else `No sessions on this machine yet.`), error with Retry, loading skeletons, and a `Not available on this host` note when `/.auth/me` has no `agents: true` (the Azure host). `/.auth/me` on `stack web` carries `agents: true` when a driver is wired
- **FR:web.keys** (P1): `j`/`k` move, `Enter` opens, `Esc` closes, `s` stops the open session (from the list, a second `s` within 2 s confirms), `c` toggles Usage, `n` new session, `A` shows all repos, `f` pins, `p` groups by project, `m` shows more; every action is in the palette and `?` help. Keys are ignored while typing
- **FR:web.a11y** (P1): The drawer is a labelled `dialog` with a focus trap and the stream region is `aria-live="polite"` for tool status lines only (not every text chunk); rows are buttons with full labels; 44 px targets on touch; contrast at least 4.5:1; motion 120-200 ms and off with `prefers-reduced-motion`; light and dark designed

## Data Model

- **FR:$session** (P1): **`Session`** — One transcript on this machine as the list reports it.
  - `id` (string) — the transcript id
  - `title` (string) — custom title, else summary, else first prompt; at most 80 characters, redacted
  - `project` (string) — the repo folder name (worktrees resolve to their repo)
  - `owner` (string?) — the Stack project that owns the repo, or null
  - `cwd` (string)
  - `branch` (string?)
  - `lastActive` (string) — ISO time of the last transcript change
  - `state` (string)
    - Allowed: `needs-you`, `running`, `active`, `idle`, `stale`
  - `cost` (@req FR:$cost)
  - `prs` (string[]) — pull request urls, at most 5

- **FR:$cost** (P1): **`Cost`** — What a session or a bucket used.
  - `usd` (double) — list-price equivalent
  - `tokens` (integer) — input + output + cacheRead + cacheWrite
  - `approx` (boolean?) — true until the transcript is indexed to its end or when a model has no list price

## Architecture Constraints

- The SDK module loads lazily on first use, never at import time (`FR:driver.sdk`): tests, the CLI and the Azure host never load the native binary
- Only the owner session may prompt or cancel (`FR:run.prompt`, `FR:run.cancel`): a token caller is never an agent speaking as the owner
- A run's only task-repo write is its log line (`FR:run.record`)

## External Dependencies

- `@anthropic-ai/claude-agent-sdk` — the session store reader and runner behind the SDK driver
