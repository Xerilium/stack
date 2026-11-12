---
id: agent-inbox
title: Agent Inbox and Activity
author: flanakin
description: "Per-project inbox for the owner's replies and decisions to agents; agent activity built from task artifacts."
dependencies:
  - api
  - ai-triage-assist
  - storage-git
  - auth-security
  - github-pr-status
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Inbox and Activity

## Purpose

Close the loop between the owner and the agents that work the owner's tasks: replies reach the owning agent as a file it reads, and agent activity is shown from what agents produced, never from chat.

## Scenarios

### FR:inbox: Inbox

The owner needs to send a reply or decision on a task row so that the owning agent reads it on its next run.

- **FR:inbox.@file** (P1): Interface: `tasks/inbox/<slug>.md`, one file per project; `<slug>` is the project file name made storage safe the same way as result logs (`tasks/logs/<slug>.md`)
- **FR:inbox.path** (P1): Storage accepts `tasks/inbox/<name>.md` (same name rules as result logs). Inbox files are never listed as projects
- **FR:inbox.format** (P1): `formatEntry` and `parseInbox` MUST round-trip the entry format in the Data Model (`FR:$inbox-entry`): heading `## <id>`, then one `- key: value` line per field
- **FR:inbox.id** (P1): Ids are `in-<UTC yyyymmddThhmmssZ>-<4 hex>`, unique within the file
- **FR:inbox.send** (P1): `sendToInbox(ref, text, kind, expect?)` reads the row at `ref` (404 when missing, 409 when `expect` differs from the row text) and appends one entry. Text is one line, 1-1000 characters. Every field is redacted and escaped like result log fields (`FR:ai-triage-assist/result.noleak`), so the file never renders links or images from row text. The task row file is not changed
- **FR:inbox.list** (P1): `listInbox({project?, state?})` returns entries from every inbox file (oldest first) with `id`, `at`, `project`, `ref`, `task`, `kind`, `to`, `text`, `state`, and `handled`/`note` when set. `state` defaults to `open`; `all` returns both. Withdrawn entries (`FR:inbox.withdraw`) are left out unless `withdrawn: true`
- **FR:inbox.rows** (P1): `currentRows(entries)` finds where each entry's row is now: the row in the same file whose title words match the stored `task` (marks, dates, and links ignored; both run through the same redaction and escaping; a title cut at 300 characters matches by prefix). When the entry has a `parent`, rows whose parent title matches it the same way win, so rows with the same title under different parents stay apart; if none does (parent renamed), title alone decides. The row nearest the stored line breaks ties. Entries whose row is gone get none
- **FR:inbox.handle** (P1): `handleEntry(id, actor, note?)` sets `state: handled` and adds the handled line (and note) to that entry only; every other byte is unchanged. Unknown id is 404; an already handled entry is `changed: false`
- **FR:inbox.withdraw** (P1): `handleEntry(id, actor, note?, {withdrawn: true})` also adds `- withdrawn: true`. A withdrawn entry counts as never sent: it stays in the file for audit (until `FR:inbox.cap` drops it like any handled entry; storage history keeps it), lists skip it by default, and the task thread flags it (`withdrawn: true`) so pages hide it
- **FR:inbox.kinds** (P1): `kind` is `reply`, `decision`, or `instruction`. `instruction` is work the owner asks of the agent on a row (the Now composer, `FR:now-screen/now.compose`). The entry format is unchanged
- **FR:inbox.cap** (P2): An inbox file over 256 KiB drops handled entries, oldest first, before an append; if it is still over, the append is `409 conflict` ("Inbox is full; handle some entries first"). Dropped entries stay in storage history

### FR:api: Routes

The owner and agents need routes to send, list, and handle inbox entries and list agents so that every client uses the same operations.

- **FR:api.send** (P1): `POST /inbox` `{ref, text, kind?, expect?}` (route `inbox.send`, scope `tasks:write`) returns `201 {id, path}`. Only the owner session may call it: a token caller gets `403 forbidden`, so an agent can never write words in the owner's voice
- **FR:api.list** (P1): `GET /inbox?project=&state=` (route `inbox.list`, scope `tasks:read`) returns `{items}`; each item has `row`, the current ref of its row (`FR:inbox.rows`), when the row still exists
- **FR:api.handle** (P1): `POST /inbox/handled` `{id, note?, withdrawn?}` (route `inbox.handle`, scope `tasks:write`) returns `{changed}`; `note` is one line up to 500 characters. Agents call it after acting on an entry. `withdrawn: true` is owner only (`403 forbidden` for a token)
- **FR:api.agents** (P1): `GET /agents` (route `agents.list`, scope `tasks:read`) returns `{items}` built by `FR:activity.*`. All four routes are in `docs/api/openapi.yaml`

### FR:cli: Agent pickup from the command line

An agent or CoS needs to read and close open entries with no model tokens and no server so that a scheduled run can act on instructions.

- **FR:cli.list** (P1): `stack inbox list [--project p] [--state open|handled|all] [--all] [--json]` prints `listInbox` entries (state defaults to `open`; `--all` lists every entry, withdrawn ones too; `--state` still narrows it), one line each: `<id> <kind> <project> <row> <text>`, where `<row>` is the current row (`FR:inbox.rows`), else the stored `ref`. `--json` prints `{items}` with the same fields as `GET /inbox`; `ref` and `row` keep the CLI form `tasks/<file>.md:<line>`
- **FR:cli.handle** (P1): `stack inbox handle <id> [--note t] [--from <agent>]` calls `handleEntry` (actor `--from`, else `cli`) and prints `handled` or `unchanged`. An unknown id exits 2
- **FR:cli.docs** (P2): `docs/agent-instructions.md` is the prompt snippet for a scheduled agent: list open entries for its project, act, reply (`stack inbox reply`), then handle

### FR:activity: Agent activity from artifacts

The owner needs to see what each agent is doing so that the owner can tell what needs attention without asking.

- **FR:activity.rows** (P1): Agent work is every open 🤖 or 🪄 row whose ancestors are open, that is not parked, suspended, or recurring-skipped, and that is in an Active section or marked 🚧. Each item has `ref`, `project`, `title`, and `text`
- **FR:activity.prs** (P1): GitHub pull request links (`https://github.com/<owner>/<repo>/pull/<n>`) on the row or in its notes become `prs: [{url, repo, number}]`, deduplicated, at most 5 per row
- **FR:activity.status** (P1): When a status provider is configured (@req FR:github-pr-status/status.output), each pull request gains `state` (`open`, `draft`, `merged`, `closed`), `checks` (`passing`, `failing`, `pending`, `none`), `title`, and `updatedAt`. A provider failure leaves the pull request without status; the route still answers
- **FR:activity.log** (P1): `last` is the newest result log entry (`tasks/logs/<slug>*.md`) whose `ref` is the row: `{at, action, outcome?, summary?}`
- **FR:activity.waiting** (P1): `waitingOn` is the first open 🙋 row that is a child of the agent row, or a sibling under the same parent (top-level rows only look at children)
- **FR:activity.replies** (P1): `replies` counts open inbox entries whose current row (`FR:inbox.rows`) is this row
- **FR:activity.state** (P1): `state` is the first that holds: `merged` (every linked PR merged), `failing` (an open PR with failing checks), `waiting` (`waitingOn` set, or the last log outcome is `blocked` or `needs-human`), `review` (an open, non-draft PR with passing or no checks), `ci` (an open PR with pending checks), `working` (🚧, a draft PR, or a log entry in the last 24 hours), else `queued`. `since` is the newest of the PR `updatedAt` and the log `at`
- **FR:activity.order** (P2): Items sort by state (`failing`, `waiting`, `review`, `merged`, `ci`, `working`, `queued`), then newest `since`, then file order

## Data Model

- **FR:$inbox-entry** (P1): **`InboxEntry`** — One owner reply or decision, stored as `## <id>` followed by `- key: value` lines in the inbox file. Stack appends entries; an agent marks one handled with `inbox.handle`.
  - `id` (string) — `in-<UTC yyyymmddThhmmssZ>-<4 hex>`
  - `at` (string) — ISO timestamp of the write
  - `state` (string) — Allowed: open, handled
  - `kind` (string) — Allowed: reply, decision, instruction
  - `to` (string) — Allowed: agent, human, none. The row's own 🤖/🪄 or 🙋 mark
  - `ref` (string) — `path:line` (1-based) of the row when written. A hint only: lines move, so readers find the row again by `task` and `parent` (`FR:inbox.rows`); no commit hash is stored
  - `task` (string) — The row's title, one line. Matches the row after edits; it is not a copy of the task
  - `parent` (string?) — The parent row's title, one line, only when the row has a parent. Tells apart rows that share a title
  - `text` (string) — The owner's instruction for the row at `ref`
  - `handled` (string?) — `<iso> by <actor>`, when handled
  - `note` (string?) — One line from the agent, when handled
  - `withdrawn` (boolean?) — `true` when the owner took the entry back (Undo); absent otherwise
  - Relationships: A new file starts with `# <project title> inbox` and a `stack-inbox v1` comment. Unknown lines are kept.

```markdown
## in-20261028T140311Z-3f9a

- at: 2026-10-28T14:03:11.000Z
- state: open
- kind: reply
- to: agent
- ref: tasks/allyte.md:67
- task: feat(transcript-sync): Unattended Teams transcript sync
- parent: Teams integration
- text: Ship it after the OIDC test passes.
```

## Architecture Constraints

- MCP tools, pushing replies to a running chat session, email/Slack/Teams inputs, and model calls are outside this feature
- Inbox files are never listed as projects

## External Dependencies

None
