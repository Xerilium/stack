---
id: agent-delivery
title: Agent Delivery
author: flanakin
description: "Deliver the owner's messages to agents: run the agent headlessly, post its reply in the thread, and say when delivery is down"
dependencies: [agent-inbox, agent-thread, agent-team, acp-driver, ask-queue, session-inventory, email-runner, config, cli, now-screen]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Delivery

## Purpose

A message to an agent (Now's composer, `FR:now-screen/now.compose`) lands in `tasks/inbox/<project>.md` (`FR:agent-inbox/inbox.send`). Without a reader it sits there and the owner hears nothing. This feature is the reader: the Stack host runs the task's agent headlessly through the owner's `claude` login, posts the agent's reply in the task thread, and marks the entry handled. When delivery cannot run (signed out, off, failed), the owner sees that on the message and in Notifications, never silence.

## Scope

- In: `stack inbox run`, the host delivery loop, the `claude -p` call, per-message state, the login check and sign-in, the live-session link, the delivery log.
- Out: controlling other sessions (link only), streaming partial replies, ACP agents other than Claude (they keep `stack agent run`, `FR:acp-driver/cli.run`), merging, labels, mail.

## Scenarios

### FR:pick: Pick up messages

The owner needs every message to an agent read by that agent so that a message never sits unanswered.

- **FR:pick.entries** (P1): `pendingDeliveries(ctx, {project?})` returns open inbox entries (`FR:agent-inbox/inbox.list`) with `to: agent`, `kind` `instruction` or `reply`, not written by an agent, not withdrawn, oldest first. Each entry is checked again right before its run and before its reply is posted: one withdrawn or handled meanwhile is not run, and a reply to one withdrawn during its own run is dropped (`failed`, `Withdrawn`). `decision` entries and entries for 🙋 rows are never delivered
- **FR:pick.agent** (P1): The agent is the one Now's composer names (`FR:now-screen/now.compose`): the most specific agent on the task, else the roll-up (`FR:agent-team/agent.resolve`), found from the entry's current row (`FR:agent-inbox/inbox.rows`). An entry whose row is gone, or that no agent covers, is `failed` with reason `No agent for this task` and is not retried
- **FR:pick.serial** (P1): One message at a time per agent: an agent with a run in flight (in this process, or a `working` state younger than the timeout plus 60 s in the state file) is skipped this pass. The check and the `working` write are one step under `~/.stack/delivery.lock` (exclusive create, holding the pid; a dead or 30 s old lock is taken over), and every state write takes the same lock, so the host loop and `stack inbox run` never run one agent twice or lose a write. Messages to one agent are delivered oldest first
- **FR:pick.once** (P1): An entry is attempted once. `failed` entries stay failed until the owner sends again. `not-delivered` entries (signed out) are retried on the next pass after the login check passes

### FR:run: Run the agent

The owner needs the agent to answer with its own persona, in the right repo, with no more power than its definition gives so that delivery is useful and safe.

- **FR:run.cli** (P1): Each delivery is one `claude -p` call through an injected `Runner` (`FR:email-runner/model.cli`); tests never start a process. Arguments: `-p --safe-mode --setting-sources '' --strict-mcp-config --no-session-persistence --output-format json --permission-mode default --max-budget-usd <cap> --system-prompt-file <0600 file>`, `--model` when the agent file names one, `--tools <list>`: the agent file's tools (default Read, Grep, Glob, Edit, Write, WebFetch, WebSearch) without any shell tool (`FR:safe.noshell`), no setting source loads, so the owner's own allow rules never pre-allow a tool; `--allowedTools Read(./**)` when the agent may read (`Read`, `Grep`, `Glob`): reads inside the working folder only; Read rules also cover Grep and Glob, so a read elsewhere (`~/.ssh`, token caches) is denied and becomes an ask, and `--disallowedTools` for the never-list (`FR:safe.never`). The environment is `childEnv` (`FR:email-runner/model.cli`): no GitHub, Graph, Slack or Azure secrets
- **FR:run.prompt** (P1): The system prompt is the repo-rules prefix (`FR:safe.prefix`), then the agent's persona and task context (`personaOf`, `FR:agent-team/talk.start`). The user text holds the task, the thread so far (owner messages up to this one and every agent reply already posted, oldest first, at most the newest 20) and the owner's message, marked as the message to answer. The agent answers in plain text; it does not post the reply itself
- **FR:run.cwd** (P1): The working folder is the task project's repo: the first folder name from the project's metadata (`FR:agent-sessions/sessions.owner.repos`) that exists as a git checkout under the repos root (config `inbox.reposRoot`, default the parent of the task repo). Else the task repo itself
- **FR:run.reply** (P1): On success the reply text is redacted (`FR:agent-inbox/inbox.send`), folded to one line, cut to 1000 characters, posted with `replyFromAgent` as the agent (`FR:agent-thread/reply.entry`) on the entry's row as it is when the run ends (resolved again, with its text as `expect`; a row gone is `failed` `Task gone`, a row changed in between is `failed` `Task changed during the run`). The state is set `delivered` before the entry is handled with note `Delivered`; a `delivered` entry still open is only handled on the next pass, never run again. The entry is handled by the agent's slug with note `Delivered`. Empty text is `failed` (`Agent sent no reply`)
- **FR:run.limits** (P1): A timeout (config `inbox.deliveryTimeoutSeconds`, default 300, 30-1800) kills the process and marks the entry `failed` (`Timed out`). The cost cap (config `inbox.deliveryMaxUsd`, default 0.5, 0.01-10) is passed as `--max-budget-usd`; a run that stops on the budget is `failed` (`Cost cap reached`)
- **FR:run.asks** (P1): Every tool call the run was denied (`permission_denials` in the JSON result) becomes one ask `perm-dl-<entry id tail>-<n>` (`kind: approve`, `recommend: Deny`, `ref` the row, `from` the agent) naming the tool and its redacted input, at most 5 per run. Stack never re-runs a denied call on its own: permission requests are asks, never auto-allowed (`FR:acp-driver/perm.broker`). Each ask keeps the exact rule an approval adds: `<Tool>(<file_path>)`, `<Tool>(domain:<host>)`, else `<Tool>`
- **FR:run.approved** (P1): When the owner answers a denial ask `go`, the next pass re-runs the agent once on that entry with the approved rules added to `--allowedTools` and `The owner approved: ...` in the user text, posts the new reply, and handles the asks (`Re-run with approval`). Any other answer handles the ask (`Denied`) with no run. Open asks wait
- **FR:run.daily** (P1): A daily spend cap (config `inbox.deliveryDailyCapUsd`, default 5, 0.01-1000) on the UTC day's total of `total_cost_usd`. At the cap, open entries are `not-delivered` (`Daily cap reached`) and retried after the day turns; one ask `delivery-cap` (`kind: go-do`, priority `high`) says so and is handled once spend is under the cap

### FR:state: Delivery state

The owner needs to see what happened to each message so that a message is never silently stuck.

- **FR:state.file** (P1): Delivery state lives in `~/.stack/delivery.json` (`STACK_HOME` honoured): per entry id `{state, at, agent, reason?}` with state `working`, `delivered`, `failed`, or `not-delivered`, plus `login: {state: ok|expired|unknown, at}`. Entries older than 30 days are dropped on write. Writes are atomic (temp file and rename)
- **FR:state.api** (P1): `GET /inbox/delivery?ref=` (route `inbox.delivery`, scope `tasks:read`, owner only) returns `{mode, login, items: {<entry id>: {state, agent, reason?}}, live?}` for the row's entries; `mode` is `claude` or `off`. Absent on hosts without delivery (404)
- **FR:state.bubble** (P1): Now shows, under the owner's newest message: `working…` with the agent's avatar while a run is in flight; `Not delivered` with the reason and, when signed out, a `Sign in` button; `Delivery is off` when mode is `off` and the message is still open. Nothing extra once delivered (the reply bubble is the result)

### FR:login: Login health

The owner needs one clear signal when the `claude` login has expired so that they fix it once instead of wondering why agents are silent.

- **FR:login.check** (P1): Before each pass that has messages to deliver, the host runs `claude auth status --json` (injected runner, 15 s timeout). `loggedIn: true` is `ok`; `loggedIn: false` or exit code 1 is `expired`; anything else is `unknown` and the pass still runs. A failed run also sets `expired` when its stderr says it is not signed in (`/login`, `OAuth`, `authentication`, `401`), or its result holds one of the CLI's own sign-in errors (`Please run /login`, `Invalid API key`, `OAuth token has expired`, `authentication_error`, `API Error: 401`); the model's own words about auth never do
- **FR:login.notice** (P1): While the login is `expired`, open entries get `not-delivered` (`Claude login expired`) and one ask `delivery-login` exists: `Claude login expired: Sign in`, `kind: go-do`, `why` naming the single step (`claude auth login`), priority `high`. It is written once (no duplicates per pass). When the login is `ok` again the ask is handled (`resolved`, `Signed in`)
- **FR:login.signin** (P1): `POST /inbox/delivery/login` (route `inbox.deliveryLogin`, owner only) starts `claude auth login` detached (injected spawner) so the browser sign-in opens, and answers `{started: true}`; when it cannot start (including the child's `error` event, e.g. no `claude` on the PATH) it answers `{started: false, step: "claude auth login"}`. The next pass re-checks the login

### FR:live: Live sessions

The owner needs a quicker path when the agent already runs in a live session so that the owner can talk there instead of waiting for a headless run.

- **FR:live.find** (P2): `liveSessionFor(inventory, agent, ref)` returns the newest inventory session that is not done or archived and whose title names the task (`· <ref>`), is the agent's name, or starts with `<name> · ` (archived sessions never reach the inventory); `{id, title, link}` with the session link (`FR:session-inventory/needs.item`)
- **FR:live.offer** (P2): `GET /inbox/delivery` includes it as `live`. Now shows `Send to live session` as a link to it. Stack never sends to, or controls, another session

### FR:safe: Safety

The owner needs delivery runs to stay within the repo rules so that an unattended agent never takes an action only the owner may take.

- **FR:safe.never** (P1): Delivery runs never merge, never apply labels, and never send mail: `--disallowedTools` lists `Bash(gh pr merge:*)`, `Bash(gh pr edit:*)`, `Bash(gh issue edit:*)`, `Bash(gh label:*)`, `Bash(gh api:*)`, `Bash(git push:*)`, and `Bash(stack email:*)`. No MCP server loads (`--strict-mcp-config` with none given), so no mail or chat tool exists in the run
- **FR:safe.noshell** (P1): No shell tool (`Bash`, `BashOutput`, `KillShell`, `PowerShell`) is ever in a delivery run's `--tools`, whatever the agent file lists; an agent that needs a shell stays out of this runner
- **FR:safe.prefix** (P1): The system prompt starts with the repo-rules prefix: read and follow the repo's `CLAUDE.md` and `.xe/process` (safe mode does not load them), never merge, never add or remove labels, never send mail or messages, end the answer with `Needs you: ...` for anything that needs the owner, answer in plain text in at most 1000 characters
- **FR:safe.log** (P1): Each run appends one JSON line to `~/.stack/delivery.log`: `{at, entry, agent, project, state, ms, usd, reason?}`. Never the message, the reply, the prompt, or tool input
- **FR:safe.optin** (P1): Config `inbox.delivery` is `claude` or `off`; default `off`. The host starts the loop only when it is `claude`

### FR:cli: Command

The owner and the CoS need to run delivery by hand so that a message can be pushed through without the app.

- **FR:cli.run** (P1): `stack inbox run [--project p] [--once|--watch] [--json]` runs one pass (`--once`, the default) or passes every 30 s until `SIGINT` (`--watch`). It runs even when `inbox.delivery` is `off` (the command is the opt-in). It prints one line per entry: `<id> <state> <agent> <reason?>`, or `{items}` with `--json` (with `--watch --json`, no text lines: one JSON object when it stops). Exit 0, or 1 when the login is expired

### FR:host: Host loop

The owner needs delivery to happen while the app is open so that a reply shows up without a command.

- **FR:host.loop** (P1): `stack web` starts `startDeliveryLoop` when `inbox.delivery` is `claude` and the host is not a demo copy (demo mode has no delivery at all: no loop, no state, the API is 404): a pass at start, then every 20 s and on inbox file changes; passes never overlap; `close()` stops it and waits for the pass in flight (bounded by the timeout)

## Non-functional requirements

- **NFR:delivery.seam** (P1): All process starts (`claude -p`, `claude auth status`, `claude auth login`) go through injected functions; tests start no process and make no model call
- **NFR:delivery.lazy** (P1): Importing `src/agents` starts no loop and no process

## Architecture Constraints

- The reply is posted by Stack, not by the agent, so the agent needs no write tool to answer
- Delivery state lives outside the task repo (`~/.stack`): it is machine state, not task history

## External Dependencies

- `claude` CLI signed in (`claude auth login`)
