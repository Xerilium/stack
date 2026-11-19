---
id: priorities-tables
title: Priorities report
description: "The Now page shows the owner's priorities report: QM, Now, PRs, Today, Next 3 days. One row per project with its agent, the agent status and the owner's next action, read only from tasks/*.md. One PR table, verified live, sorted by time."
dependencies: [pri-first-ranking, pris-aware-ranking, session-inventory, pr-page, now-screen]
---

<!-- markdownlint-disable single-title -->

# Feature: Priorities report

## Purpose

The owner runs many projects at once. He needs one report that says, per project, which agent works it, what state the agent is in, and the one thing he does next. Each project owner writes its own tasks in `tasks/{project}.md`, tagged with a tier and `(agent: ...)`. Stack owns the report: it reads those tasks, orders them by the owner's day-aware priorities, and lists the PRs that need him. The report never writes tasks and never invents rows.

## Scope

- In: tier tags and agent tags in task files, the day order of rows, the QM section, project rows, the PR table, the freshness stamp, gap rows, the gap file for the CoS, `stack priorities`, `GET /priorities`, the report on the Now page.
- Out: the day slots (`FR:pri-first-ranking/day.*`), the PR next action (`FR:pr-page/card.action`), the session inventory (`FR:session-inventory/*`), task scoring. The asks stay in Notifications (`FR:ask-queue/web.*`).

## Scenarios

### FR:tasks: Read tiered tasks

Owner needs the report to use only what each project owner wrote so that no row comes from memory or old data.

- **FR:tasks.@function** (P1): Interface: `tieredTasks(path, src): TieredTask[]`, pure
- **FR:tasks.store** (P1): Report MUST read rows only from `tasks/*.md` (not `tasks/.stack/asks/`, not `tasks/.stack/agents/`), and MUST NOT write them.
- **FR:tasks.tier** (P1): A tiered task (@req FR:$tiered) is a line whose first token, after an optional `- `, `* ` or `- [ ] `, is `1️⃣` (today), `2️⃣` (this week) or `3️⃣` (this month).
  - **FR:tasks.tier.goal** (P1): Tiers are goals, not due dates: the report MUST NOT read a date as a tier.
  - **FR:tasks.tier.skip** (P1): Report MUST skip checked lines (`- [x]`), headings and lines with no tier.
- **FR:tasks.agent** (P1): Report MUST take the agent from the first `(agent: ...)`: the text up to the first `,`, `+`, `;` or `)`. A `+N` counts N more agents; else each more name after a `,` or `+` (before a `;`) counts one.
- **FR:tasks.status** (P1): Report MUST take the agent status from the line: `🤝` or the word `pairing` is Pairing; `🔄` is Working; `🚫` or `🔴` is Blocked; `⏸️` is Idle; `🕓` is Queued; `✅` is Done; else Unknown. A line with no agent has no status.
- **FR:tasks.text** (P1): Report MUST take the action from the line with the tier, the status glyphs and the `(agent: ...)` text removed.
- **FR:tasks.project** (P1): Report MUST name the project of a file by its `# ` title with leading emoji removed, and MUST use its `**Aliases:**` to link it.
- **FR:tasks.refs** (P1): Report MUST turn each PR or issue mention in the action (`#12`, `PR 12`, `PRs 12, 13`, `issue 12`) into a full markdown link to its GitHub URL, with the repo from the file's `**Repository:**`. Existing links and URLs MUST stay.
  - **FR:tasks.refs.gap** (P1): With no repo, each mention MUST end with the gap marker `⚠ no link`.

### FR:rows: Build the project rows

Owner needs one row per priority so that each project shows once with his next step.

- **FR:rows.@function** (P1): Interface: `prioritiesView(input): PrioritiesView`, pure
- **FR:rows.input** (P1):
  - Priorities (@req FR:session-inventory/$pri) — the owner's list from `pris.json`, in his priority order
  - Tiered tasks (@req FR:$tiered) — from every task file
  - Clock (Date) and time zone (string) — the injected `now` and the configured zone
  - Session inventory (@req FR:session-inventory/$session) — optional, with its `at`
  - PR board (@req FR:pr-page/$row) — optional rows with their next action and spec lines, and its `at`
- **FR:rows.status** (P1): Report MUST use only priorities with status `active` or `blocked`.
- **FR:rows.link** (P1): Report MUST link each tiered task to one priority with the priority linker (@req FR:pris-aware-ranking/link.best), with the file's project name and aliases.
- **FR:rows.pick** (P1): A project row MUST show the linked task with the lowest tier, then the first in file order.
- **FR:rows.project** (P1): Report MUST name the row with the priority `label`, else the title before the first `(`.
- **FR:rows.file** (P1): Each row MUST name its project task file: the file of its task, else the file whose name or alias matches the priority projects, label or title, else null.
- **FR:rows.cols** (P1): A project row (@req FR:$row) MUST have Project, Agent, Status and Next action.
  - **FR:rows.cols.action** (P1): The priority `action` MUST win over the task text (`work with FOCUS CoS`).
  - **FR:rows.cols.later** (P1): A task with tier `2️⃣` or `3️⃣` MUST start its action with `⏳ `.
  - **FR:rows.cols.more** (P1): A task with more than one agent MUST end its action with `+ N more`.
- **FR:rows.gap** (P1): A priority with no linked tiered task MUST show a gap row: no agent and no status. Report MUST NOT fill it from other data.
  - **FR:rows.gap.cos** (P1): A gap row MUST name the Chief of Staff (CoS) who must act: the priority `cos`, else `CoS`, linked as an agent (@req FR:agent.link).
  - **FR:rows.gap.by** (P1): A gap row MUST say by when: `today`, else `by` and the start of the row (`by 3 PM`, `by Thu 3 PM`).
  - **FR:rows.gap.action** (P1): The gap action MUST say who will act, by when and what the owner can expect: `<CoS> will add a task <by when>: 1️⃣/2️⃣/3️⃣ in <project file> with (agent: ...)`
    - **FR:rows.gap.action.file** (P1): With no project file, the gap action MUST name `tasks/<project>.md`
  - **FR:rows.gap.silent** (P1): A gap row MUST NOT carry text to send
    - **FR:rows.gap.silent.send** (P1): Report MUST NOT send a message for a gap
- **FR:rows.words** (P1): Report MUST keep each cell at most 20 words and end a cut cell with `…`.

### FR:qm: Show QM first

Owner needs QM in its own section on QM days so that he sees each project's QM step in one place.

- **FR:qm.pri** (P1): A priority with `perProject: true` (QM) MUST get its own section, titled with its project name, first in the report.
- **FR:qm.link** (P1): A task that matches the terms of a `perProject` priority MUST link to it before the other priorities.
- **FR:qm.rows** (P1): The section MUST show one row per project file with a linked task, in file name order, named by the file's project.
- **FR:qm.off** (P1): When the day order leaves the priority out today, or all its windows today have ended, the section MUST show one row with the action `Not a priority today` (not a gap).
- **FR:qm.later** (P1): When it opens later today, each action MUST start with its start time (`3 PM: `).
- **FR:qm.today** (P1): The section MUST say whether QM is a priority today.

### FR:order: Order the sections by day and time

Owner needs the sections to follow his day so that each hour shows only work he can do then.

- **FR:order.day** (P1): Report MUST order the rows by the day order of the priorities (@req FR:pri-first-ranking/day.slot).
- **FR:order.window** (P1): Window (@req FR:$window) — a priority with `windows` is open only inside one of them; one with none is open all day.
  - **FR:order.window.day** (P1): Report MUST match a window with no `days` on every weekday.
  - **FR:order.window.edge** (P1): Report MUST treat `from` as inside the window and `to` as outside it.
- **FR:order.now** (P1): Report MUST put the first 3 open priorities in Now.
- **FR:order.today** (P1): Report MUST put every other priority that is open now or later today in Today.
  - **FR:order.today.later** (P1): Report MUST start the action of a priority that opens later today with its start time (`3 PM: `).
  - **FR:order.today.past** (P1): Report MUST leave out a priority whose windows today have all ended.
- **FR:order.next** (P1): Report MUST put each priority that is not in Now or Today and is open on one of the next 3 days in Next 3 days, once.
  - **FR:order.next.when** (P1): Report MUST start its action with the weekday, and the start time when its window has one (`Thu 3 PM: `).
  - **FR:order.next.sort** (P1): Report MUST sort those rows by the first day, then by the day order of that day.

### FR:agent: Link the agent

Owner needs each agent one tap away so that he can talk to it.

- **FR:agent.link** (P1): Report MUST link the agent to the inventory session whose title matches the agent name (case, emoji and punctuation ignored), else to the session in the priority `session`.
- **FR:agent.file** (P1): With no session, Report MUST name the agent file (`tasks/.stack/agents/<slug>.md` or `.claude/agents/<slug>.md`) whose slug matches the agent name.
- **FR:agent.plain** (P1): Report MUST show the agent name with no link when no session matches.
- **FR:agent.session** (P1): With a session, Report MUST give the id that `POST /sessions/{id}/prompt` takes (@req FR:agent-sessions/run.prompt): the inventory `cli` id (@req FR:session-inventory/needs.item) when it is a UUID, else null.

### FR:pr: List the PRs that need the owner

Owner needs one PR table, quickest first, so that he clears PRs in short gaps.

- **FR:pr.live** (P1): Report MUST list only rows of the live PR board (open PRs from GitHub) whose next action is not null (@req FR:pr-page/card.action).
  - **FR:pr.live.none** (P1): With no good board poll, the table MUST show one row `Not verified live` and no PRs.
- **FR:pr.cols** (P1): A PR row (@req FR:$pr) MUST have PR (repo emoji, then the number as a link), Agent, Next action and Time.
  - **FR:pr.cols.action** (P1): Next action MUST be `Autopilot: promote`, `Live: validate`, `Thread: sign off`, `Approve` or `Publish review`.
  - **FR:pr.cols.time** (P1): Time MUST be the minutes the owner needs: 5 for promote, approve and sign off, 10 for publish review, 15 for live validate, plus 1 for each 20 changed spec lines.
  - **FR:pr.cols.agent** (P1): Agent MUST be the session of the priority the PR links to, else the agent of that priority's project row, else `--`.
  - **FR:pr.cols.emoji** (P1): Repo emoji MUST come from the repo name: 🏦 finops-hubs, 🧰 finops-toolkit, 👓 FOCUS_Spec, 🎧 f4-music, 🖨️ printer, 🥞 stack, ⚛️ catalyst, 🌐 allyte-web, 🏭 prime; else none.
  - **FR:pr.cols.pri** (P1): A PR row MUST name the priority the PR links to (`pri`: its id, or null), so that Settings can list the PRs of a priority (`FR:pris-sessions-ui/pris.context`).
  - **FR:pr.cols.live** (P1): A live validate row MUST link the test server and the details (agent thread or comment): `Live: [server](url), [details](url)`.
- **FR:pr.order** (P1): Report MUST sort PR rows by Time, then the board order.
- **FR:pr.manager** (P1): Report MUST link the Sweep Manager session (title contains `Sweep Manager`) above the PR table, when the inventory has one.

### FR:fresh: Stamp the report

Owner needs to see how old each section is so that he never acts on stale data.

- **FR:fresh.row** (P1): Report MUST stamp each project row with the oldest live check it used: the clock for task files, and the inventory `at` when it links an agent.
- **FR:fresh.table** (P1): Report MUST stamp each section with its oldest row, and an empty section with the clock. The PR section MUST use the board `at`.
- **FR:fresh.stale** (P1): Report MUST mark a row or section stale when its stamp is more than 30 minutes before the clock.

### FR:cli: Read the report in the CLI

Agents need the same rows in JSON so that they report the owner's priorities without the web.

- **FR:cli.@cli** (P1): Interface: `stack priorities [--json]`
- **FR:cli.read** (P1): CLI MUST read the priorities, the task files, the session inventory and the PR board live, then build the report.
  - **FR:cli.read.board** (P2): CLI MUST build the report with no board when there is no GitHub sign-in.
- **FR:cli.text** (P1): CLI MUST print each section as `---`, then `## <Section> (as of <time>[, stale])`, then a markdown table with the section columns. Session links MUST use the `#<session-id>` form.
- **FR:cli.links** (P1): CLI MUST link the project to its task file and the agent to its session, else its agent file; with neither, it MUST print the gap marker `⚠ no link`.
- **FR:cli.json** (P1): CLI MUST print the report (@req FR:$view) with `--json`.

### FR:api: Serve the report

- **FR:api.@api** (P1): Interface: `GET /priorities` (owner only)
- **FR:api.read** (P1): API MUST build the report from its priority store, task storage, inventory and PR board.
  - **FR:api.read.none** (P1): API MUST answer 404 when the host has no priority store.

### FR:gaps: Give the gaps to the CoS

CoS needs the gap list in a file so that it adds the tasks with no message from the owner.

- **FR:gaps.@function** (P1): Interface: `gapsOf(view): Gap[]`, pure, and `writeGaps(dir, view): boolean`
- **FR:gaps.list** (P1): The gap list MUST have one entry per gap row, in section order
  - Sections in order: QM, Now, Today, Next 3 days
  - Entry: `{ id, project, file, cos, section, action }`
- **FR:gaps.file** (P1): Each build of the report (`GET /priorities`, `stack priorities`) MUST write the list atomically to `gaps.json` in the priority store folder
  - Path: `~/.stack/gaps.json`. Content: `{ version: 1, at, gaps }`
  - **FR:gaps.file.change** (P2): The file MUST be written only when the list changes
    - `at` is when the list last changed
  - **FR:gaps.file.safe** (P1): A failed write MUST NOT fail the report.
- **FR:gaps.silent** (P1): Stack MUST NOT send a message to any session or agent for a gap.

### FR:web: Show the report on Now

Owner needs the report on the Now page so that he sees it without a new screen.

- **FR:web.place** (P1): Now MUST show the report in place of the Waiting on you block, with no new nav item, rail item or card.
- **FR:web.tabs** (P1): Now MUST show the sections as tabs, one table at a time, in this order: QM (when the list has one), **Now**, **PRs**, **Today**, **Next 3 days**.
  - **FR:web.tabs.count** (P1): Each tab title MUST end with its count of real rows (`Now (3)`). Gap rows MUST NOT count.
  - **FR:web.tabs.default** (P1): The first tab shown MUST be QM when QM is a priority today, else Now.
  - **FR:web.tabs.hash** (P1): The chosen tab MUST be kept in the URL hash (`#/now?pri=prs`) and restored on load.
  - **FR:web.tabs.keys** (P1): Tabs MUST follow the ARIA tabs pattern: arrow keys, Home and End move between tabs.
  - **FR:web.tabs.head** (P1): The stamp `as of <time>` (`, stale` when stale) of the chosen tab MUST sit small at the right end of the tab bar with 12 px of space after it, and the bar MUST stay in view on scroll, with the time in the report's configured time zone.
- **FR:web.kit** (P1): The report MUST be built from the shared components (`FR:ui-kit`, `web/src/ui/`: `Tabs`, `SelectCard`, `StatusChip`, `SplitView`, `MessageBox`, `useWide`), which the PR page also uses (`.xe/standards/ui.md`).
- **FR:web.table** (P1): Each row MUST be a muted card: project and status on line 1, next action on line 2, agent on line 3. A PR card MUST show PR and Time on line 1, the next action on line 2 and the agent on line 3.
  - **FR:web.table.line** (P1): Each line MUST show one line and end a cut line with `…`.
  - **FR:web.status.chip** (P1): Status MUST be a `StatusChip` (`FR:ui-kit/chip`: a dot and one word on a tint); a row with no agent MUST show no chip.
  - **FR:web.card.agent** (P1): The card MUST show the agent name as plain text, with no added emoji and no link.
  - **FR:web.card.project** (P1): The card MUST show the project as plain text.
  - **FR:web.card.open** (P1): The whole card MUST open its detail (one target, ending in `›`, `FR:ui-kit/card.chev`); links on the card MUST stay links.
- **FR:web.message** (P1): The detail pane of a row with an agent MUST show a `Message agent` box (`MessageBox`, `FR:ui-kit/message`) that sends the text to the agent session (@req FR:agent-sessions/run.prompt).
  - **FR:web.message.off** (P1): With no session id, the box MUST be off and say `No live session for this agent`.
  - **FR:web.message.result** (P1): The box MUST say `Sent to <agent>` after a send, else the error, and keep the text on an error.
- **FR:web.gap** (P1): The detail pane of a gap row MUST say `<CoS> will add a task. No action for you.`
  - **FR:web.gap.nobox** (P1): The detail pane of a gap row MUST show no text box and no button
- **FR:web.detail** (P1): The detail pane MUST show the project (linked), status chip, full next action (linked refs), agent (linked) with `+ N more on this goal`, source `path:line` and the stamp. Wide (900 px or more) it MUST sit beside the list; narrow it MUST replace the list, with Back.
  - **FR:web.table.gap** (P1): A gap row MUST show its action in muted text.
  - **FR:web.table.empty** (P1): An empty tab MUST show one card `Nothing here`.
- **FR:web.links** (P1): Every row MUST link its targets.
  - **FR:web.links.project** (P1): In the detail pane, the project MUST link to its project page (`#/list?project=<file>`).
  - **FR:web.links.agent** (P1): In the detail pane, the agent MUST link to its session, else to its agent file in the Agents view.
  - **FR:web.links.refs** (P1): Each PR, issue and URL in the action MUST be a link; no bare `#12` or `PR 12` MUST show.
  - **FR:web.links.gap** (P1): In the detail pane, a project or agent with no link target MUST show the gap marker `⚠ no link`.
  - **FR:web.links.none** (P1): `--` MUST be plain text.
- **FR:web.live** (P1): Now MUST read `GET /priorities` on load, on each live change and every 60 s while visible.
  - **FR:web.live.absent** (P2): Now MUST hide the report when `GET /priorities` answers 404.

### NFR:a11y: Design and access

- **NFR:a11y.tokens** (P1): The report MUST use the Fluent 2 tokens (`docs/design-system.md`) in light and dark.
- **NFR:a11y.keys** (P1): Each tab, link and detail toggle MUST work by keyboard with a visible focus ring.
- **NFR:a11y.target** (P1): Each tab and detail toggle MUST be at least 44 px tall on touch.
- **NFR:a11y.mobile** (P1): The cards MUST be the same at every width; at 375 px the tab list MUST scroll inside its own box and the page MUST NOT scroll sideways.
- **NFR:a11y.color** (P1): The report MUST use neutral surfaces and one accent (brand: links, the chosen tab, focus). Status MUST be text and icon, with no fills.
- **NFR:a11y.axe** (P1): Now with the report MUST have no axe violations (WCAG 2.2 AA) at 375 px and 1280 px.

## Data Model

- **FR:$window** (P1): **`PriWindow`** — `days` (optional list of `mon`..`sun`), `from` and `to` (optional `HH:MM`, local time). A `pris.json` priority gets `windows` (optional, at most 7), `label` (optional, at most 40 characters), `cos` (optional CoS name, at most 40 characters), `action` (optional, at most 200 characters), `session` (optional session id) and `perProject` (optional boolean).
- **FR:$tiered** (P1): **`TieredTask`** — `path`, `line` (0-based), `project`, `aliases`, `tier` (1, 2 or 3), `text`, `agent` (string or null), `more` (count of more agents), `status` (`working`, `pairing`, `done`, `idle`, `blocked`, `queued`, `unknown`, or null with no agent), `repo` (`owner/repo` or null).
- **FR:$row** (P1): **`PriRow`** — `id`, `project`, `file` (project task file or null), `agent` (`{ name, link, file, session }`: session link or null, agent file or null, session id to prompt or null; or null), `status` (as in `TieredTask`), `action`, `gap` (boolean), `cos` (the CoS as an agent; null unless a gap row), `request` (the text for the CoS; null unless a gap row), `ref` (`path:line` or null), `at`, `stale`.
- **FR:$pr** (P1): **`PrRow`** — `emoji`, `number`, `url`, `agent` (as in `PriRow`), `pri` (priority id or null), `action`, `minutes`, `server` and `details` (links, null unless a live row).
- **FR:$view** (P1): **`PrioritiesView`** — `at` (the clock), `timeZone` (optional IANA zone), `qm` (a `PriTable` with `title` and `today`, or null), `now`, `today`, `next` (each a `PriTable`: `at`, `stale`, `rows`) and `prs` (a `PrTable`: `at`, `stale`, `verified`, `manager`, `rows`).

## Architecture Constraints

- `tasks/*.md` is the only task store. The report only reads it.
- Windows, labels, CoS names, fixed actions, sessions and `perProject` live in `pris.json`, never in code.
- The web sends messages only through `POST /sessions/{id}/prompt`. The report adds no send route.
- The report is a pure function of its inputs. The CLI and the API share it.
- The web reads only `GET /priorities`.

## External Dependencies

None
