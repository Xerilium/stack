---
id: agent-sessions
title: Agent Sessions
author: flanakin
description: "Live Claude sessions on this machine in the dashboard: list them with cost, read and message them, watch a run stream, and answer their permission prompts as asks. Built on the Claude Agent SDK behind an ACP-shaped driver interface."
dependencies: [ask-queue, api, auth-security, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Sessions

## Purpose

The owner's agents run as Claude sessions (Claude Desktop, Claude Code, the SDK). Today he can only see or steer them in each chat window, and a permission prompt stalls an agent until he finds it. This feature puts the sessions on the dashboard: what is running, what it cost, the last thing it said; a message box that resumes a session from the dashboard with its reply streaming in; permission prompts that arrive as asks on the home view (with a default, so a forgotten prompt never blocks an agent forever); and a capacity view of agent spend by day and project.

Design decision and the protocol comparison: `.xe/features/design-decisions.md` ("Drive agents through the Claude Agent SDK behind an ACP-shaped driver").

## Scope

- In: the `AgentDriver` interface (ACP vocabulary), the SDK driver, session list and transcript reads from the local session store, prompt and cancel with a streamed update feed, permission requests as asks, cost aggregation, API routes, the Sessions view with its drawer and cost strip.
- Out: an ACP transport driver (next; the interface is shaped for it), driving remote or cloud sessions, editing session files, scheduling runs, per-token budgets by project, the artifact-based AI team panel on Today (`FR:agent-inbox/activity.*`, unchanged).

## Driver vocabulary (ACP-shaped)

A **session** is one transcript (`id`, `title`, `cwd`, `branch`, `lastActive`). A **run** is one prompt sent to a session from Stack and the stream of **updates** it produces until it stops. Updates: `message_chunk` (`role`, `text`), `tool_call` (`callId`, `title`, `kind`, `status`), `tool_update` (`callId`, `status`, `output?`), `permission` (`requestId`, `title`, `options[{optionId, name, kind}]`), `done` (`stopReason`: `end_turn`, `cancelled`, `max_budget`, `error`; `cost`: `{usd, tokens}`; `error?`). Permission option kinds are ACP's: `allow_once`, `allow_always`, `reject_once`.

## Scenarios

### FR:driver: Driver

- **FR:driver.interface** (P1): `AgentDriver` exposes `listSessions({limit?})`, `getMessages(id, {limit?})`, `prompt({sessionId?, cwd?, text, onPermission})` returning a `Run` (`id`, `sessionId`, an async iterable of updates), and `cancel(runId)`. The API and the web app depend only on this interface; a driver is injected (`ApiDeps.agents`), and every route in `FR:agent-sessions/api.*` answers `404 not_found` when none is configured
- **FR:driver.sdk** (P1): `createSdkDriver({sdk?, maxBudgetUsd?, activeMs?})` implements the interface over `@anthropic-ai/claude-agent-sdk`: `listSessions` and `getMessages` read the local session store (`listSessions`, `getSessionMessages` with `includeWorktrees`); `prompt` calls `query({prompt, options: {resume, cwd, includePartialMessages: true, canUseTool, abortController, maxBudgetUsd}})` and maps `stream_event` text deltas to `message_chunk`, assistant `tool_use` blocks to `tool_call` (kind from the tool name: `Bash` → `execute`, `Read`/`Glob`/`Grep` → `read`/`search`, `Edit`/`Write` → `edit`, `WebFetch`/`WebSearch` → `fetch`, else `other`), `tool_result` blocks to `tool_update`, and the `result` message to `done` with `total_cost_usd` and the token sum of `modelUsage`. The SDK module is loaded lazily on first use, never at import time, so tests, the CLI, and the Azure host never load the native binary. `sdk` is injectable for tests
- **FR:driver.active** (P1): A session whose transcript changed within `activeMs` (default 120 s) is `active` (another client is writing it). `prompt` on an active session is refused with `SessionBusy` (409: `Session is active elsewhere; message it through its inbox`), so two writers never append to one transcript. A session with a Stack run in flight is `running`; a second prompt to it is also `SessionBusy`
- **FR:driver.cost** (P1): `sessionCost(id)` reads the transcript's `cost-state` record (`totalCostUSD`, `modelUsage`) when present, else sums assistant `usage` fields; tokens are `input + output + cacheRead + cacheWrite`. A missing or unreadable transcript gives `{usd: 0, tokens: 0, byModel: {}}`, never an error

### FR:sessions: Reading sessions

- **FR:sessions.list** (P1): `GET /sessions?limit=` (route `sessions.list`, scope `tasks:read`, limit 1-200 default 50) returns `{items, total}`: per session `id`, `title` (custom title, else the summary, else the first prompt, trimmed to 80 characters, redacted like inbox fields), `project` (the repo folder name; a `.claude/worktrees/<x>` path reports the repo), `cwd`, `branch`, `lastActive` (ISO), `state` (`running`, `needs-you` when a permission ask of this session is open, `active`, `idle` under 24 h, else `stale`), `cost` (`usd`, `tokens`), `prs` (pull request urls recorded in the transcript, at most 5). Order: `needs-you`, `running`, `active`, then newest `lastActive`
- **FR:sessions.messages** (P1): `GET /sessions/{id}/messages?limit=` (route `sessions.messages`, scope `tasks:read`, limit 1-200 default 30) returns the last turns as `{items: [{at, role, text}]}`: user and assistant text, with tool calls collapsed to one line `⚙ <tool>: <first 80 chars of input>`, each text cut at 2000 characters and redacted. Unknown id is 404
- **FR:sessions.cost** (P1): `GET /sessions/cost?days=` (route `sessions.cost`, scope `tasks:read`, days 1-90 default 7) returns `{days: [{date, usd, tokens, sessions}], projects: [{project, usd, tokens, sessions}], models: [{model, usd, tokens}], total: {usd, tokens, sessions}}`. A session's cost counts on the local date of its `lastActive` (one bucket per session; a long session is not split by day, and the response says `attribution: "lastActive"`). Days are listed oldest first with zero rows for quiet days

### FR:run: Prompting a session

- **FR:run.prompt** (P1): `POST /sessions/{id}/prompt` `{text}` resumes that session and `POST /sessions` `{cwd, text}` starts a new one (routes `sessions.prompt`, `sessions.new`, scope `tasks:write`). Only the owner session may call them: a token caller gets `403 forbidden`, so an agent can never speak as the owner to another agent. `text` is 1-4000 characters; `cwd` must be an absolute path that exists. Reply `202 {runId, sessionId}` (`sessionId` of a new session is set once the driver reports it). `SessionBusy` is 409
- **FR:run.events** (P1): `GET /sessions/{id}/events` on `stack web` (outside `/api`, same loopback and Host guards as `/events`) is a server-sent event stream for the session's current or last run: it replays the buffered updates, then streams, one `event: update` per update with the update as JSON, and closes after `done`. A run's updates are kept for 10 minutes after it stops so a reopened drawer still shows the result; a session with no run answers `204`
- **FR:run.cancel** (P1): `POST /sessions/{id}/cancel` (route `sessions.cancel`, scope `tasks:write`, owner only) aborts the run in flight; the run ends with `done` `{stopReason: "cancelled"}`. No run is `{changed: false}`
- **FR:run.record** (P2): Every run writes one line to `tasks/logs/sessions.md` when it stops: `- <iso> <sessionId8> <stopReason> $<usd> <tokens> tokens: <first 120 chars of the prompt>`. Secrets are redacted. This is the only task-repo write a run makes

### FR:perm: Permission prompts as asks

- **FR:perm.ask** (P1): A `permission` update becomes an ask `perm-<sessionId8>-<requestId>` (kind `decide`, from `session:<title>`, project from `cwd`) with `ask` = the request title (e.g. `Allow Bash: git push origin main`), `why` = the first 200 characters of the input (redacted), `options` = the request's option names in order (`Allow once`, `Allow for this session`, `Deny`), `recommend` = `Allow once` unless the driver flags the request as risky (`defaultToNo`), then `Deny`; `default` = `Denied; the agent continues without it`, `reversible: yes`, `by` = now + 10 minutes, `priority: high`, `effort: 1m`, `detail` = the full input as JSON (cut at 4000 characters). The run's `permission` update stays in the stream so the drawer shows `Waiting for you` with a link to Asks
- **FR:perm.answer** (P1): The broker watches that ask (storage reads every second, or the watcher when present) and resolves the driver's request: option `Allow once` → `{behavior: "allow"}`; `Allow for this session` → allow, and the same tool name is allowed without asking for the rest of that run; `Deny` or answer `no` → `{behavior: "deny", message: "Denied by the owner"}`; a `reply` or `ask` answer → deny with the owner's text as the message, so the agent reads his words. The broker then handles the ask (`handled`, note = the choice). A session with an open permission ask is `needs-you`
- **FR:perm.timeout** (P1): When `by` passes unanswered, the broker denies (`message: "No answer in 10 minutes"`), handles the ask as `defaulted`, and the run continues. Cancelling the run resolves any open permission ask as `resolved`

### FR:web: Sessions view

- **FR:web.view** (P1): The `Sessions` view (`#/sessions`, rail after Asks, `g s`) opens with a cost strip (`Today $4.10 · 1.2M tokens · 6 sessions`, then `7 days $31`) and one row per session: a state dot and label (`Needs you`, `Running`, `Active`, `Idle`, muted for `Stale`), the title, `project · branch`, last active (`12 min ago`), and cost (`$0.56`). 20 rows, the rest behind `Show n more`. The list reloads every 15 s while visible and after every run ends
- **FR:web.drawer** (P1): `Enter` or a click on a row opens a drawer (right side from 1024 px, full-height sheet on phones) with the session title and facts, the last turns from `GET /sessions/{id}/messages` (newest at the bottom), and a message box. While a run streams, the drawer appends assistant text as it arrives, shows each tool call as one line with a status mark (`⚙ Bash: git status ✓`), shows `Waiting for you` with an `Open in Asks` link on a permission update, and ends with `Done · $0.12 · 3 turns` (or the error). `Esc` closes; the list stays usable behind it; focus returns to the row
- **FR:web.message** (P1): In the drawer `Enter` sends the text (`Shift+Enter` newline); the box clears and the stream opens. `Stop` (`Esc` while running asks first) cancels. A `409` shows inline `This session is active in another window; message it there or through its inbox`. A `needs-you` row's action is `Answer in Asks` (jumps to the ask)
- **FR:web.cost** (P1): `Costs` (`c` in the view) expands under the strip: one line per day for the last 7 days (`Mon 27 · $3.20 · 410k · 4 sessions`, bar scaled to the week's max) and the per-project totals (`allyte $14.20 · stack $9.80`). Model mix is one muted line
- **FR:web.new** (P2): `n` opens the message box with a project picker (projects from `GET /projects` that carry `repositoryUrl` mapped to known cwds, else a text field) to start a new session
- **FR:web.states** (P1): Empty (`No sessions on this machine yet.`), error with Retry, loading skeletons, and a `Not available on this host` note when `/.auth/me` has no `agents: true` (the Azure host). `/.auth/me` on `stack web` carries `agents: true` when a driver is wired
- **FR:web.keys** (P1): `j`/`k` move, `Enter` opens, `Esc` closes, `s` stops a running session, `c` toggles Costs, `n` new session, `m` shows more; every action is in the palette and `?` help. Keys are ignored while typing
- **FR:web.a11y** (P1): The drawer is a labelled `dialog` with a focus trap and the stream region is `aria-live="polite"` for tool status lines only (not every text chunk); rows are buttons with full labels; 44 px targets on touch; contrast at least 4.5:1; motion 120-200 ms and off with `prefers-reduced-motion`; light and dark designed

## Dependencies

- ask-queue (`putAsk`, `readAsk`, `handleAsk`, watcher and `/events` plumbing), api (routes, validation), auth-security (scope table, owner check), web-app (shell, keys, palette, toasts)
