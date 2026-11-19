---
id: pr-page
title: PR Page
author: flanakin
description: "One PR page: a Summary of what needs the owner, one card per PR with one next action, a details pane, and a Pinned order."
dependencies: [ui-kit, github-pr-status, connector-github, session-inventory, pr-priority, pr-review-lane, web-shell, ask-queue, cli, auth-security]
---

<!-- markdownlint-disable single-title -->

# Feature: PR Page

## Purpose

The owner has many open PRs across repos. Agents move most of them. He must see, in one place, the few PRs that need him, and the one next action for each. He must also pin PRs and set their order for the Sweep Manager.

## Scope

- In: the board model and its pure rules, the host poller, the GitHub sign-in, `GET /prs` and the owner-only write routes, the nav entry and the `#/prs` page, the top bar icon, the flyout, the Summary tab, the PR card, the quick actions menu, the details pane, the Pinned tab, the test server of a PR (`FR:pr-page/server.*`), the CLI `stack prs`.
- Out: the GitHub read and write transport (`FR:github-pr-status/board.*`, `FR:github-pr-status/write.*`), the queue store and its CLI (`FR:pr-priority/*`), the escalation set writer (the Sweep Manager).
- Never: merge, un-draft, close, or approve a PR. No UI control and no route does it. No AI call builds the page.

## Terms

- **Owner**: the signed-in GitHub user. Config `github.user` in `.xe/config/stack.json`. Without it, the host reads `GET /user` once (`FR:github-pr-status/board.user`). The token comes from `FR:pr-page/auth.token`.
- **Me**: a PR author, assignee, reviewer, or comment author that equals the owner (no case).
- **Human comment**: a comment by me that does not start with `🤖 [AI]` or `⚛️ [Catalyst]`. Agents post as the owner with that prefix.
- **Labels** (no case; emoji and variation selectors ignored, so `Status: Autopilot 🤖` is the Autopilot label too): Autopilot `Status: 🤖 Autopilot`; WIP `Status: 🚧 WIP`; Paused `Status: ⏸️ Paused`; Needs attention: any label that matches `needs:? attention`.
- **Sign-off thread**: an unresolved review thread where a human comment of mine asks to wait: it matches `hold`, `on hold`, `wait for`, `wait until`, `my ack`, `ack first`, `until I ack`, `don't merge`, or `do not merge` (no case; a bare `wait` is not one). A thread with an ack of mine (`FR:pr-page/data.report` `acks`, matched on the thread url or one of its comment urls) is also a sign-off thread. The UI calls it `Sign-off`. The UI never uses the words hold, held, escalate, escalation, or blocked.
- **Live PR**: the one PR that needs live validation. In order: the active PR of the live lane (`FR:pr-review-lane/lane.model`), else the first `liveValidation` entry of the escalation set, else the first row (board order) that is mine, not a draft, and needs live validation (`FR:pr-review-lane/flag.rule` on its labels, body, and changed paths). It must be a board row.
- **Active agent**: a `running` session in `GET /session-inventory` that links at least one PR whose state is not `MERGED` or `CLOSED`. On a host with no inventory, each board PR with the WIP label counts as one active agent. Choice: the inventory knows which session works which PR; a label is a weaker sign, so it is only the fallback.

## Scenarios

### FR:group: Groups

The owner needs each PR in exactly one group so that he knows who must act.

- **FR:group.@function** (P1): `groupOf(pr, ctx)` is pure. It returns one of `processing`, `waiting`, `pending`, `paused`, or `null` (not shown). The first rule that matches wins:
  1. A PR in config `github.exclude` (entries `owner/repo#n`, a PR url, or `#n` for any repo) is `null`
  2. Authored by me with the Paused label: `paused`
  3. Authored by me with the Autopilot label: `processing`
  4. Assigned to me with the Autopilot label: same as 3
  5. Not by me, not a draft, my latest review is not `APPROVED`, and review is requested from me or the repo is one of mine: `waiting`. My repos are `FR:pr-page/auth.repos`
  6. Authored by me with no Autopilot label: `pending`
  7. Else `null`
- **FR:group.bucket** (P1): `bucket` stays in the row data for agents (`approve` waiting, `review` pending and not a draft, `decide` or `unblock` for a state owner of me). The page does not show it; the card shows the next action (`FR:pr-page/card.action`)
- **FR:group.healthy** (P1): A processing row is healthy when its state owner is `none` or `ci` and it is not stalled. `healthy` stays in the row data. Every tab shows all its rows
- **FR:group.order** (P1): Rows sort by project: Allyte (FinOps hubs first), FTK, FOCUS, F4, Xerilium (Catalyst first), other. Then by queue rank (queued first, rank 1 first). Then oldest first. The project of a repo uses the session-inventory rules on the repo name, then the owner: `allytehq` Allyte, `Xerilium` Xerilium
- **FR:group.footer** (P2): The page footer shows `running n · waiting n · parked n`: active agents; rows whose state owner is me plus waiting and non-draft pending rows; paused rows plus my drafts

### FR:state: Who must act

The owner needs only his own gates marked as his so that waits on others never look like his.

- **FR:state.@function** (P1): `stateOf(pr, ctx)` is pure and returns `{owner, bucket?, blocker, link, stalled, source}`. `owner` is `me`, `reviewer` (with the login), `ci`, `runner`, or `none`. `source` is `report` or `rule`
- **FR:state.report** (P1): When the queue file has a `report` for the PR (`FR:pr-page/data.report`) and its `headSha` is absent or equals the PR head, the report wins: `owner` `michael` or the owner login maps to `me`; `ci`, `runner`, `none` map as is; any other login maps to `reviewer`. `blocker` is the report `blocker`, else `nextAction`
- **FR:state.rule** (P1): With no usable report, the first match wins. Michael-only gates (owner `me`):
  1. A Needs attention label: `🧭`, "Needs attention label"
  2. The newest comment or thread reply that holds `🧭` has no later human comment: `🧭`, its first line
  3. An unresolved thread whose last comment is a human comment with a Sign-off phrase (`Terms`): `🧭`, "Sign-off: " and the text
  4. A check run with conclusion `action_required`: `⛔`, "Approve the workflow run"

  Waits on others:
  5. A reviewer other than me whose latest review is `CHANGES_REQUESTED`, or a pending review request to a user other than me: `reviewer`, "Waiting on <login>"
  6. A check pending for more than 1 hour: `runner`, "Checks queued over 1 h"
  7. A failing required check, a merge conflict, or an unresolved thread whose last comment is not by me: when an active agent links the PR, `none`; else `none` with `stalled` true and "No agent: <signal>"
  8. A check pending: `ci`
  9. Else `none`
- **FR:state.bucket** (P1): For owner `me`, a blocker that names access, permission(s), approve or approval, secret(s), billing, deploy or deployment, prod or production, runner admin, or admin rights is `⛔ Unblock`; else `🧭 Decide`. Rules 2 and 3 use the same test on their text
- **FR:state.why** (P1): The rule is the fallback for `FR:pr-page/state.report`. Choice: the first ask listed failing checks, conflicts and bot threads as blocked. Agents fix those, so they are a stall (rule 7), not an owner gate. Change the rule in `src/core/pr-board.ts` only; its tests list each case
- **FR:state.view** (P1): The page does not show the state owner or the blocker on a card. The CLI shows them (`FR:pr-page/cli.prs`). `Also needs you` shows the blocker of a row whose state owner is me and that has no next action (`FR:pr-page/summary.missing`)

### FR:data: Data

The page needs one token-free shape so that the browser never holds a GitHub token.

- **FR:data.board** (P1): `GET /prs` returns `{at, user, agents: {count, source}, counts, footer, rows, summary, escalations?, queue, servers, rate?}`. `servers` is true when the host can start a test server (`FR:pr-page/server.host`). `summary` is `FR:pr-page/summary.@function`. `at` is the time of the last good poll. `source` is `sessions` or `wip-label`. `counts` holds each group. `queue` is true when the host can change the queue. `rate` is `{until}` while the poller backs off
- **FR:data.row** (P1): A row is `{url, repo, number, title, author, mine, project, group, draft, createdAt, updatedAt, ci, unresolved, labels, state, agent, after, rank, pinned, autopilot, nextAction, specLines, detail, rec?, server?}`. `server` is `FR:pr-page/server.view`, present only while the host holds a test server for the PR. `mine` is true when I am the author. `nextAction` is `FR:pr-page/card.action` or null. `specLines` is `FR:pr-review-lane/sort.lines` from the changed files, or null when not known. `detail` is `FR:pr-page/detail.data`. `ci` is `passing`, `failing`, `pending`, or `none`. `after` lists the PRs this one waits for. `rank` is the queue rank or null: the row keeps a fixed slot for it. `rec` is an open priority recommendation `{id, agent, reason, toRank?}`. Every url starts with `https://github.com/`
- **FR:data.after** (P2): `after` comes from the PR body: `depends on`, `after`, or `blocked by`, then `#n` or `owner/repo#n`. At most 3. It stays in the row data; the card does not show it
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

- **FR:live.poll** (P1): The host polls GitHub every 45 s (config 30-60 s) while a page holds a lease. `GET /prs` takes or renews a 3-minute lease. With no lease, the host does not poll. A board older than two intervals (a lapsed lease) polls before `GET /prs` answers. `GET /prs?refresh=1` polls before it answers (not during a back-off). Queue, ack, and decision writes change local files only and do not poll GitHub
- **FR:live.event** (P1): When a poll changes the board, the host sends `change` with kinds `["prs"]` on `/events`. The page does not reload while open: no timer, no reload on an event or on show. It loads the board when the page or the flyout opens, after each owner action on it, and when the owner taps Refresh. Signed out, it checks the sign-in every 15 s (`FR:pr-page/auth.state`). While a test server starts, it loads the board every 3 s (`FR:pr-page/server.poll`). Choice: a list that moves while the owner reads it loses his place
- **FR:live.backoff** (P1): A rate-limit answer (HTTP 403 or 429 with `x-ratelimit-remaining: 0` or `retry-after`, or GraphQL `RATE_LIMITED`) pauses polls until the reset time. Fewer than 100 GraphQL points left pauses until `resetAt`. Other errors back off 2x per failure, up to 15 minutes. The last good board stays
- **FR:live.age** (P1): The page shows `Updated 12 s ago`, from `at`, and ticks while open. When backing off, it shows `Paused until 2:15`. Next to it, one icon button `Refresh pull requests` runs `GET /prs?refresh=1`. It shows a busy state while it runs

### FR:icon: Top bar icon

The owner needs a glance count so that he knows agents are moving.

- **FR:icon.place** (P1): A PR icon sits in the app top bar: the rail brand row (desktop) and the phone top bar. It shows the active agent count when above 0. Its name is `Pull requests: n agents active`. While the first poll runs, it shows no count and its name is `Pull requests: loading`. Signed out, it shows no count and its name is `Pull requests: sign in to GitHub`
- **FR:icon.absent** (P1): The icon and the nav entry show while the first poll runs (no count). They are absent only where the host has no board at all: `GET /prs` answers `200` `{off: true}` (the Azure host with no token; no failing request in the console). A `404` from an older host also hides them. Signed out is not absent (`FR:pr-page/auth.state`)
- **FR:icon.open** (P1): Click or tap opens the flyout (full screen on a phone)
- **FR:icon.why** (P1): Choice: PR 145 hid the icon whenever `GET /prs` said `off`, and the host said `off` whenever `GITHUB_TOKEN` was not in its environment. A macOS app opened from the Dock gets no shell environment, so the installed app never had a token and never showed the icon. There was no nav entry either. The sign-in (`FR:pr-page/auth.*`) and the nav entry (`FR:pr-page/nav.*`) fix both

### FR:nav: Nav entry and page

The owner needs the PRs in the main nav so that he finds them without a hidden icon.

- **FR:nav.rail** (P1): The rail has `Pull requests` after `Notifications` (`FR:notifications/nav.rail`), chord `g r`. It opens the `#/prs` page
- **FR:nav.badge** (P1): The nav entry shows the count of rows with an actionable next action (`FR:pr-page/card.action`, `FR:pr-page/check.none`) when above 0, name `n need you`. Signed out, it shows a dot, name `Sign in to GitHub`
- **FR:nav.phone** (P1): The phone tab bar keeps its five slots. `More` (the command palette) lists `Go to Pull requests` with the same count. The top bar icon opens the flyout full screen
- **FR:nav.page** (P1): `#/prs` shows the flyout content as a page: the same tabs, cards, details, and sign-in state, with no scrim and no Close
- **FR:nav.load** (P1): The first open polls GitHub before it answers (`FR:pr-page/live.poll`). Until it answers, the page and the flyout show a skeleton (`aria-busy`), never a zero count
- **FR:nav.accent** (P1): The PR page and flyout MUST use only the app accent (`--accent`) as the action color: primary buttons, the selected tab, chips
  - **FR:nav.accent.contrast** (P1): Accent text on the PR page MUST meet WCAG AA (4.5:1) on its background, light and dark

### FR:flyout: Flyout

The owner needs the PR list one keystroke away on any screen so that he can act without leaving his work.

- **FR:flyout.shape** (P1): Desktop: a panel on the right, 480 px wide, over the page. Phone (below 720 px, the app phone layout): full screen. It is a dialog: focus moves in, `Escape` closes, focus returns to the icon
- **FR:flyout.tabs** (P1): Tabs, in order: `Summary` (the default), `Processing`, `Waiting on me`, `Pending`, `Paused`, `Pinned`. Each tab shows its count: Summary counts the PRs it lists; Pinned counts pinned rows; each other tab counts its group. Arrow keys move between tabs. The last tab is remembered
- **FR:flyout.filter** (P1): Project chips filter rows (multi-select; none selected shows all). The choice is remembered in local storage. Tab counts and the Summary follow the filter
  - **FR:flyout.filter.pills** (P1): The project chips MUST be the shared `FilterPills` (`FR:ui-kit/pills`), named `Filter by project`
  - **FR:flyout.filter.count** (P1): Each project chip MUST show the count of board rows in that project, for example `Allyte 4`. The count does not follow the tab or the chip selection, so the chip counts add up to the header total with no filter
- **FR:flyout.empty** (P2): An empty tab says so in one line, for example `No paused PR.`
- **FR:flyout.header** (P1): The header has only the title `Pull requests`, the age with Refresh (`FR:pr-page/live.age`), and Close (flyout only). There is no live check button, no multi-select, and no bulk action
  - **FR:flyout.header.total** (P1): With a board, the title MUST show the total in brackets, for example `Pull requests (12)`. The total is the count of board rows under the project filter: every PR the group tabs list, whatever tab is open. Pinned and Summary rows are already in that set. Before the board loads, the title has no count (`FR:pr-page/nav.load`)
- **FR:flyout.a11y** (P1): Axe finds no violation at 375 px and 1280 px, light and dark. Every target is at least 44 px on touch and 24 px on desktop. No sideways scroll

### FR:summary: Summary tab

The owner needs the few PRs that need him, in clear sections, so that he acts without a hunt.

- **FR:summary.@function** (P1): `summaryOf(rows, ctx)` is pure. It returns `{live, signoff, autopilot, missing}`. `live`, `signoff`, and `autopilot` are lists of row urls. `missing` is a list of `{url, reason}`. No PR is in two of `live`, `signoff`, `autopilot`, and the action lines of `missing`; the live check lines of `missing` name the Live PR
- **FR:summary.live** (P1): Section `Needs live validation`: exactly the Live PR (`Terms`), or none
  - The page lists it only when it is actionable (`FR:pr-page/check.none`)
- **FR:summary.signoff** (P1): Section `Needs your sign-off`: up to 3 rows whose next action is `signoff`, in board order
- **FR:summary.autopilot** (P1): Section `Ready for Autopilot`: up to 3 rows whose next action is `autopilot`. Fewest spec lines first; unknown spec lines last; then board order
- **FR:summary.missing** (P1): Section `Also needs you`: every other row that needs me, as one short line each (PR link, title, reason)
  - In order: rows with a next action that no section above lists (reason: the action word); rows whose state owner is me with no next action (reason: the state blocker, with the words of `Terms` Sign-off-thread replaced); one line per live checklist item of the Live PR in state `failed`, `needs-fix`, or `blocked` (reason: `Live check failed: <text>`)
  - The page shows the first 10 lines, then `n more in <tab names>` (the tabs that hold the rest)
  - When the list is empty, the page shows no section and no heading
  - A row that is not actionable (`FR:pr-page/check.none`) has no line
  - Choice: the old heading `Am I missing anything?` was a question with no answer when empty; the owner did not know what it was
- **FR:summary.layout** (P1): Each section has a heading and a clear gap from the next. An empty section of the first three says `None now.` The sections show cards (`FR:pr-page/card.*`); `Also needs you` shows lines

### FR:card: One PR card

The owner needs one card shape everywhere so that he reads each PR the same way, with one next action.

- **FR:card.fields** (P1): A card is the shared `SelectCard` (`FR:ui-kit/card`). It shows only: the repo, the PR number as a link to the PR (new tab), the title, the author (`My Autopilot` for my Autopilot PR, `You` for my other PRs, else the login), the next action flag (`FR:pr-page/card.flag`; none when null), the spec lines changed (small, muted; only when known), and the quick actions button (`FR:pr-page/menu.shape`). It has no other detail and no other control
- **FR:card.action** (P1): `nextActionOf(row, ctx)` is pure. The first match wins:
  1. `validate` (`Validate`): the row is the Live PR
  2. `signoff` (`Sign off`): the row has a sign-off thread
  3. `publish` (`Publish review`): I have a pending (not submitted) review on the PR with a body or at least one comment
  4. `approve` (`Approve`): the row is `waiting`, not a draft, CI is `passing` or `none`, no merge conflict, and my latest review is not `APPROVED`
  5. `autopilot` (`Enable Autopilot`): I am the author, no Autopilot label, no Paused label, not a draft, and either every thread is resolved or exactly one unresolved thread waits for me (its last comment is not a human comment of mine; an agent note under my login waits for me)
  6. Else null
- **FR:card.flag** (P1): The next action is the shared `Flag` (`FR:ui-kit/flag`), not a control: a small icon and the action word in muted text. No fill, no pill, no border, no hover state, and the default cursor. It is not focusable and has no role of a button. Choice: the owner read the old filled chip as a button
- **FR:card.color** (P1): Every card MUST have the neutral panel background and line border, light and dark. Choice: the owner read the full tinted fills as the loudest thing in the app
  - **FR:card.color.edge** (P1): A 3 px left edge in a muted tone MUST show the owner: my Autopilot PR, my other PR, or someone else's PR. The author text says the same, so the edge is never the only signal
  - **FR:card.color.strong** (P1): A card with a next action MUST be strong: elevation (`--fl-shadow4`) only, no fill
  - **FR:card.color.contrast** (P1): Text on every card MUST meet WCAG AA (4.5:1), light and dark
- **FR:card.phone** (P1): On a phone (under 720 px) the card tools (Pin, Actions, the drag handle) MUST sit in the top row, so the title spans the whole card except the shared chevron column (`FR:ui-kit/card.chev`)
- **FR:card.space** (P1): Cards have at least 12 px between them and 12 px padding inside
- **FR:card.select** (P1): A tap or click on the card selects it and shows its details (`FR:pr-page/detail.*`)
  - A tap or click on the PR link or a tool does not select the card
  - Enter or Space on the focused card does the same
  - The card ends in a chevron (`›`) in a strip as tall as the card (`FR:ui-kit/card.chev`)
  - The selected card shows a selected state (`aria-current`)

### FR:detail: Details pane

The owner needs the facts for the next action next to the list so that he acts without opening each PR first.

- **FR:detail.layout** (P1): On the page at 1100 px wide or more, the details show in a pane on the right of the list. Below 1100 px, and in the flyout, the details replace the list, with a `Back` button that returns to the list and the same card focus. With no card selected, the pane says `Select a PR to see its next step.`
- **FR:detail.data** (P1): The host builds `detail` with no AI call: `signoff` (each sign-off thread, oldest first: `{id, url, path?, ask: {author, body, url, at}, after: [{author, body, url, at}], commits: [{sha, title, url, at}]}`: `after` is the thread comments after my ask, `commits` the PR commits after it, newest 10), `review` (`{url, body, comments: [{path, body}]}` of my pending review), `steps` (`FR:pr-page/detail.validate`), `check` (`FR:pr-page/check.parse`), and `notes` (up to 5 human comments of mine on the PR, newest first, `{body, url, at}`). A field is present only when it has data
- **FR:detail.validate** (P1): `Validate` shows what to validate, the test server (`FR:pr-page/server.pane`), and numbered steps
  - With the PR in the live lane: the lane state, the server link when ready, each checklist item (`stack live checklist`) with its state, and a link to the checklist page (`#/live`, `FR:pr-review-lane/panel.view`) to tick items
  - Else the list items under the first PR body heading that contains `validat` (no case)
  - Else `No steps listed.` and a link to the PR
- **FR:detail.signoff** (P1): `Sign off` shows one sign-off thread at a time: the file path, my ask (full text), how it was addressed (the replies after my ask, then the commits after it, or `No reply or commit since your ask.`), and two actions: `Resolve thread` (`FR:pr-page/api.resolve`; a toast with Undo, which reopens it) and `Re-review` (opens the PR files on GitHub). With more than one thread, `Previous` and `Next` and `Thread n of m` move between them
- **FR:detail.approve** (P1): `Approve` shows a link to the PR files on GitHub. No approve control (`FR:pr-page/act.never`)
- **FR:detail.publish** (P1): `Publish review` shows a link to my pending review on GitHub. When it has at most 5 comments, each at most 300 characters, it lists them (path and text)
- **FR:detail.autopilot** (P1): `Enable Autopilot` shows the quick actions (`FR:pr-page/menu.detail`), which hold `Enable Autopilot`, and my earlier comments on the PR (`notes`), so I see why I did not enable it before. With none, it says `No earlier comments from you.`
- **FR:detail.none** (P2): A card with no next action shows a link to the PR and `Nothing for you now.`

### FR:menu: Quick actions

The owner needs the few routine moves for a PR one tap away so that he does not open GitHub or a terminal for them.

- **FR:menu.@function** (P1): `actionsOf(row, board)` is pure. It returns the actions that fit the row, in this order. Each comes from an existing label, route, or command; there are no others:
  1. `sweep` (`Sweep next`): `prs.queue` `add` when the row has no rank, else `top`. Shown when `queue` is true and the row is not already first in its part of the queue (rank 1 when pinned; the first rank after the pinned rows when not). Choice: the Sweep Manager works the queue from the top (`FR:pr-priority/sm.*`); no route starts a sweep
  2. `autopilot-on` (`Enable Autopilot`): `prs.label` `add`. Shown when the row is mine, has no Autopilot label, no Paused label, and is not a draft
  3. `autopilot-off` (`Remove Autopilot`): `prs.label` `remove`. Shown when the row has the Autopilot label and is mine or in `processing`
  4. `server-open` (`Open test server`): a link to the server URL, new tab. Shown when the server state is `running`
  5. `server-start` (`Start server`) or `server-stop` (`Stop server`): `prs.server`. Start shows when `servers` is true and the row has no server or a `failed` one; Stop shows when the row has a `starting` or `running` server
  6. `pin` (`Pin`) or `unpin` (`Unpin`): `prs.queue`. Shown when `queue` is true (`FR:pr-page/pin.toggle`)
  7. `open` (`Open on GitHub`): a link to the PR, new tab. Always shown
  8. `copy` (`Copy sweep command`): copies `/catalyst:pr-sweep <n> update` for my row, else `/catalyst:pr-sweep <n> review` (the Catalyst `pr-sweep` skill; run it in a checkout of the repo). Always shown

  No action sets `Status: ✅ Ready`: the Autopilot workflow sets and clears it (`.github/scripts/autopilot-core.cjs`), so a hand-set Ready does not last
- **FR:menu.shape** (P1): The shared `ActionMenu` (`FR:ui-kit/menu`). Each card ends its tools with one icon button `⋯` (name `Actions for <repo>#<n>`, `aria-haspopup="menu"`, `aria-expanded`). It opens a menu (`role=menu`) under the button, or above it when the screen bottom or the phone tab bar leaves no room, with one `menuitem` per action. Focus moves to the first item. ArrowUp and ArrowDown move, Home and End jump, Enter or Space runs, Escape or a tap outside closes and returns focus to the button. One menu is open at a time. The button is quiet: no fill until hover or open
- **FR:menu.detail** (P1): The shared `ActionBar` (`FR:ui-kit/bar`). The details pane ends with a `Quick actions` heading and the same actions as plain buttons and links, in the same order
- **FR:menu.run** (P1): A label change or a queue move runs, then shows a toast and reloads the board. `Enable Autopilot` and `Remove Autopilot` toasts have Undo (the other op). `Sweep next` says `<repo>#<n> is next for the Sweep Manager`. `Pin` and `Unpin` say `Pinned <repo>#<n>` and `Unpinned <repo>#<n>`. `Start server` says `Starting a test server for <repo>#<n>`; `Stop server` says `Stopped the test server for <repo>#<n>`. `Copy sweep command` says `Copied`; when the clipboard fails, it shows the command in the toast. A failure shows the host message. Only the owner sees the menu (`FR:pr-page/act.owner`)

### FR:check: Live check file

The owner needs the ask, the server command, and the steps for a PR in one place so that he validates it without a hunt.

- **FR:check.file** (P1): Sweepers write one file per PR: `<home>/pr/<owner>/<repo>/<number>.md` (`<home>` is `STACK_HOME` or `~/.stack`). The format is in `docs/pr-check.md`. The host reads it on each board build, read only. A path part that is not a GitHub name, or a file over 16 KB, is no file
- **FR:check.parse** (P1): `parseCheck(text)` is pure. It returns `{ask?, server?, steps, pass, fail, at?}` or null when it finds none of them. `- Ask:`, `- Server:` (backticks dropped), and `- As of:` lines; then list items under `## Steps`, `## Pass`, and `## Fail` (no case). At most 20 items a list, each cut to 200 characters. Any other line is ignored
- **FR:check.view** (P1): A PR with a check shows, at the top of its details: `Ask`, `Server` with the command in code and a `Copy` button (toast `Copied`), numbered `Steps`, `Pass` and `Fail` lists, and `As of <time>`. Empty parts do not show. The live lane checklist (`FR:pr-page/detail.validate`) still shows below it
- **FR:check.none** (P1): A row with next action `validate` is actionable with check steps, a test server, or `servers` true
  - `servers` true means the host can start a test server
  - Else it is not actionable: its card shows no flag, the Summary does not list it, its details heading says `No action`, and it does not count in the nav badge
  - The page never shows the words `Not actionable`
  - Choice: the owner must never see a PR he cannot act on; with `Start server` he can act on any live PR on his own machine

### FR:server: Test server

The owner needs the PR running on his machine in one tap so that he validates it without a terminal.

- **FR:server.host** (P1): Only the local host (`stack web`, the desktop app) starts servers
  - The Azure host has none: `servers` is false and `prs.server` answers `404`
  - A request from a paired device (tailnet) is not from this machine: it sees `servers` false and `prs.server` answers `403` `Start a test server on the computer that runs Stack`
- **FR:server.clone** (P1): The host finds the local clone of the repo: a folder `<root>/<repo name>` whose `origin` remote is `github.com/<owner>/<repo>` (no case)
  - `<root>` is each config `agents.scanRoots` entry, else `~/dev`
  - With no clone the start fails with `No local clone of <owner>/<repo>`
- **FR:server.checkout** (P1): The host fetches `pull/<n>/head` into the ref `refs/stack/pr-<n>` of the clone, then checks out that commit
  - The checkout is detached and forced, in the worktree `<clone>.worktrees/pr-<n>-live`
  - It makes the worktree when it is absent
  - All git calls use fixed args and no shell
- **FR:server.plan** (P1): `serverPlan(input)` is pure and returns `{setup, run, port}` or null
  - `run` is the `Server` line of the check file (`FR:pr-page/check.parse`) when present
  - Else it is the first `package.json` script of `web`, `dev`, `start`, `preview`, run with `--port <port>`
  - With neither, it returns null and the start fails with `No server command: add a Server line to the check file`
  - A `Server` line the parser cut (over 200 characters) never runs: the start answers `409` `The Server line is over 200 characters`
  - `setup` holds the install command when the package has dependencies, then the `build` script when present
  - The package manager comes from the lock file: pnpm, yarn, else npm
- **FR:server.port** (P1): The host picks a free port on `127.0.0.1`
  - A port in the run command (`--port 5180`, `--port=5180`, `-p 5180`, `PORT=5180`, `localhost:5180`) becomes the free port
  - The server process also gets `PORT` and `HOST=127.0.0.1`
- **FR:server.run** (P1): The host runs each setup command, then the run command, with `sh -c` in the worktree, in their own process group
  - The state is `starting` (step `checkout`, `build`, or `run`) until the port takes a connection on `127.0.0.1` or `::1`, then `running`
  - A command that exits, or a port that stays shut for 3 minutes, is `failed` with the last output line as the error
  - Choice: the check file is written by the owner's own agents under his home; the route is owner only and the host serves loopback, so the command has the owner's own rights
- **FR:server.env** (P1): The commands get the host environment without variables whose name holds `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `KEY`, `PRIVATE`, or `VAPID`
  - These variables are the host secrets
  - Choice: the install, build, and run scripts come from the PR; they must not read the GitHub token
- **FR:server.view** (P1): The view is `{state, step?, url?, error?, at}`
  - `url` is always `http://localhost:<port>`
  - No view holds the command output
- **FR:server.stop** (P1): Stop ends the process group (SIGTERM, then SIGKILL after 5 s) and drops the view
  - It returns at the latest 1 s after the SIGKILL
  - Stop needs no board row, so the server of a merged PR still stops
  - The worktree stays for the next start
  - The host stops every server when it exits
  - One server runs per PR; at most 3 run at one time
- **FR:server.pane** (P1): The details pane shows the shared `ServerStatus` (`FR:ui-kit/server`) for a row with next action `validate` or a server
  - With no server: `No test server runs.` and `Start server`
  - While it starts: the chip `Starting` with the step, and `Stop server`
  - When it runs: the chip `Running`, the link `Open localhost:<port>`, and `Stop server`
  - After a failure: the chip `Failed`, the error, and `Start server`
  - With `servers` false and no server it shows nothing
  - A Validate row whose live lane already has a server link shows only that link, until the owner starts a server from the menu
- **FR:server.poll** (P1): While a row has a `starting` server, the page loads the board every 3 s
  - It stops when no server starts

### FR:pin: Pin and the Pinned tab

The owner needs to pin PRs and set their order so that the Sweep Manager works them first, in his order.

- **FR:pin.toggle** (P1): The quick actions (`FR:pr-page/menu.@function`) hold `Pin`, or `Unpin` for a pinned PR
  - The card has no Pin button
  - Pin runs `prs.queue` `pin`; the host adds the PR to the queue first when it is not queued
  - Unpin runs `unpin`
  - Hidden when `queue` is false
- **FR:pin.tab** (P1): The Pinned tab lists pinned rows by queue rank. It is the only tab with an order control. Pinned items are the head of the `stack pr-pri` queue, so the pinned order is the queue order
- **FR:pin.drag** (P1): In the Pinned tab, each card has a drag handle (name `Reorder <repo>#<n>`). Drag the handle (mouse, pen, or touch) and drop on a place in the list. The drop runs `prs.queue` `move` with `rank` set to the new place (1 is first). There are no Up, Down, or Top buttons
- **FR:pin.keys** (P1): Keyboard: focus the handle, press Space or Enter to pick up, ArrowUp or ArrowDown to move, Space or Enter to drop, Escape to cancel. A live region says the place, for example `Xerilium/stack#12, place 2 of 4`

### FR:act: Actions

The owner needs only the actions that move a PR to its next step so that the page stays quiet.

- **FR:act.owner** (P1): Only the owner session sees or calls actions. A token gets `403`
- **FR:act.list** (P1): The page has only these actions:
  - Drag in Pinned (`FR:pr-page/pin.*`)
  - Start server and Stop server (`FR:pr-page/server.*`)
  - Resolve thread with Undo, and Re-review (`FR:pr-page/detail.signoff`)
  - The links of `FR:pr-page/detail.*`
  - The quick actions (`FR:pr-page/menu.*`)
  - Refresh
  - The project chips
  - Sign-in
  - The routes `prs.ack` and `prs.rec` stay for agents and other clients; the page has no control for them
- **FR:act.never** (P1): No control merges, un-drafts, closes, or approves a PR

### FR:api: API

The web page and agents need one owner-only route for the board so that every client shows the same state.

- **FR:api.get** (P1): `GET /prs` (route `prs.get`, scope `tasks:read`) returns the board to the owner only. `stack web` and the desktop app serve it with the token from `FR:pr-page/auth.token`, and answer `FR:pr-page/auth.state` without one. The Azure host serves it when `GITHUB_TOKEN` is set; it has no session inventory, so the WIP label counts agents. A host with no board returns `200` `{off: true}`. The query `refresh=1` polls GitHub first (`FR:pr-page/live.poll`); no other query is taken
- **FR:api.queue** (P1): `POST /prs/queue` (route `prs.queue`, scope `tasks:write`) takes `{repo, number, op, rank?}`. `op` is `top`, `up`, `down`, `move` (to `rank`), `add`, `pin`, `unpin`, `remove`, or `undo`. Returns `{rank, was, pinned}`. `pin` on a PR that is not queued adds it, then pins it
- **FR:api.label** (P1): `POST /prs/label` (route `prs.label`) takes `{repo, number, op}`, `op` `add` or `remove`. The label is always Autopilot; no other label can be set
- **FR:api.ack** (P1): `POST /prs/ack` (route `prs.ack`) takes `{repo, number, thread, note, post?, text?, replyTo?}` (`thread` is a GitHub url). `post` true also posts `text` (must start with `🤖 [AI] `) as a thread reply to `replyTo` (a review comment id), else as a PR comment. The post runs first; a failed post records nothing. After a post, a failed record answers `200` `{posted: true, recorded: false, message}`, so the page closes the sheet and never posts twice. With no post, a missing queue answers `409`. A thread link `#discussion_r<id>` gives `replyTo`
- **FR:api.rec** (P1): `POST /prs/recs/{id}` (route `prs.rec`) takes `{decision, rank?, note?, reason?}`: `accept` runs `accept <id>`, `edit` runs `edit <id> --reason [--rank] [--note]`, `reject` runs `reject <id> --reason`. Edit and Reject need a reason
- **FR:api.resolve** (P1): `POST /prs/resolve` (route `prs.resolve`, scope `tasks:write`) takes `{repo, number, thread, op}`. `thread` is a review thread node id from the row `detail.signoff`; `op` is `resolve` or `unresolve`. The thread must be a review thread of that PR on the board, else `404`. It calls `FR:github-pr-status/write.resolve`, drops the cached detail of that PR, then refreshes the board, so the next board shows the new thread state
- **FR:api.server** (P1): `POST /prs/server` (route `prs.server`, scope `tasks:write`, owner only) takes `{repo, number, op}`, `op` `start` or `stop`
  - For `start`, the PR must be on the owner board, else `403` (`FR:pr-page/api.repos`)
  - It returns `{server}`: the view of `FR:pr-page/server.view`, or null after a stop
  - A host that cannot start servers answers `404`
  - A fourth server at one time answers `409` `Stop a test server first: 3 run now`
- **FR:api.queue-client** (P1): The host changes the queue through `PrQueue`, which runs `stack pr-pri` (`FR:pr-priority/cli.*`): `move <ref> --to=top|up|down|n`, `add`, `pin`, `unpin`, `remove <ref>`, `undo`, `ack <ref> --thread=<url> --note=<t>`, `accept <id>`, `edit <id> --reason=<t> [--rank=n] [--note=t]`, `reject <id> --reason=<t>`. `--name=value` keeps a value that starts with `--` a value. `queue` on the board is true only when `pr-pri list --json` runs (checked at most every 10 minutes); `stack web` calls its own `PrPriorityStore` in-process with the same ops (no child process); the Azure host has no CLI and uses a queue that is never available. An unknown command answers `409` `PR priority queue is not installed`; a refused change answers `409` with the reason
- **FR:api.repos** (P1): Every GitHub write checks the repo against `STACK_GITHUB_REPOS` when set (`FR:github-pr-status/repos.allow`), and the PR must be on the owner board. Others get `403`

### FR:cli: CLI

The owner needs the board in a terminal so that he can check it without the web app.

- **FR:cli.prs** (P1): `stack prs [--group g] [--project p] [--json]` prints the counts, then one line per row: `<group> [<project>] <repo>#<n> <title> · <next action or owner>: <blocker> <url>`. `--project` takes a project or a repo. `--json` prints `{ok: true, ...board}`, with `nextAction`, `specLines`, `pinned`, and `summary`. The token comes from `FR:pr-page/auth.token`. With none, it exits `1` with `GitHub sign-in needed: run gh auth login or set GITHUB_TOKEN`. Never prints the token

## Data Model

- **FR:$row** (P1): **`PrRow`**, see `FR:pr-page/data.row`
- **FR:$board** (P1): **`PrBoard`**, see `FR:pr-page/data.board`

## Architecture Constraints

- The token stays on the host. No route returns it; no log line holds it.
- The rules (`groupOf`, `stateOf`, `bucketOf`, `nextActionOf`, `summaryOf`) are pure functions in `src/core/pr-board.ts`.
- All GitHub writes go through one module with an injected fetch (`FR:github-pr-status/write.*`).
- The flyout does not edit Now or Needs you beyond one import each.

## External Dependencies

- github-pr-status (board read, writes), session-inventory (active agents, project rules), pr-priority (queue file, reports, escalations, the `pr-pri` CLI), pr-review-lane (the live lane, the live rule, spec lines), web-shell (rail, live), cli, auth-security (scope table), `git` and the repo package manager on the local host (the test server).
