---
id: pr-page
title: PR Page
author: flanakin
description: "One live flyout for every PR the owner reviews or moves: who must act, with one-tap actions."
dependencies: [github-pr-status, connector-github, session-inventory, pr-priority, web-shell, ask-queue, cli, auth-security]
---

<!-- markdownlint-disable single-title -->

# Feature: PR Page

## Purpose

The owner has many open PRs across repos. Agents move most of them. He must see, in one place, which PRs wait on him, and unblock them with one tap. He must also move a PR to the top of the Sweep Manager queue with one tap.

## Scope

- In: the board model and its pure rules, the host poller, the GitHub sign-in, `GET /prs` and the owner-only write routes, the nav entry and the `#/prs` page, the top bar icon, the flyout, the CLI `stack prs`.
- Out: the GitHub read and write transport (`FR:github-pr-status/board.*`, `FR:github-pr-status/write.*`), the queue store and its CLI (`FR:pr-priority/*`), the escalation set writer (the Sweep Manager).
- Never: merge, un-draft, or close a PR. No UI control and no route does it.

## Terms

- **Owner**: the signed-in GitHub user. Config `github.user` in `.xe/config/stack.json`. Without it, the host reads `GET /user` once (`FR:github-pr-status/board.user`). The token comes from `FR:pr-page/auth.token`.
- **Me**: a PR author, assignee, reviewer, or comment author that equals the owner (no case).
- **Human comment**: a comment by me that does not start with `🤖 [AI]` or `⚛️ [Catalyst]`. Agents post as the owner with that prefix.
- **Labels** (no case, variation selectors ignored): Autopilot `Status: 🤖 Autopilot`; WIP `Status: 🚧 WIP`; Paused `Status: ⏸️ Paused`; Needs attention: any label that matches `needs:? attention`.
- **Active agent**: a `running` session in `GET /session-inventory` that links at least one PR whose state is not `MERGED` or `CLOSED`. On a host with no inventory, each board PR with the WIP label counts as one active agent. Choice: the inventory knows which session works which PR; a label is a weaker sign, so it is only the fallback.

## Scenarios

### FR:group: Groups

The owner needs each PR in exactly one group so that he knows who must act.

- **FR:group.@function** (P1): `groupOf(pr, ctx)` is pure. It returns one of `blocked`, `waiting`, `processing`, `pending`, `paused`, or `null` (not shown). The first rule that matches wins:
  1. A PR in config `github.exclude` (entries `owner/repo#n`, a PR url, or `#n` for any repo) is `null`
  2. Authored by me with the Paused label: `paused`
  3. Authored by me with the Autopilot label: `blocked` when the state owner is me (`FR:pr-page/state.*`), else `processing`
  4. Assigned to me with the Autopilot label: same as 3
  5. Not by me, not a draft, my latest review is not `APPROVED`, and review is requested from me or the repo is one of mine: `waiting`. My repos are `FR:pr-page/auth.repos`
  6. Authored by me with no Autopilot label: `pending`
  7. Else `null`
- **FR:group.bucket** (P1): Each row that waits on me shows one badge, a glyph plus a word: `👍 Approve` (waiting), `👀 Review` (pending, not a draft: review it, then apply Autopilot), `🧭 Decide` or `⛔ Unblock` (blocked, `FR:pr-page/state.bucket`). Other rows have no badge
- **FR:group.healthy** (P1): A processing row is healthy when its state owner is `none` or `ci` and it is not stalled. The Processing tab hides healthy rows. A `Show healthy (n)` toggle shows them
- **FR:group.order** (P1): Rows sort by project: Allyte (FinOps hubs first), FTK, FOCUS, F4, Xerilium (Catalyst first), other. Then by queue rank (queued first, rank 1 first). Then oldest first. The project of a repo uses the session-inventory rules on the repo name, then the owner: `allytehq` Allyte, `Xerilium` Xerilium
- **FR:group.footer** (P2): The flyout footer shows `running n · waiting n · parked n`: active agents; rows whose state owner is me plus waiting and non-draft pending rows; paused rows plus my drafts

### FR:state: Who must act

The owner needs only his own gates in Blocked so that waits on others never look like his.

- **FR:state.@function** (P1): `stateOf(pr, ctx)` is pure and returns `{owner, bucket?, blocker, link, stalled, source}`. `owner` is `me`, `reviewer` (with the login), `ci`, `runner`, or `none`. `source` is `report` or `rule`
- **FR:state.report** (P1): When the queue file has a `report` for the PR (`FR:pr-page/data.report`) and its `headSha` is absent or equals the PR head, the report wins: `owner` `michael` or the owner login maps to `me`; `ci`, `runner`, `none` map as is; any other login maps to `reviewer`. `blocker` is the report `blocker`, else `nextAction`
- **FR:state.rule** (P1): With no usable report, the first match wins. Michael-only gates (owner `me`):
  1. A Needs attention label: `🧭`, "Needs attention label"
  2. The newest comment or thread reply that holds `🧭` has no later human comment: `🧭`, its first line
  3. An unresolved thread whose last comment is a human comment that says `hold` or `wait for (my) ack`: `🧭`, "Hold: " and the text
  4. A check run with conclusion `action_required`: `⛔`, "Approve the workflow run"

  Waits on others:
  5. A reviewer other than me whose latest review is `CHANGES_REQUESTED`, or a pending review request to a user other than me: `reviewer`, "Waiting on <login>"
  6. A check pending for more than 1 hour: `runner`, "Checks queued over 1 h"
  7. A failing required check, a merge conflict, or an unresolved thread whose last comment is not by me: when an active agent links the PR, `none`; else `none` with `stalled` true and "No agent: <signal>"
  8. A check pending: `ci`
  9. Else `none`
- **FR:state.bucket** (P1): For owner `me`, a blocker that names access, permission(s), approve or approval, secret(s), billing, deploy or deployment, prod or production, runner admin, or admin rights is `⛔ Unblock`; else `🧭 Decide`. Rules 2 and 3 use the same test on their text
- **FR:state.why** (P1): The rule is the fallback for `FR:pr-page/state.report`. Choice: the first ask listed failing checks, conflicts and bot threads as blocked. Agents fix those, so they are a stall (rule 7), not an owner gate. Change the rule in `src/core/pr-board.ts` only; its tests list each case
- **FR:state.view** (P1): Each row shows the owner as a chip: `You` (accent fill), a reviewer login (outline, never the accent), `CI`, `Runner`. The blocker text links to its thread (`link`), else to the PR. A `runner` row also shows a `CI/runner` badge

### FR:data: Data

The page needs one token-free shape so that the browser never holds a GitHub token.

- **FR:data.board** (P1): `GET /prs` returns `{at, user, agents: {count, source}, counts, rows, escalations?, queue, rate?}`. `at` is the time of the last good poll. `source` is `sessions` or `wip-label`. `counts` holds each group. `queue` is true when the host can change the queue. `rate` is `{until}` while the poller backs off
- **FR:data.row** (P1): A row is `{url, repo, number, title, author, project, group, draft, createdAt, updatedAt, ci, unresolved, labels, state, agent, after, rank, pinned, rec?}`. `ci` is `passing`, `failing`, `pending`, or `none`. `after` lists the PRs this one waits for. `rank` is the queue rank or null: the row keeps a fixed slot for it. `rec` is an open priority recommendation `{id, agent, reason, toRank?}`. Every url starts with `https://github.com/`
- **FR:data.after** (P2): `after` comes from the PR body: `depends on`, `after`, or `blocked by`, then `#n` or `owner/repo#n`. At most 3. The row shows `after #n`
- **FR:data.report** (P1): The host reads the `pr-priority` store read-only (`FR:pr-priority/record.model`): `<home>/pr-priority.json` (queue: `rank`, `pinned`), `<home>/pr-priority-state.json` (`records` keyed `owner/repo#n`, `acks`, `recs`, `escalations`), and `<home>/pr-priority.config.json` (`exclude`, added to config `github.exclude`). A record `{state, ts, owner?, blocker?: {text, threadUrl?}, nextAction?, headSha?, bucket?}` is the report; its `bucket` wins over `FR:pr-page/state.bucket`. A bad record drops the report, not the row. A thread the owner acked (`acks`) turns a rule gate on that thread into `Answered: <note>` with owner `none`
- **FR:data.escalations** (P1): The escalation set is `{blockedAutopilot: [≤3 {pr, status, exactBlocker, context, recommendedAnswer}], enableAutopilot: [≤3 {pr, whyEasy}], liveValidation: [≤1 {pr, why}], at?}`. `pr` is a PR url; any other entry is dropped. The thread link comes from the PR record `blocker.threadUrl`
- **FR:data.recs** (P2): Open recommendations are the `recs` with state `open` in `pr-priority-state.json` (`FR:pr-priority/rec.model`)

### FR:auth: Sign-in with zero setup

The owner needs the board to work on first open so that he never sets a token or a repo list by hand.

- **FR:auth.token** (P1): The local host (`stack web`, the desktop app, `stack prs`) takes the GitHub token in this order: `GITHUB_TOKEN`, then `gh auth token --hostname github.com` (fixed args, no shell, 5 s cap). A found token is read again after 10 minutes; no token is read again after 15 s, so a sign-in in a terminal shows at once. A new token rebuilds the board. `STACK_GH_AUTH=off` skips `gh` (tests). No log line, reply, or page holds the token
- **FR:auth.repos** (P1): My repos, in this order: `STACK_GITHUB_REPOS`, then config `github.repos` (owners or `owner/repo`), else the owner plus each org where the owner is an `admin` (`GET /user/memberships/orgs`, read once an hour; a failed read uses the owner only). Choice: admin orgs are the owner's own work (Xerilium, allytehq). A repo in a project file `Repository:` line outside those orgs (microsoft/finops-toolkit, FOCUS_Spec) shows only PRs that involve the owner or request his review: those repos have many PRs that are not his. The write allow-list (`FR:pr-page/api.repos`) uses only the explicit lists
- **FR:auth.state** (P1): With no token, `GET /prs` answers `200` `{auth: {state: 'signed-out', method, session?}}`. `method` is `gh` when the `gh` CLI runs, else `none`. The page shows one state, never an empty zero board: "Sign in to GitHub to see your PRs." with one `Sign in to GitHub` button (`gh`), or "Install the GitHub CLI, or set GITHUB_TOKEN." (`none`)
- **FR:auth.signin** (P1): `POST /prs/sign-in` (route `prs.signin`, owner only) runs `gh auth login --web --hostname github.com --git-protocol https --skip-ssh-key` (fixed args, no shell) and returns the session `{state, userCode?, verificationUri?, error?}`. `state` is `waiting`, `done`, or `error`. The code and the `https://github.com/login/device` link come from the `gh` output; no other output is kept or logged. `gh` polls GitHub and stores the token in its own store. Exit 0 is `done`, and the next `GET /prs` reads the token. One sign-in runs at a time; a start while one waits returns it. It ends with `expired` after 15 minutes. `GET /prs/sign-in` returns the session. The page shows the code with a Copy button and an "Open github.com/login/device" link, and polls the session every 3 s
- **FR:auth.azure** (P2): The Azure host keeps `GITHUB_TOKEN` only, and answers `{off: true}` without it

### FR:live: Live

The owner needs near-real-time status so that he never reloads.

- **FR:live.poll** (P1): The host polls GitHub every 45 s (config 30-60 s) while a page holds a lease. `GET /prs` takes or renews a 3-minute lease. With no lease, the host does not poll. A board older than two intervals (a lapsed lease) polls before `GET /prs` answers. Queue, ack, and decision writes change local files only and do not poll GitHub
- **FR:live.event** (P1): When a poll changes the board, the host sends `change` with kinds `["prs"]` on `/events`. The page reloads `/prs` on `prs`, `pr-priority`, `poll`, or a reconnect, and every 60 s while visible (this renews the lease)
- **FR:live.backoff** (P1): A rate-limit answer (HTTP 403 or 429 with `x-ratelimit-remaining: 0` or `retry-after`, or GraphQL `RATE_LIMITED`) pauses polls until the reset time. Fewer than 100 GraphQL points left pauses until `resetAt`. Other errors back off 2x per failure, up to 15 minutes. The last good board stays
- **FR:live.age** (P1): The flyout shows `Updated 12 s ago`, from `at`, and ticks while open. When backing off, it shows `Paused until 2:15`

### FR:icon: Top bar icon

The owner needs a glance count so that he knows agents are moving.

- **FR:icon.place** (P1): A PR icon sits in the app top bar: the rail brand row (desktop) and the phone top bar. It shows the active agent count when above 0. Its name is `Pull requests: n agents active`. Signed out, it shows no count and its name is `Pull requests: sign in to GitHub`
- **FR:icon.absent** (P1): The icon and the nav entry show while the first poll runs (no count). They are absent only where the host has no board at all: `GET /prs` answers `200` `{off: true}` (the Azure host with no token; no failing request in the console). A `404` from an older host also hides them. Signed out is not absent (`FR:pr-page/auth.state`)
- **FR:icon.open** (P1): Click or tap opens the flyout (full screen on a phone)
- **FR:icon.why** (P1): Choice: PR 145 hid the icon whenever `GET /prs` said `off`, and the host said `off` whenever `GITHUB_TOKEN` was not in its environment. A macOS app opened from the Dock gets no shell environment, so the installed app never had a token and never showed the icon. There was no nav entry either. The sign-in (`FR:pr-page/auth.*`) and the nav entry (`FR:pr-page/nav.*`) fix both

### FR:nav: Nav entry and page

The owner needs the PRs in the main nav so that he finds them without a hidden icon.

- **FR:nav.rail** (P1): The rail has `Pull requests` after `Needs you`, chord `g r`. It opens the `#/prs` page
- **FR:nav.badge** (P1): The nav entry shows a count of `Blocked on me` plus `Waiting on me` rows when above 0, name `n need you`. Signed out, it shows a dot, name `Sign in to GitHub`
- **FR:nav.phone** (P1): The phone tab bar keeps its five slots. `More` (the command palette) lists `Go to Pull requests` with the same count. The top bar icon opens the flyout full screen
- **FR:nav.page** (P1): `#/prs` shows the flyout content as a page: the same tabs, chips, rows, actions, and sign-in state, with no scrim and no Close
- **FR:nav.load** (P1): The first open polls GitHub before it answers (`FR:pr-page/live.poll`). Until it answers, the page and the flyout show a skeleton (`aria-busy`), never a zero count

### FR:flyout: Flyout

The owner needs the PR list one keystroke away on any screen so that he can act without leaving his work.

- **FR:flyout.shape** (P1): Desktop: a panel on the right, 480 px wide, over the page. Phone (below 720 px, the app phone layout): full screen. It is a dialog: focus moves in, `Escape` closes, focus returns to the icon
- **FR:flyout.tabs** (P1): Tabs, in order: `Escalation set` (only when present), `Blocked on me`, `Waiting on me`, `Processing`, `Pending`, `Paused`. Each tab shows its count. Arrow keys move between tabs. The last tab is remembered
- **FR:flyout.row** (P1): A row shows at most 20 words: title (cut to 80 characters), `repo#n`, age, CI glyph and word, unresolved thread count, up to 3 labels, the state chip and badge, the blocker, `after` chips, and the rank slot. The title opens the PR on GitHub in a new tab; the desktop app opens it in the browser
- **FR:flyout.filter** (P1): Project chips filter rows (multi-select; none selected shows all). The choice is remembered in local storage. Tab counts follow the filter
- **FR:flyout.empty** (P2): An empty tab says who is next: `Nothing blocked on you.`
- **FR:flyout.a11y** (P1): Axe finds no violation at 375 px and 1280 px, light and dark. Every target is at least 44 px on touch and 24 px on desktop. No sideways scroll

### FR:act: Row actions

The owner needs one tap to unblock a PR or move it up so that PR progress never waits on a hunt for the right page.

- **FR:act.owner** (P1): Only the owner session sees or calls actions. A token gets `403`
- **FR:act.queue** (P1): A row not in the queue shows `Queue` (`add`: top of the unpinned items). A queued row shows `Top`, `Up`, `Down`, `Pin` or `Unpin`, and `Remove`; the rank slot shows `📌` when pinned. Each shows a toast with Undo, which runs `undo`. Keys on the focused row: `t`, `u`, `d`, `p` (queue, pin, or unpin). Hidden when `queue` is false
- **FR:act.autopilot** (P1): `Apply Autopilot` on my pending, non-draft rows; `Remove Autopilot` in the row menu of Autopilot rows. A confirm sheet shows the PR link and the label name. Apply is the human act; agents never apply it
- **FR:act.accept** (P1): On an escalation entry with a recommended answer (pre-filled, editable): `Accept` records it with `ack --thread --note` (the thread is the blocker link, else the PR). There is no Undo: the store has no unack; a new answer replaces the old one. `Accept and reply…` opens a sheet with the answer, `Also post on GitHub`, and the exact text (`🤖 [AI] ` plus the answer). Key `a`. With `queue` false, Accept is hidden and the entry offers `Reply on GitHub…` only. A blocked row that is not in the escalation set offers `Answer…` with the same sheet
- **FR:act.thread** (P1): `Open thread` opens the blocker link
- **FR:act.rec** (P1): A row with `rec` shows `Raise to n: <reason>` with `Accept`, `Edit`, `Reject`. Each opens a confirm sheet. Edit takes rank and note; Edit and Reject need a reason
- **FR:act.set** (P1): The Escalation set tab shows its entries in three sections: Decide (blocked, with the recommended answer filled in), Enable Autopilot, Validate live. A single tap runs the entry's main action (`Accept`, `Apply Autopilot`, `Open PR`). `Select` turns on bulk mode: check entries, then `Run n` opens one confirm sheet that lists each action
- **FR:act.never** (P1): No control merges, un-drafts, closes, or approves a PR

### FR:api: API

The web page and agents need one owner-only route for the board so that every client shows the same state.

- **FR:api.get** (P1): `GET /prs` (route `prs.get`, scope `tasks:read`) returns the board to the owner only. `stack web` and the desktop app serve it with the token from `FR:pr-page/auth.token`, and answer `FR:pr-page/auth.state` without one. The Azure host serves it when `GITHUB_TOKEN` is set; it has no session inventory, so the WIP label counts agents. A host with no board returns `200` `{off: true}`
- **FR:api.queue** (P1): `POST /prs/queue` (route `prs.queue`, scope `tasks:write`) takes `{repo, number, op, rank?}`. `op` is `top`, `up`, `down`, `move` (to `rank`), `add`, `pin`, `unpin`, `remove`, or `undo`. Returns `{rank, was, pinned}`
- **FR:api.label** (P1): `POST /prs/label` (route `prs.label`) takes `{repo, number, op}`, `op` `add` or `remove`. The label is always Autopilot; no other label can be set
- **FR:api.ack** (P1): `POST /prs/ack` (route `prs.ack`) takes `{repo, number, thread, note, post?, text?, replyTo?}` (`thread` is a GitHub url). `post` true also posts `text` (must start with `🤖 [AI] `) as a thread reply to `replyTo` (a review comment id), else as a PR comment. The post runs first; a failed post records nothing. After a post, a failed record answers `200` `{posted: true, recorded: false, message}`, so the page closes the sheet and never posts twice. With no post, a missing queue answers `409`. A thread link `#discussion_r<id>` gives `replyTo`
- **FR:api.rec** (P1): `POST /prs/recs/{id}` (route `prs.rec`) takes `{decision, rank?, note?, reason?}`: `accept` runs `accept <id>`, `edit` runs `edit <id> --reason [--rank] [--note]`, `reject` runs `reject <id> --reason`. Edit and Reject need a reason
- **FR:api.queue-client** (P1): The host changes the queue through `PrQueue`, which runs `stack pr-pri` (`FR:pr-priority/cli.*`): `move <ref> --to=top|up|down|n`, `add`, `pin`, `unpin`, `remove <ref>`, `undo`, `ack <ref> --thread=<url> --note=<t>`, `accept <id>`, `edit <id> --reason=<t> [--rank=n] [--note=t]`, `reject <id> --reason=<t>`. `--name=value` keeps a value that starts with `--` a value. `queue` on the board is true only when `pr-pri list --json` runs (checked at most every 10 minutes); `stack web` calls its own `PrPriorityStore` in-process with the same ops (no child process); the Azure host has no CLI and uses a queue that is never available. An unknown command answers `409` `PR priority queue is not installed`; a refused change answers `409` with the reason
- **FR:api.repos** (P1): Every GitHub write checks the repo against `STACK_GITHUB_REPOS` when set (`FR:github-pr-status/repos.allow`), and the PR must be on the owner board. Others get `403`

### FR:cli: CLI

The owner needs the board in a terminal so that he can check it without the web app.

- **FR:cli.prs** (P1): `stack prs [--group g] [--project p] [--json]` prints the counts, then one line per row: `<group> [<project>] <repo>#<n> <title> · <owner>: <blocker> <url>`. `--project` takes a project or a repo. `--json` prints `{ok: true, ...board}`. The token comes from `FR:pr-page/auth.token`. With none, it exits `1` with `GitHub sign-in needed: run gh auth login or set GITHUB_TOKEN`. Never prints the token

## Data Model

- **FR:$row** (P1): **`PrRow`**, see `FR:pr-page/data.row`
- **FR:$board** (P1): **`PrBoard`**, see `FR:pr-page/data.board`

## Architecture Constraints

- The token stays on the host. No route returns it; no log line holds it.
- The rules (`groupOf`, `stateOf`, `bucketOf`) are pure functions in `src/core/pr-board.ts`.
- All GitHub writes go through one module with an injected fetch (`FR:github-pr-status/write.*`).
- The flyout does not edit Now or Needs you beyond one import each.

## External Dependencies

- github-pr-status (board read, writes), session-inventory (active agents, project rules), pr-priority (queue file, reports, escalations, the `pr-pri` CLI), web-shell (rail, live), cli, auth-security (scope table).
