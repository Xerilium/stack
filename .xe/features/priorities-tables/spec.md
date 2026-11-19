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

- In: tier tags and agent tags in task files, the day order of rows, the QM section, project rows, the PR table, the freshness stamp, gap rows, `stack priorities`, `GET /priorities`, the report on the Now page.
- Out: the day slots (`FR:pri-first-ranking/day.*`), the PR next action (`FR:pr-page/card.action`), the session inventory (`FR:session-inventory/*`), task scoring. The asks stay in Needs you (`FR:ask-queue/web.*`).

## Scenarios

### FR:tasks: Read tiered tasks

Owner needs the report to use only what each project owner wrote so that no row comes from memory or old data.

- **FR:tasks.@function** (P1): Interface: `tieredTasks(path, src): TieredTask[]`, pure
- **FR:tasks.store** (P1): Report MUST read rows only from `tasks/*.md` (not `tasks/asks/`, not `tasks/agents/`), and MUST NOT write them.
- **FR:tasks.tier** (P1): A tiered task (@req FR:$tiered) is a line whose first token, after an optional `- `, `* ` or `- [ ] `, is `1️⃣` (today), `2️⃣` (this week) or `3️⃣` (this month).
  - **FR:tasks.tier.goal** (P1): Tiers are goals, not due dates: the report MUST NOT read a date as a tier.
  - **FR:tasks.tier.skip** (P1): Report MUST skip checked lines (`- [x]`), headings and lines with no tier.
- **FR:tasks.agent** (P1): Report MUST take the agent from the first `(agent: ...)`: the text up to the first `,`, `;` or `)`. Each more name after a `+` or `,` counts as one more agent.
- **FR:tasks.status** (P1): Report MUST take the agent status from the line: `🤝` or the word `pairing` is Pairing; `🔄` is Working; `🚫` or `🔴` is Blocked; `⏸️` is Idle; `🕓` is Queued; `✅` is Done; else Unknown. A line with no agent has no status.
- **FR:tasks.text** (P1): Report MUST take the action from the line with the tier, the status glyphs and the `(agent: ...)` text removed.
- **FR:tasks.project** (P1): Report MUST name the project of a file by its `# ` title with leading emoji removed, and MUST use its `**Aliases:**` to link it.

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
- **FR:rows.cols** (P1): A project row (@req FR:$row) MUST have Project, Agent, Status and Next action.
  - **FR:rows.cols.action** (P1): The priority `action` MUST win over the task text (`work with FOCUS CoS`).
  - **FR:rows.cols.later** (P1): A task with tier `2️⃣` or `3️⃣` MUST start its action with `⏳ `.
  - **FR:rows.cols.more** (P1): A task with more than one agent MUST end its action with `+ N more`.
- **FR:rows.gap** (P1): A priority with no linked tiered task MUST show a gap row: no agent, no status, and the action `No tiered task in tasks/`. Report MUST NOT fill it from other data.
- **FR:rows.words** (P1): Report MUST keep each cell at most 20 words and end a cut cell with `…`.

### FR:qm: Show QM first

Owner needs QM in its own section on QM days so that he sees each project's QM step in one place.

- **FR:qm.pri** (P1): A priority with `perProject: true` (QM) MUST get its own section, titled with its project name, first in the report.
- **FR:qm.link** (P1): A task that matches the terms of a `perProject` priority MUST link to it before the other priorities.
- **FR:qm.rows** (P1): The section MUST show one row per project file with a linked task, in file name order, named by the file's project.
- **FR:qm.off** (P1): When the day order leaves the priority out today, or all its windows today have ended, the section MUST show one row with the action `Not a priority today`.
- **FR:qm.later** (P1): When it opens later today, each action MUST start with its start time (`3 PM: `).

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
- **FR:agent.plain** (P1): Report MUST show the agent name with no link when no session matches.

### FR:pr: List the PRs that need the owner

Owner needs one PR table, quickest first, so that he clears PRs in short gaps.

- **FR:pr.live** (P1): Report MUST list only rows of the live PR board (open PRs from GitHub) whose next action is not null (@req FR:pr-page/card.action).
  - **FR:pr.live.none** (P1): With no good board poll, the table MUST show one row `Not verified live` and no PRs.
- **FR:pr.cols** (P1): A PR row (@req FR:$pr) MUST have PR (repo emoji, then the number as a link), Agent, Next action and Time.
  - **FR:pr.cols.action** (P1): Next action MUST be `Autopilot: promote`, `Live: validate`, `Thread: sign off`, `Approve` or `Publish review`.
  - **FR:pr.cols.time** (P1): Time MUST be the minutes the owner needs: 5 for promote, approve and sign off, 10 for publish review, 15 for live validate, plus 1 for each 20 changed spec lines.
  - **FR:pr.cols.agent** (P1): Agent MUST be the agent of the priority the PR links to, else `--`.
  - **FR:pr.cols.emoji** (P1): Repo emoji MUST come from the repo name: 🏦 finops-hubs, 🧰 finops-toolkit, 👓 FOCUS_Spec, 🎧 f4-music, 🖨️ printer, 🥞 stack, ⚛️ catalyst, 🌐 allyte-web, 🏭 prime; else none.
- **FR:pr.order** (P1): Report MUST sort PR rows by Time, then the board order.

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
- **FR:cli.text** (P1): CLI MUST print each section as `---`, then `## <Section> (as of <time>[, stale])`, then a markdown table with the section columns.
- **FR:cli.json** (P1): CLI MUST print the report (@req FR:$view) with `--json`.

### FR:api: Serve the report

- **FR:api.@api** (P1): Interface: `GET /priorities` (owner only)
- **FR:api.read** (P1): API MUST build the report from its priority store, task storage, inventory and PR board.
  - **FR:api.read.none** (P1): API MUST answer 404 when the host has no priority store.

### FR:web: Show the report on Now

Owner needs the report on the Now page so that he sees it without a new screen.

- **FR:web.place** (P1): Now MUST show the report in place of the Waiting on you block, with no new nav item, rail item or card.
- **FR:web.sections** (P1): Now MUST show the sections in this order: QM (when the list has one), **Now**, **PRs**, **Today**, **Next 3 days**.
  - **FR:web.sections.head** (P1): Each section MUST start with a rule (`hr`), then an `h2` and its stamp `as of <time>` (`, stale` when stale).
  - **FR:web.sections.cols** (P1): Project sections MUST have the columns **Project**, **Agent**, **🤖 Status**, **👱‍♂️ Next action**; the PR section **PR**, **Agent**, **👱‍♂️ Next action**, **Time**.
  - **FR:web.sections.gap** (P1): A gap row MUST show its action in muted text with the word `Gap:` first.
  - **FR:web.sections.empty** (P1): An empty section MUST show one row `Nothing here`.
- **FR:web.links** (P1): Each linked agent and each PR number MUST be a link; `--` MUST be plain text.
- **FR:web.live** (P1): Now MUST read `GET /priorities` on load, on each live change and every 60 s while visible.
  - **FR:web.live.absent** (P2): Now MUST hide the report when `GET /priorities` answers 404.

### NFR:a11y: Design and access

- **NFR:a11y.tokens** (P1): The report MUST use the Fluent 2 tokens (`docs/design-system.md`) in light and dark.
- **NFR:a11y.keys** (P1): Each link MUST work by keyboard with a visible focus ring.
- **NFR:a11y.mobile** (P1): Below 600 px each row MUST show as a block (project and status on line 1, next action on line 2, agent on line 3); the page MUST NOT scroll sideways.
- **NFR:a11y.axe** (P1): Now with the report MUST have no axe violations (WCAG 2.2 AA) at 375 px and 1280 px.

## Data Model

- **FR:$window** (P1): **`PriWindow`** — `days` (optional list of `mon`..`sun`), `from` and `to` (optional `HH:MM`, local time). A `pris.json` priority gets `windows` (optional, at most 7), `label` (optional, at most 40 characters), `action` (optional, at most 200 characters), `session` (optional session id) and `perProject` (optional boolean).
- **FR:$tiered** (P1): **`TieredTask`** — `path`, `line` (0-based), `project`, `aliases`, `tier` (1, 2 or 3), `text`, `agent` (string or null), `more` (count of more agents), `status` (`working`, `pairing`, `done`, `idle`, `blocked`, `queued`, `unknown`, or null with no agent).
- **FR:$row** (P1): **`PriRow`** — `id`, `project`, `agent` (`{ name, link }`, link null when unlinked, or null), `status` (as in `TieredTask`), `action`, `gap` (boolean), `ref` (`path:line` or null), `at`, `stale`.
- **FR:$pr** (P1): **`PrRow`** — `emoji`, `number`, `url`, `agent` (as in `PriRow`), `action`, `minutes`.
- **FR:$view** (P1): **`PrioritiesView`** — `at` (the clock), `qm` (a `PriTable` with `title`, or null), `now`, `today`, `next` (each a `PriTable`: `at`, `stale`, `rows`) and `prs` (a `PrTable`: `at`, `stale`, `verified`, `rows`).

## Architecture Constraints

- `tasks/*.md` is the only task store. The report only reads it.
- Windows, labels, fixed actions, sessions and `perProject` live in `pris.json`, never in code.
- The report is a pure function of its inputs. The CLI and the API share it.
- The web reads only `GET /priorities`.

## External Dependencies

None
