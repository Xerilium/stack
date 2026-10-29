---
id: ask-queue
title: Live Ask Queue
author: flanakin
description: "One live, ranked list of what needs the owner. Agents write asks as files; Stack ranks them, pushes changes to the page, and carries the owner's answer back to the agent as a file."
dependencies: [api, storage-git, agent-inbox, auth-security, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Live Ask Queue

## Purpose

The owner runs several companies through Chief of Staff (CoS) agents and gets overwhelmed by messages. This feature makes one page the only interface to them: it shows the few things that need the owner, ranked, each with exactly one ask, a deadline, a link, a recommendation, and what happens if the owner stays silent. Agents do all processing and write the result as **ask files**. The page re-renders by itself when a file changes (like a dev server). The owner's answer is written back into the same file, which the agent reads. No feed, no status, no play-by-play.

Design and rationale: `docs/design/ask-queue.md`. Agent contract: `docs/asks.md`.

## Scope

- In: ask file format and storage path, core put/answer/handle/snooze/list/score, API routes `asks.list`, `asks.put`, `asks.answer`, `asks.handle`, a file watcher and server-sent events in `stack web`, CLI `stack asks`, the Asks view in the web app.
- Out: MCP tools (next: `asks_list`, `asks_put`, `asks_handle`, no answer tool because agents never answer; needs path parameters and array arguments in the MCP tool table), parsing CoS state files (they are prose and agent-owned; see design doc), pushing answers into a running chat session, email/Slack ingestion (module `email-triage` feeds asks), notifications, multi-user.

## Ask file format (v1)

One file per ask: `tasks/asks/<key>.md`. `<key>` is chosen by the agent (stable, e.g. `pr-879-approve`), so writing the same key again updates the ask instead of adding another. Fields are `- key: value` lines; an optional `## Detail` section holds long free markdown (hidden until the owner expands the ask); an optional `## Thread` section holds one line per exchange.

```markdown
# Ask: pr-879-approve

<!-- stack-ask v1. Agents write with POST /asks/<key> or `stack asks put`. Stack writes the answer; the agent reads it, acts, then handles the ask. -->

- state: open
- ask: Approve merging PR 879 into dev
- kind: approve
- from: allyte-cos
- project: allyte
- why: Go-live is Oct 29; Roland re-approved and CI is green
- recommend: Approve
- default: Merges Oct 29 8:00am
- by: 2026-10-29T15:00:00.000Z
- reversible: yes
- link: https://github.com/example/repo/pull/879
- priority: high
- effort: 2m
- blocks: 3
- created: 2026-10-28T14:03:11.000Z
- updated: 2026-10-28T14:03:11.000Z

## Detail

Landing page replaces the teaser. Remaining risk: keyboard pass not yet signed off.
```

After the owner answers, Stack adds `answer`, `text`, `answered`. After the agent handles it, `outcome`, `handled` (`<iso> by <actor>`) and `note`. A snooze adds `snoozed` (iso).

## Scenarios

### FR:ask: Data model

- **FR:ask.path** (P1): Storage accepts `tasks/asks/<key>.md` (key `[a-z0-9][a-z0-9._-]{0,79}`, lower case; `README.md` refused). Ask files are never listed as projects, and storage can list the ask folder (`listAsks`, filesystem and memory adapters)
- **FR:ask.format** (P1): `formatAsk` and `parseAsk` round-trip the v1 format. Fields: `state` (`open`, `answered`, `done`), `ask` (one line, 1-200 chars; the one exact ask), `kind` (`approve`, `decide`, `review`, `go-do`, `answer`), `from`, `project`, `why` (one line, optional), `recommend` (one line; for `decide` one of `options`), `options` (` | `-separated, 2-4, only for `decide`), `default` (what happens if the owner is silent), `by` (ISO deadline), `reversible` (`yes` or `no`, default `no`), `link` (`https` url), `priority` (`crit`, `high`, `normal`, `low`; default `normal`), `effort` (`<n>m` or `<n>h`), `blocks` (integer 0-99), `created`, `updated`, then `answer`, `text`, `answered`, `outcome`, `handled`, `note`, `snoozed`. Unknown lines are kept. Parsing is tolerant: a missing field takes its default, a bad one is dropped
- **FR:ask.safe** (P1): Every field is redacted and escaped like inbox fields (`FR:agent-inbox/inbox.send`): single line, no control or invisible characters, no markdown links or images from agent text, `link` must be an `https` url. `## Detail` is stored as given but the page renders it as plain text with no html
- **FR:ask.score** (P1): `scoreAsk(ask, now)` is deterministic: priority (crit 100, high 60, normal 30, low 10) plus deadline pressure (overdue 80, under 2 h 70, under 24 h 50, under 3 d 30, under 7 d 15, else 0) plus 5 per blocked item (max 20) plus 8 when effort is 5 minutes or less plus 10 when not reversible and `by` is within 3 days plus 1 per day open (max 10)
- **FR:ask.rank** (P1): `listAsks` returns visible asks by score descending, ties by earlier `by`, then older `created`, then key. Visible means `state: open` and not snoozed (`snoozed` in the future). `state=answered` returns asks waiting on the agent, oldest answer first; `state=done` newest first; `all` returns every ask unranked by file order

### FR:flow: Lifecycle

- **FR:flow.put** (P1): `putAsk(key, fields, actor)` creates or updates an ask. Update keeps `created` and every owner field (`answer`, `text`, `answered`, `snoozed`). `updated` is set to now. Required on create: `ask`, `kind`, `from`. A `done` ask is reopened only when the agent sends `reopen: true`; otherwise putting a done key is `409 conflict`. Agents may not write owner fields
- **FR:flow.answer** (P1): `answerAsk(key, {answer, text?, until?})` is owner-only. `answer` is `go` (the recommendation or the only action), `no`, `option` (`text` is one of `options`), `reply` (free text 1-1000 chars), `ask` (a question for the agent, 1-1000 chars), `done` (a go-do item is finished), `defer` (`until` is an ISO time; sets `snoozed`, state stays `open`, clamped to `by` when the ask is reversible and has a default), or `retract` (an `answered` ask returns to `open` and loses its answer; allowed until handled). Answering a non-open ask is `409 conflict` except `retract`. Sets `state: answered` and `answered` (not for `defer`/`retract`)
- **FR:flow.handle** (P1): `handleAsk(key, {outcome, note?, reply?}, actor)` is called by the agent. `outcome` is `handled` (acted on the answer), `resolved` (moot, no answer needed), `defaulted` (applied the default after `by`), or `reopen` (needs the owner again, `reply` is the agent's one-line response to the owner's question or reply and is appended to `## Thread`). The first three set `state: done`, `outcome`, `handled`; `reopen` returns to `open`, keeps `ask` unless the agent also puts a new one. Handling an already done ask is `changed: false`
- **FR:flow.default** (P2): When `by` has passed, the ask is marked `overdue` in the list. Stack never applies a default itself: acting is the agent's job (`FR:ask-queue/flow.handle` with `defaulted`). The page shows the default only for reversible asks; for an irreversible ask it says `No default: waits for you`
- **FR:flow.thread** (P2): `## Thread` gets one line per exchange: `- <iso> you: <text>` for an owner answer of kind `reply` or `ask`, `- <iso> <actor>: <reply>` for an agent `reopen` reply. The page shows only the last agent line on the card

### FR:api: Routes

- **FR:api.list** (P1): `GET /asks?state=&limit=` (route `asks.list`, scope `tasks:read`) returns `{items, total, latest, snoozed}`; `state` is `open` (default), `answered`, `done`, `snoozed` (open asks hidden until a later time, soonest first), or `all`; `limit` 1-200 default 50; `snoozed` counts open asks currently snoozed. Each item has every field plus `key`, `score`, `rank` (open only), `overdue`, and `snoozedUntil`. `latest` is the newest `updated` across all asks
- **FR:api.put** (P1): `POST /asks/{key}` (route `asks.put`, scope `tasks:write`) with the agent fields returns `200 {key, created}`. Tokens and the owner may call it. `from` defaults to the token's actor
- **FR:api.answer** (P1): `POST /asks/{key}/answer` (route `asks.answer`, scope `tasks:write`) with `{answer, text?, until?}`. Only the owner session may call it: a token caller gets `403 forbidden`, so an agent can never answer in the owner's voice
- **FR:api.handle** (P1): `POST /asks/{key}/handle` (route `asks.handle`, scope `tasks:write`) with `{outcome, note?, reply?}` returns `{changed}`. Unknown key is 404. All four routes are in `docs/api/openapi.yaml`

### FR:live: Watcher and push

- **FR:live.watch** (P1): `stack web` watches the served folder (`tasks/`, `tasks/asks/`, `.stack/`) and coalesces bursts for 150 ms into one change, classified `asks` (a file under `tasks/asks/`), `tasks` (other `tasks/` files), or `state` (a file in `.stack/`). Editor temp files, dotfiles, and `.git` are ignored
- **FR:live.sse** (P1): `GET /events` (not under `/api`; same loopback and Host guards as the app) is a server-sent event stream. `/.auth/me` carries `events: true` when the stream exists, and the page connects only then (other hosts: no request, no console noise). It sends `event: hello` with `{rev}` on connect, `event: change` with `{rev, kinds}` per change, and a comment line every 20 s. `rev` is a counter that increases per change. A client that reconnects with an old `rev` gets one `change` with all kinds
- **FR:live.fallback** (P1): Hosts with no watcher (the Azure host) do not set `events` in `/.auth/me`. The page then polls `GET /asks` every 15 s while visible, and every 60 s refreshes the clock-dependent ranking in all cases
- **FR:live.quiet** (P1): A change the page itself caused (its own write) does not flash or toast. A change from elsewhere updates the list in place: the owner's cursor stays on the same ask, a new ask fades in with a dot for 6 s, a removed ask fades out. No toast, sound, or notification appears for incoming asks (the browser tab title carries the open count)

### FR:cli: Agent entry points

- **FR:cli.put** (P1): `stack asks put <key> --ask "<text>" --kind <k> --from <agent> [--project --why --recommend --options "A|B" --default --by --reversible yes|no --link --priority --effort --blocks --detail-file <path>]` writes the ask file in the repo folder (no server needed) and prints the key
- **FR:cli.list** (P1): `stack asks list [--state open|answered|done|all] [--json]` prints ranked rows (`key  score  ask`); `--json` prints the api shape
- **FR:cli.handle** (P1): `stack asks handle <key> --outcome handled|resolved|defaulted|reopen [--note --reply]`

### FR:web: Asks view

- **FR:web.home** (P1): The Asks view (`#asks`) is the default view, first in the rail (`g k`), and the tab title shows the open count (`(3) Stack`). It shows at most 5 asks; the rest are behind `n more` and the view says so once, not with a badge
- **FR:web.card** (P1): The ask under the cursor (rank 1 at load) is expanded. It shows, in this order: `n of total`, the project and agent, a deadline (`Today 5:00 pm · in 3 h`, warning color when under 24 h or overdue), the ask as the heading, `Why` as one muted line, a `Recommend` line only when it says more than the primary button (the primary button is the recommendation), one line `If silent: <default>` (or `No default: waits for you`), then the actions, with the link as a button that opens in a new tab. `## Detail` opens with `e`. Other asks are one-line rows: the action to take, the deadline, the project; nothing else, so the list can be triaged without opening each
- **FR:web.actions** (P1): Actions by kind. `approve`: Approve (`Enter`), Reject (`n`). `decide`: one button per option, numbered `1-4`, the recommendation filled, tagged `recommended`, and bound to `Enter`. `review`: Open (`o`), Looks good (`Enter`), Needs changes (`n`, opens the reply box). `go-do`: Open (`o`), Done (`Enter`). `answer`: the reply box is always open (with Defer beside it) and `Enter` sends. While a reply box is open Send is the only filled button. Every ask also has Defer (`z`: 1 hour, this evening, tomorrow 9 am, Monday 9 am, pick a time) and Reply or Ask (`r`, one line, `Enter` sends, `Esc` closes)
- **FR:web.optimistic** (P1): An answer removes the ask from the list at once and shows the toast `Sent to <agent> · Undo` (8 s, `u`). Undo sends `retract`. A failed write puts the ask back and says why. Answered asks wait under a collapsed `Sent (n)` footer, each with its answer and `waiting on <agent>`; a reopened ask returns to the list with the agent's reply line
- **FR:web.live** (P1): The page opens `/events` and refetches asks on each `asks` change; the header shows a quiet live dot with `Live` (or `Updated 12 s ago` on the polling fallback, `Offline` with Retry when both fail). The page re-ranks every 60 s
- **FR:web.empty** (P1): With nothing open the view shows `Nothing needs you.` with the time of the newest agent write and, if any, the `Sent (n)` and `Snoozed (n)` footers. A load failure shows the error with Retry; the rest of the app keeps working
- **FR:web.keys** (P1): In the Asks view `j`/`k`/arrows move the cursor, `Enter` takes the primary action, `n`, `o`, `r`, `z`, `e`, `u` as in `FR:ask-queue/web.actions`, `1-4` pick an option, `g k` goes to Asks. Keys are ignored while typing. Every action is also in the command palette and the `?` help
- **FR:web.a11y** (P1): The list is a labelled region; the live area announces `n asks` changes politely only when the count changes from elsewhere; focus is never moved by a live update; buttons are 44 px tall on touch; contrast is at least 4.5:1; motion is 120-200 ms and removed with `prefers-reduced-motion`
- **FR:web.responsive** (P1): The view works at 390, 1024 and 1440 px, light and dark. On a phone the primary action is in the thumb zone and the rail becomes the tab bar

## Dependencies

- agent-inbox (redaction helpers, owner-only rule), storage-git (paths, atomic writes, one commit per write), api (routes, validation), auth-security (scope table), web-app (shell, keys, palette)
