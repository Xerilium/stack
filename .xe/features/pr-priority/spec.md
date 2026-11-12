---
id: pr-priority
title: PR Priority
author: flanakin
description: "The owner orders the PRs the Sweep Manager works. Agents recommend changes; the owner accepts, edits, or rejects them with a reason. One read gives the SM the queue, PR facts, its per-PR records, acks and escalations. No LLM call."
dependencies: [status-ingest, session-inventory, api, auth-security, cli, ask-queue, agent-inbox]
---

<!-- markdownlint-disable single-title -->

# Feature: PR Priority

## Purpose

The owner has many open PRs across repos. The Sweep Manager (SM) must work them in the owner's order. CoS agents see what is urgent, so they can recommend a higher rank. The owner accepts, edits, or rejects each recommendation. A rejection has a reason, and Stack remembers it, so the agent does not ask again. One read (`stack pr-pri list --json`) gives the SM and the PR page the queue, the PR facts, merge-order edges, the SM's per-PR records, the owner's thread acks, and the escalation set.

## Scope

- In: the queue in `~/.stack/pr-priority.json`; recommendations, edges, per-PR records, acks, escalations and cached PR facts in `~/.stack/pr-priority-state.json`; the exclude list in `~/.stack/pr-priority.config.json`; CLI `stack pr-pri`; API routes under `/pr-priority`; open recommendations in Needs you; a `priority` field on each PR in `GET /agents`; the SM prompt text in `docs/pr-priority.md`.
- Out: any UI (the PR page builds it on this data contract), any write to git or the content repo, any LLM call, any merge, Autopilot label, or draft change on GitHub. The only GitHub call is a read through `gh` on `--refresh`.

## Scenarios

### FR:queue: Priority queue

The owner needs one ordered list of PRs so that the SM works the most important PR first.

- **FR:queue.model** (P1): `<home>/pr-priority.json` is `{version: 1, rev, updatedAt?, items}`. `<home>` is `STACK_HOME` or `~/.stack`. `items` is ordered, rank 1 first, at most 100. Each item is `{rank, repo, number, url, pinned, note?, by, at}`: `rank` is 1 to n with no gaps; `repo` is `<owner>/<name>` (GitHub names); `number` is a whole number from 1 to 9999999; `url` is `https://github.com/<repo>/pull/<number>`; `note` is one line of 1-300 characters; `pinned` is true or false (pinned items come first); `by` is `owner` or the agent whose recommendation added the item; `at` is the ISO time of the last change to the item. One PR is in the queue at most once (`repo` compares without case)
- **FR:queue.ref** (P1): A PR ref is `<owner>/<name>#<number>` or a GitHub PR url. Any other text is invalid
- **FR:queue.add** (P1): Add puts a PR at `rank`, or by default at the top (the first rank after the pinned items), and moves the items at and below it down by one. A `rank` above the length puts it last; a rank inside the pinned items puts it first after them. Adding a PR that is already queued changes nothing, or moves it when `rank` is given
- **FR:queue.move** (P1): Move puts a queued PR at a target and closes the gap it left: `top` (the first rank after the pinned items, or rank 1 for a pinned PR), `up` (one rank up), `down` (one rank down), or a `rank` (clamped). An unpinned PR never moves above a pinned one, and a pinned PR never moves below an unpinned one. Move can set `note`. A move to the current place changes nothing. A PR that is not queued fails `not found`
- **FR:queue.pin** (P1): Pin marks a queued PR pinned and moves it to the last pinned place; unpin clears the mark and moves it to the top of the unpinned items. Pinning a pinned PR, or unpinning an unpinned PR, changes nothing. A PR that is not queued fails `not found`
- **FR:queue.remove** (P1): Remove takes a queued PR out and closes the gap. It also drops the PR's edges, facts, record and acks. Removing a PR that is not queued changes nothing
- **FR:queue.idem** (P1): Every queue and decision action is idempotent: the same action twice gives the same queue, and a call that changes nothing writes nothing and returns `changed` false. Every action returns the new queue order
- **FR:queue.undo** (P1): Each queue write keeps the prior items in `history` in the state file (the newest 20). Undo restores the newest kept items as a new `rev` and drops them from `history`. Undo with no history changes nothing
- **FR:queue.exclude** (P1): `<home>/pr-priority.config.json` is `{exclude: [<ref>]}` (the owner edits it). Add, move, recommend and accept refuse an excluded PR (`invalid`; recommend returns `blocked` kind `excluded`). List leaves excluded PRs out. A missing or broken config excludes nothing
- **FR:queue.write** (P1): Each write increments `rev`, sets `updatedAt`, and goes through a temp file and a rename (mode `0600`) under the lock `<home>/pr-priority.lock` (same lock rules as `FR:status-ingest/store.lock`). A write that sends a `rev` that is not the current one fails `conflict` and changes nothing. A write with no `rev` (CLI only) uses the current one. Each item's `at` changes only when that item changes. An action that changes both the queue and the state file first writes both texts to `pr-priority.journal.json`, then each file, then removes the journal; a read uses a journal it finds, and the next write finishes it
- **FR:queue.broken** (P2): A queue or state file that is not JSON or fails its model is broken. Read shows a broken file as empty (queue `rev` 0). A write moves a broken file aside as `<file>.broken-<ms>` before it writes

### FR:rec: Recommendations

A CoS agent needs to recommend a higher rank so that the owner sees urgent PRs, and the agent needs to know the result so that it does not ask again.

- **FR:rec.model** (P1): `<home>/pr-priority-state.json` is `{version: 1, recs, deps, acks, records, escalations?, facts, history}`. Each recommendation in `recs` is `{id, repo, number, url, agent, reason, toRank?, state, at, decision?}`: `id` is `pp-` and 8 hex characters; `agent` matches `[a-z0-9][a-z0-9-]{0,39}`; `reason` is one line of 1-300 characters; `toRank` is a whole number from 1 to 100; `state` is `open`, `accepted`, `edited` or `rejected`; `decision` is `{at, reason?, rank?, note?}`. Writes use the queue lock
- **FR:rec.put** (P1): Recommend stores a new `open` recommendation and returns it. When an `open` recommendation exists for the same PR, recommend stores nothing and returns that one with `created` false
- **FR:rec.queued** (P1): When the PR is already queued at `toRank` or higher (or is queued and there is no `toRank`), recommend stores nothing and returns `blocked` with kind `queued` and the current rank
- **FR:rec.memory** (P1): When the owner rejected a recommendation for the same PR in the last 14 days and its reason is similar, recommend stores nothing and returns `blocked` with kind `rejected`, the owner's reason, the decision time, and the recommendation id. Two reasons are similar when, after Stack lowercases them, splits them into words, drops words shorter than 3 characters and common stop words, and cuts the endings `ing`, `ed`, `er`, `es` and `s`, the shared words are at least 60% of the smaller word set. Two empty word sets are similar
- **FR:rec.order** (P1): Open recommendations are ordered by project, then oldest first. The project comes from the repo: owner `allytehq` or a name that starts `finops-hubs` or `allyte` is `allyte`; `finops-toolkit` is `ftk`; `focus` is `focus`; `f4` is `f4`; owner `Xerilium` or `stack`, `catalyst`, `printer`, `prime`, `todo` is `xerilium`; any other is `other`. The order is `allyte`, `ftk`, `focus`, `f4`, `xerilium`, `other`
- **FR:rec.decide** (P1): The owner decides an `open` recommendation with `accept`, `edit` or `reject`. `accept` puts the PR at `toRank` (or last; a PR already at `toRank` or higher keeps its place) and sets the note to `<agent>: <reason>`. `edit` does the same with the owner's `rank` and `note` where given. `reject` changes no queue item. Each sets `state` (`accepted`, `edited`, `rejected`) and `decision`. A queued PR is moved, not added twice
- **FR:rec.reason** (P1): `edit` and `reject` need a `reason` (one line, 1-300 characters). Without one, the decision fails `invalid` and changes nothing
- **FR:rec.closed** (P1): The same decision again on a decided recommendation changes nothing and returns it. Another decision on a decided recommendation fails `conflict`. An unknown id fails `not found`
- **FR:rec.decisions** (P1): Decisions are every recommendation that is not `open`, newest decision first, optionally only one agent's
- **FR:rec.prune** (P2): Each write drops decided recommendations older than 90 days and keeps at most 500 recommendations, the newest first

### FR:edge: Merge order, acks, escalations

The SM needs merge-order edges, the owner's thread acks, and one escalation set so that it never merges out of order, resolves hold threads, and brings the owner only the top asks.

- **FR:edge.depends** (P1): `depends <ref> --on <ref>` stores the edge "the first PR merges after the second". `depends --file <edges.json>` (or JSON on stdin) takes `[{pr, on}]` (refs) and stores all or none. `--remove` drops the edges. An edge to itself or one that makes a cycle fails `invalid`. Each PR has at most 10 edges
- **FR:edge.ack** (P1): `ack <ref> --thread <url> --note <t>` (owner only) stores `{thread, note, at}` for the PR. `thread` is an `https` url; `note` is one line of 1-300 characters. An ack for the same thread replaces the prior one. Each PR keeps at most 20 acks, the newest
- **FR:edge.escalate** (P1): `escalate --file <set.json>` (or JSON on stdin) replaces the whole escalation set. The set is `{blockedAutopilot, enableAutopilot, liveValidation}`. `blockedAutopilot` has at most 3 items `{pr, status, exactBlocker, context, recommendedAnswer}`, `status` one of `approve`, `review`, `decide`, `unblock`; `enableAutopilot` at most 3 items `{pr, whyEasy}`; `liveValidation` at most 1 item `{pr, why}`. `pr` is a GitHub PR url; text fields are one line of 1-200 characters. Any other key is invalid, and the whole set is checked before anything is written. Stack stores it with `at`

### FR:record: Per-PR records

The SM needs to store what it knows about each PR so that the next sweep, the CoS and the PR page read it without asking.

- **FR:record.model** (P1): `record <ref> [--file rec.json]` (or JSON on stdin) stores `{state, ts, owner?, worker?, blocker?, nextAction?, headSha?, humanOnly?, bucket?}` for the PR. `state` is `processing`, `waiting-on-me`, `blocked-on-me`, `pending` or `paused`; `ts` is an ISO date-time, at most 5 minutes in the future; `owner` is `Michael`, `Roland`, `CI`, `runner` or `none`; `worker` matches `[a-z0-9][a-z0-9-]{0,39}`; `blocker` is `{text, threadUrl?}` with `text` one line of 1-200 characters and `threadUrl` an `https` url; `nextAction` is one line of 1-200 characters; `headSha` is 7-40 hex characters; `humanOnly` is true or false (for example an Autopilot label ask); `bucket` is `approve`, `review`, `decide` or `unblock`. Any other key is invalid, and nothing is written
- **FR:record.latest** (P1): The record with the newest `ts` wins. A record older than the stored one changes nothing and returns `changed` false
- **FR:record.stale** (P1): In the list view, `report.stale` is true when cached facts have a head SHA and the record has a different `headSha` (the head moved since the SM looked); otherwise false

### FR:view: List view

The SM and the PR page need one read so that they work the queue top down with no other call.

- **FR:view.item** (P1): `stack pr-pri list --json` prints `{ok: true, version, rev, updatedAt?, items, escalations}`. Each item has the queue fields, `pr` (the number), and the view fields: `title`, `author`, `isDraft`, `assignee`, `labels`, `reviewDecision`, `checks` (`green`, `red`, `pending`), `mergeable`, `lastPushAt`, `headSha`, `state`, `factsAt` (from cached facts; absent until a refresh), `baseStack` (urls of the PRs this one merges after), `waitsOn` (the `baseStack` urls whose cached `state` is not `merged`), `why` (the reason of the newest recommendation for the PR), `michaelDecision` (`{state, reason?, at}` of the newest decided recommendation), `report` (`FR:pr-priority/record.model` with `stale`), `acks`, and `status` (from `blockedAutopilot` when listed there, else the record `bucket`)
- **FR:view.refresh** (P1): `list --refresh` reads each queued PR and each PR in their `baseStack` with `gh pr view <n> -R <repo> --json title,author,isDraft,assignees,labels,reviewDecision,statusCheckRollup,mergeable,commits,headRefOid,state` (the `gh` binary is `STACK_GH` or `gh`), at most 4 at a time, and caches the facts with `factsAt`. `checks` is `red` when any check failed, else `pending` when any is not done, else `green`. `lastPushAt` is the newest commit date; `headSha` is `headRefOid`; `state` is `open`, `merged` or `closed`. A PR that `gh` cannot read keeps its prior facts. Refresh never writes to GitHub
- **FR:view.text** (P1): Text output is one line per item, under 20 words: `<rank>. <url>[ 📌][ <status>][ - <note, cut to 60 characters>]` (📌 marks a pinned PR), or `no PR priorities (run: stack pr-pri add <repo>#<n>)`

### FR:needs: Needs you

The owner needs open recommendations with his other asks so that he decides them in one place.

- **FR:needs.list** (P1): `GET /needs-you` lists each `open` recommendation (`FR:pr-priority/rec.order`) after the other items as `{id: "pp.<rec id>", kind: "decision", title, recommendation, link, project, actions, decide}`. `title` is `Raise <url> to rank <toRank or "last">: <reason>`, cut to 200 characters. `link` is the PR url; `project` is the repo project; `actions` is `["accept", "edit", "reject"]`; `decide` is the route path that takes the decision
- **FR:needs.actions** (P1): The UI maps Accept to `{decision: "accept"}`, Edit to `{decision: "edit", rank?, note?, reason}`, and Reject to `{decision: "reject", reason}` on the `decide` path. `POST /needs-you/pp.<id>/answer` with `go` accepts; any other choice fails `400` and names the `decide` path. In the Asks card, Go accepts and a reply rejects with its text as the reason; a recommendation has no Undo and no Defer
- **FR:needs.poll** (P1): `GET /api/sync` adds `live`, a token that changes on any write to the queue or state file from any process. A page that polls (no event stream) reloads Needs you and the PR page when `live` changes

### FR:sm: Sweep Manager contract

The SM needs a small, stable read so that its prompt can work the queue top down with no API token.

- **FR:sm.file** (P1): `<home>/pr-priority.json` is the lean contract (`FR:pr-priority/queue.model`). Fields of the file and of `list --json` are only added, never renamed or removed, while `version` is 1
- **FR:sm.doc** (P1): `docs/pr-priority.md` (at most 40 lines) gives the CLI, the shapes, the rules (rank order, at most 3 workers, merge only Autopilot PRs in merge order, the owner applies Autopilot, drafts stay drafts), and the exact text to paste into the SM agent prompt

### FR:cli: CLI

The owner and agents need the queue in the terminal so that they can use it with no app. No command needs a content repo.

- **FR:cli.edit** (P1): `stack pr-pri add <ref> [--rank n] [--note t] [--rev n]`, `move <ref> --top|--up|--down|--to <rank> [--note t] [--rev n]`, `pin <ref>`, `unpin <ref>`, `remove <ref> [--rev n]` and `undo` run `FR:pr-priority/queue.*` as the owner and print the new list (`--json`: the list view with `changed`). A bad ref or flag exits `2`; a stale `rev` exits `3`; a PR that is not queued exits `1`
- **FR:cli.decide** (P1): `stack pr-pri accept <id>`, `edit <id> --reason t [--rank n] [--note t]` and `reject <id> --reason t` run `FR:pr-priority/rec.decide` as the owner and print the new list. A missing reason exits `2`; another decision on a decided recommendation exits `3`; an unknown id exits `1`
- **FR:cli.recommend** (P1): `stack pr-pri recommend <ref> --agent <name> --reason <t> [--to-rank n]` runs `FR:pr-priority/rec.put`. It prints `recommended <id> <url>` or `already open: <id> <url>` and exits `0`. When blocked it exits `4` and prints the owner's reason (`rejected <ISO time> by owner: <reason> (<id>)`), the current rank (`already queued at rank <n>`), or `excluded by config`. `--json` prints `{ok: false, blocked}` when blocked
- **FR:cli.decisions** (P1): `stack pr-pri decisions [--agent a] [--json]` prints one line per decision: `<state> <url> (<agent>) <date>: <owner reason or "-">`, or `no decisions`
- **FR:cli.more** (P1): `depends`, `record`, `ack` and `escalate` run `FR:pr-priority/edge.*` and `FR:pr-priority/record.*` and print one line. Bad input exits `2`

### FR:api: API

The PR page and agents need the queue over the API so that the owner can act from the app.

- **FR:api.get** (P1): `GET /pr-priority` (route `prPriority.get`, scope `tasks:read`) returns the list view (`FR:pr-priority/view.item`, cached facts only) plus `recommendations` (the `open` ones, `FR:pr-priority/rec.order`) to the owner only. Another caller gets `403`. A host with no store returns `404`
- **FR:api.put** (P1): `POST /pr-priority` (route `prPriority.put`, scope `tasks:write`) takes `{rev, op, ref?, rank?, to?, note?, thread?}` from the owner only. `op` is `add`, `move`, `pin`, `unpin`, `remove`, `undo` or `ack`; `ref` is a PR ref or url (`FR:pr-priority/queue.ref`); `to` is `top`, `up` or `down`. A stale `rev` returns `409` (`ack` changes no queue item, so its `rev` is not checked); a PR that is not queued returns `404`; success returns `200` with `changed` and the list view
- **FR:api.recommend** (P1): `POST /pr-priority/recommendations` (route `prPriority.recommend`, scope `tasks:write`; an agent token may call it) takes `{repo, number, agent, reason, toRank?}` and returns `200` `{created, rec}`. A token caller must send its own token name (as a slug) in `agent`, else `403`. When blocked it returns `409` with the owner's reason or the rank in the message and `error.details`
- **FR:api.decisions** (P1): `GET /pr-priority/recommendations` (route `prPriority.decisions`, scope `tasks:read`; an agent token may call it) with optional `agent` returns `{items}` (`FR:pr-priority/rec.decisions`)
- **FR:api.decide** (P1): `POST /pr-priority/recommendations/{id}` (route `prPriority.decide`, scope `tasks:write`) takes `{decision, rank?, note?, reason?}` from the owner only and returns `200` `{rec, queue}`
- **FR:api.pr** (P1): Each PR in `GET /agents` has `priority`: its queue rank, or `null` when it is not queued or the host has no store

## Data Model

- **FR:$item** (P1): **`PrPriItem`** — One queued PR: `rank`, `repo`, `number`, `url`, `pinned`, `note?`, `by`, `at`
- **FR:$rec** (P1): **`PrRec`** — One recommendation: `id`, `repo`, `number`, `url`, `agent`, `reason`, `toRank?`, `state`, `at`, `decision?`

## Architecture Constraints

- Queue and state are live state under `~/.stack`, never in the content repo or git
- Only the owner changes the queue, decides, or acks. The API enforces this; the CLI trusts the local user, and the SM prompt names only the agent commands. An agent recommends, reads decisions, adds edges, writes per-PR records, and writes the escalation set
- No LLM call. Stack never merges, labels, or un-drafts a PR

## Dependencies

- status-ingest (`~/.stack` home, lock rules), session-inventory (store pattern), api (routes, errors), auth-security (scope table), cli (exit codes), ask-queue (Needs you), agent-inbox (`GET /agents` PR shape)
