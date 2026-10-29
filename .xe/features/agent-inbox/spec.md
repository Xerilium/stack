---
id: agent-inbox
title: Agent Inbox and Activity
author: flanakin
description: "Durable per-project inbox the owner writes replies and decisions to and agents read and mark handled; agent activity built from artifacts (task rows, result logs, pull requests, CI)."
dependencies: [api, ai-triage-assist, storage-git, auth-security]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Inbox and Activity

## Purpose

Close the loop between the owner and the agents that work his tasks. A reply typed in Today lands in a file the owning agent reads on its next run, and Today shows what each agent is doing from what it produced (rows, logs, pull requests, CI), never from chat.

## Scope

- In: inbox file format, storage path, core append/list/handle, API routes `inbox.send`, `inbox.list`, `inbox.handle`, `agents.list`; a pull request status provider (GitHub REST) the host wires when a token is set.
- Out: MCP tools (agents read the file or the route), pushing replies to a running chat session, email/Slack/Teams inputs, model calls.

## Inbox file format (v1)

One file per project: `tasks/inbox/<slug>.md`, where `<slug>` is the project file name made storage safe the same way as result logs (`tasks/logs/<slug>.md`). Entries are appended, newest last. Example:

```markdown
# Allyte inbox

<!-- stack-inbox v1. Stack appends entries. An agent handles an entry, then sets `state: handled` (or calls POST /inbox/handled). -->

## in-20261028T140311Z-3f9a

- at: 2026-10-28T14:03:11.000Z
- state: open
- kind: reply
- to: agent
- ref: tasks/allyte.md:67
- task: feat(transcript-sync): Unattended Teams transcript sync
- text: Ship it after the OIDC test passes.
```

Handled entries change `state: open` to `state: handled` and gain `- handled: <iso> by <actor>` and an optional `- note: <one line>`. Agents must treat `text` as the owner's instruction for the task at `ref` (match on `task` when lines moved).

## Scenarios

### FR:inbox: Inbox

- **FR:inbox.path** (P1): Storage accepts `tasks/inbox/<name>.md` (same name rules as result logs). Inbox files are never listed as projects
- **FR:inbox.format** (P1): `formatEntry` and `parseInbox` round-trip the v1 format above: heading `## <id>`, then one `- key: value` line each for `at`, `state` (`open` or `handled`), `kind` (`reply` or `decision`), `to` (`agent`, `human`, or `none`: the row's own 🤖/🪄 or 🙋 mark), `ref` (`path:line`, 1-based), `task` (row title, one line), `text`, and when handled `handled` and optional `note`. Unknown lines are kept. A new file starts with `# <project title> inbox` and the format comment
- **FR:inbox.id** (P1): Ids are `in-<UTC yyyymmddThhmmssZ>-<4 hex>`, unique within the file
- **FR:inbox.send** (P1): `sendToInbox(ref, text, kind, expect?)` reads the row at `ref` (404 when missing, 409 when `expect` differs from the row text) and appends one entry. Text is one line, 1-1000 characters. Every field is redacted and escaped like result log fields (`FR:ai-triage-assist/result.noleak`), so the file never renders links or images from row text. The task row file is not changed
- **FR:inbox.list** (P1): `listInbox({project?, state?})` returns entries from every inbox file (oldest first) with `id`, `at`, `project`, `ref`, `task`, `kind`, `to`, `text`, `state`, and `handled`/`note` when set. `state` defaults to `open`; `all` returns both
- **FR:inbox.handle** (P1): `handleEntry(id, actor, note?)` sets `state: handled` and adds the handled line (and note) to that entry only; every other byte is unchanged. Unknown id is 404; an already handled entry is `changed: false`
- **FR:inbox.cap** (P2): An inbox file over 256 KiB drops handled entries, oldest first, before an append; if it is still over, the append is `409 conflict` ("Inbox is full; handle some entries first"). Dropped entries stay in storage history

### FR:api: Routes

- **FR:api.send** (P1): `POST /inbox` `{ref, text, kind?, expect?}` (route `inbox.send`, scope `tasks:write`) returns `201 {id, path}`. Only the owner session may call it: a token caller gets `403 forbidden`, so an agent can never write words in the owner's voice
- **FR:api.list** (P1): `GET /inbox?project=&state=` (route `inbox.list`, scope `tasks:read`) returns `{items}`
- **FR:api.handle** (P1): `POST /inbox/handled` `{id, note?}` (route `inbox.handle`, scope `tasks:write`) returns `{changed}`; `note` is one line up to 500 characters. Agents call it after acting on an entry
- **FR:api.agents** (P1): `GET /agents` (route `agents.list`, scope `tasks:read`) returns `{items}` built by `FR:activity.*`. All four routes are in `docs/api/openapi.yaml`

### FR:activity: Agent activity from artifacts

- **FR:activity.rows** (P1): Agent work is every open 🤖 or 🪄 row whose ancestors are open, that is not parked, suspended, or recurring-skipped, and that is in an Active section or marked 🚧. Each item has `ref`, `project`, `title`, and `text`
- **FR:activity.prs** (P1): GitHub pull request links (`https://github.com/<owner>/<repo>/pull/<n>`) on the row or in its notes become `prs: [{url, repo, number}]`, deduplicated, at most 5 per row
- **FR:activity.status** (P1): When a status provider is configured, each pull request gains `state` (`open`, `draft`, `merged`, `closed`), `checks` (`passing`, `failing`, `pending`, `none`), `title`, and `updatedAt`. A provider failure leaves the pull request without status; the route still answers
- **FR:activity.log** (P1): `last` is the newest result log entry (`tasks/logs/<slug>*.md`) whose `ref` is the row: `{at, action, outcome?, summary?}`
- **FR:activity.waiting** (P1): `waitingOn` is the first open 🙋 row that is a child of the agent row, or a sibling under the same parent (top-level rows only look at children)
- **FR:activity.replies** (P1): `replies` counts open inbox entries for the row: same project and same title words, ignoring marks, dates, and links (lines move, so `ref` alone is not used)
- **FR:activity.state** (P1): `state` is the first that holds: `merged` (every linked PR merged), `failing` (an open PR with failing checks), `waiting` (`waitingOn` set, or the last log outcome is `blocked` or `needs-human`), `review` (an open, non-draft PR with passing or no checks), `ci` (an open PR with pending checks), `working` (🚧, a draft PR, or a log entry in the last 24 hours), else `queued`. `since` is the newest of the PR `updatedAt` and the log `at`
- **FR:activity.order** (P2): Items sort by state (`failing`, `waiting`, `review`, `merged`, `ci`, `working`, `queued`), then newest `since`, then file order

### FR:github: Pull request status provider

- **FR:github.fetch** (P1): `createGitHubPrs({token, fetch?, ttlMs?})` reads `GET /repos/{o}/{r}/pulls/{n}` and `GET /repos/{o}/{r}/commits/{sha}/check-runs`, with at most 6 requests in flight and results cached for `ttlMs` (default 60 s). Checks: any failure, cancel, or timeout conclusion is `failing`; any run not completed is `pending`; no runs is `none`; else `passing`
- **FR:github.wire** (P2): The Azure host and `stack web` pass the provider when `GITHUB_TOKEN` is set; the token is sent only to `https://api.github.com` and never logged or returned

## Dependencies

- api (handler, validation, errors), ai-triage-assist (log format, redaction), storage-git (paths), auth-security (scope table)
