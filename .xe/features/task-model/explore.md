# Explore: Task model for one human and many agents

Research and design brief. No code. No store pick. Input for `task-store` ([180](https://github.com/Xerilium/stack/pull/180)), `product-reset` ([159](https://github.com/Xerilium/stack/pull/159)) and issues [152](https://github.com/Xerilium/stack/issues/152), [171](https://github.com/Xerilium/stack/issues/171).

## TL;DR

- The owner needs one answer: the next action. Big lists fail him. The model must make a big list impossible, not only hidden.
- Three decisions:
  1. **Fixed shape**: Area > Project > Task > Step. Max depth 2 under a project. Only a leaf task can be "next". Deeper trees become a new project.
  2. **Inbox is not the task list**: email, PRs, calendar and agents write inbox items. Nothing becomes a task until it passes clarify (one action, done-when, link, owner).
  3. **Day plan is the only "history"**: one row per day holds the plan and done-today per project. It is deleted after the next day closes. Done tasks are deleted.
- Store: the data is tiny (~1,100 rows). The hard need is many writers while the Mac is off. That argues against Mac-hosted SQLite as the only writer. Evidence does not pick between Azure SQL and Cosmos DB.

## 1. Evidence from the owner's data

Sample: `~/dev/todo/tasks/*.md`, 2026-11-17, read-only.

| Measure                                                 | Value                                                              | Meaning                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Open rows                                               | 1,094                                                              | Too many to scan. Choice cost is high.         |
| Depth 0 / 1 / 2 / 3+                                    | 299 / 512 / 127 / 156                                              | 26% of rows are 2+ levels deep.                |
| Top-level rows in "Active" (12 projects)                | 83                                                                 | "Active" is not a short list. It is a backlog. |
| Done rows still in files (`- [x]`)                      | 107                                                                | History leaks into the live list.              |
| Open rows with a date / overdue on 2026-11-17           | 34 / 18 (53%)                                                      | Dates go stale and stop meaning "must".        |
| Open rows marked blocked, waiting or paused (`⛔ ⏳ ⏸`) | 146 (13%)                                                          | Waiting work sits in the same list as do-work. |
| Open rows longer than 200 characters                    | 33                                                                 | Status logs live in titles.                    |
| Rows with typed context (`Next:`, `Owner:`)             | 1 (0.1%) ([159](https://github.com/Xerilium/stack/pull/159) audit) | Most rows are not actionable as written.       |
| Rows marked agent / human                               | 62 / 14                                                            | Owner is unknown for 93% of rows.              |

Patterns seen in the files:

- A parent row is a project in disguise (`🎯 Christmas After Dark`, `Azure MVP onboarding`). Its children are a mix of actions, done steps and notes.
- Agent check logs live as `>` quotes under a task (Open Sky editorial checks: 4 dated logs). This is history, not a task.
- PR lists live as child rows (`FH PR quality follow-ups`: 7 PR rows). The PR system is the source of truth. The rows copy it and go stale.
- Day-aware priorities live in prose (`.stack/daily-pris.md`), with corrections that replace older lists in the same file.

## 2. Principles, ranked

| #   | Principle                                                                                         | Evidence                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Show one next action, not a list.** The default view is 1 item, with at most 3 more on demand.  | Owner fact: he only cares about "what is next". Choice overload is real in some settings, but contested [R12]. Scanning a long list to pick has a cost on its own [R12]. Design for the strong owner fact, not the weak study. |
| 2   | **A task is one concrete action.** Verb first, done-when, link, place.                            | GTD clarify asks "what is the next action?" [R1]. A specific plan cuts intrusive thoughts from open goals [R11]. Owner fact: tasks must be actionable. 0.1% are today.                                                         |
| 3   | **Capture is not commitment.** Inbox items stay out of the list until clarified.                  | GTD splits capture from clarify and organize [R1]. HEY and Linear keep triage apart from work [R9][R10]. Owner data: PR rows copied into tasks go stale.                                                                       |
| 4   | **Hide what cannot be done now.** Deferred, waiting and blocked items leave the next-action pool. | Things hides items until the start date [R2]. OmniFocus defer makes items unavailable [R3]. Org stuck-project and WAITING states [R6]. Owner data: 13% of rows are waiting but still listed.                                   |
| 5   | **Separate three dates.** Deadline (must), planned (intend), available-from (defer).              | OmniFocus added Planned because users kept moving due dates [R3]. Todoist added Deadlines because due acted as "do" [R4]. Owner data: 53% of dates are overdue.                                                                |
| 6   | **Fixed, shallow structure.** Containers have fixed meaning; depth is capped.                     | Things: area > project > heading > to-do > checklist, fixed [R2][R13]. Todoist caps sub-tasks at 4 levels [R5]. Owner fact: every open-text list becomes deep nests and fails.                                                 |
| 7   | **Stale work must leave by rule, not by effort.** Every item has a review-by date.                | GTD: lists decay without a weekly review [R1]. Linear auto-closes stale issues and auto-archives [R10]. OmniFocus review intervals per project [R3].                                                                           |
| 8   | **Plan the day against capacity.** Pick for today; warn when over.                                | Sunsama daily plan, workload warning and shutdown [R7]. Motion ranks by priority, deadline and duration [R8]. Owner fact: ≥1 task per project per day; order changes by weekday.                                               |
| 9   | **The owner of each item is explicit: human or agent.** Only human leaves reach the owner.        | Owner fact: agents do part of the work. Product-reset `FR:rank.owner` [159]. Delegation in GTD is "waiting for" [R1].                                                                                                          |
| 10  | **Notes are not tasks. History is not notes.** Done deletes; logs belong to the agent run.        | Owner fact: no history. Owner data: dated check logs and status prose in titles.                                                                                                                                               |

## 3. What to copy and what to avoid

| System                 | Copy                                                                                                                                   | Avoid                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| GTD [R1]               | Capture > clarify > organize > reflect > engage. Next action. Waiting-for. Someday/maybe. Weekly review.                               | Context lists (`@phone`) as the main view. The owner works from one queue. |
| Things 3 [R2][R13]     | Areas never finish; projects do. Start date hides items. Today + This Evening. Someday hides projects. Checklist = one level of steps. | No owner field, no agents, no sources.                                     |
| OmniFocus [R3]         | Defer vs due vs planned. Sequential projects: only the first open action is available. Review interval per project.                    | Perspective sprawl. Too many knobs for one human.                          |
| Todoist [R4][R5]       | Deadline separate from due. Flat views of nested tasks (filters show sub-tasks alone).                                                 | Due date that means "do", then rolls overdue every day.                    |
| Linear [R10]           | Triage inbox. Auto-close stale. Parent closes when sub-issues close. Cycles.                                                           | Team process (estimates, SLAs) for a team of one.                          |
| Org-mode [R6]          | TODO keyword states (NEXT, WAITING). SCHEDULED vs DEADLINE. Stuck-project finder: a project with no NEXT.                              | Plain-text outline as storage. It is the owner's failure mode.             |
| Workflowy / Roam [R14] | Zoom into one node. Block refs: link, do not copy.                                                                                     | Infinite nesting. Tasks and notes in one tree.                             |
| Notion [R15]           | Tasks as rows with parent/sub-task relations, not as text indents.                                                                     | A free-form database with no rules. Each view is hand-built.               |
| Sunsama [R7]           | Daily plan ritual, capacity limit, shutdown review, items pulled from sources.                                                         | It is a planner, not a task store [R7]. Manual drag of every item.         |
| Motion [R8]            | Ranking inputs: priority, deadline, duration. Hard vs soft deadline.                                                                   | Full auto-scheduling into the calendar. It moves work to odd times [R8].   |
| Akiflow [R8a]          | Universal inbox from flagged email and starred chat. Flag = capture; unflag = done.                                                    | Pull of every message. Only flagged items enter.                           |
| Superhuman / HEY [R9]  | Split inbox by purpose. Remind-me returns a thread later. Reply Later / Set Aside piles.                                               | Mail-only scope.                                                           |

## 4. Proposed model

### 4.1 Entities

| Entity         | What it is                                                                                                              | Lifetime                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Area**       | A part of life with a value and a weekday weight (Allyte, FTK, FOCUS, F4, Xerilium, Personal). Never done.              | Permanent                                                               |
| **Project**    | An outcome with a done-when. Has one or more tasks. Lives in one area. Can be a sub-project of a project (max 1 level). | Deleted when done                                                       |
| **Task**       | One action with one owner. Leaf of the tree.                                                                            | Deleted when done                                                       |
| **Step**       | A checkbox inside a task (Things checklist). No owner, no date, no rank.                                                | Deleted with the task                                                   |
| **Inbox item** | A captured signal: email, PR event, calendar event, agent ask, quick capture. Points to the source.                     | Deleted when clarified, dropped or turned into a task                   |
| **Agent run**  | One agent session that works a task. Holds status, log, last output, link to the session.                               | Deleted when its task is done (log stays in the session, not the store) |
| **Day plan**   | One row per date: picks, capacity, done-today per area/project, shutdown note.                                          | Kept 2 days (today and yesterday), then deleted                         |
| **Priority**   | The owner's ranked focus list with weekday slots ([179](https://github.com/Xerilium/stack/pull/179)).                   | Replaced when the owner changes it                                      |

### 4.2 Nesting without giant lists

| Rule                                                                                                              | Why                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| N1 Fixed levels: Area > Project > (sub-project) > Task > Step. No task under a task.                              | Each level has one meaning. Depth max 4 from area, like Todoist [R5].  |
| N2 A row with children is a project. A task cannot have child tasks. Import turns each parent row into a project. | Ends "parent rows are outcomes" as a rubric rule; makes it structural. |
| N3 Only a task can be next. A project is never shown as next.                                                     | Outcomes are not actions [R1].                                         |
| N4 A project is `sequential` or `parallel`. Sequential exposes only its first open task.                          | OmniFocus [R3]. Most owner parents are sequences (onboarding steps).   |
| N5 A project with open tasks but no available task is **stuck**. Stuck shows in review, not in next.              | Org stuck projects [R6].                                               |
| N6 Cap open tasks per project at 7 available (not deferred, not waiting). More goes to someday.                   | Forces a pick. Value is a guess; tune with data.                       |
| N7 Notes are a field on a task or project (markdown text). Notes never hold tasks or dates.                       | Owner data: logs and child rows mixed in notes.                        |
| N8 Links, not copies: a PR, email or issue is a link with live state. Never a child row.                          | Owner data: PR child rows go stale. Block refs [R14].                  |

### 4.3 Task fields

Required to enter the queue (the quality gate from [159](https://github.com/Xerilium/stack/pull/159), now enforced at write):

| Field      | Type             | Rule                                                                |
| ---------- | ---------------- | ------------------------------------------------------------------- |
| `id`       | `project/slug`   | Stable ([180](https://github.com/Xerilium/stack/pull/180) `FR:id`)  |
| `title`    | text ≤ 80 chars  | Verb first, one action. No status prose.                            |
| `doneWhen` | text             | One check anyone can make. Default from a single linked PR: merged. |
| `owner`    | `me` \| agent id | Never mixed. Human step under agent work = its own task.            |
| `project`  | project id       | Area comes from the project.                                        |
| `link`     | URL or ref, 0..n | Where to do it. Required when the action happens in another app.    |

Optional:

| Field                           | Type                                      | Rule                                                                            |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `context`                       | ≤ 3 lines                                 | Why it matters; options and the agent's recommendation.                         |
| `deadline`                      | date + `hard` \| `soft`                   | Only a real external date. Who set it goes in context.                          |
| `planned`                       | date                                      | The day the owner intends to do it. Set by the day plan. Rolls with no penalty. |
| `availableAt`                   | date-time                                 | Defer. Hidden until then.                                                       |
| `waitingOn`                     | person, task id or link + `followUp` date | State `waiting`. Returns to the owner or agent on `followUp`.                   |
| `effort`                        | minutes                                   | > 120 means split.                                                              |
| `energy`                        | `deep` \| `light`                         | Day plan fills deep slots first. Optional; skip if unused after 30 days.        |
| `recurrence`                    | rule                                      | Done rolls dates; the task stays.                                               |
| `reviewBy`                      | date                                      | Default: created + 14 days, or deadline. Past it, the task is stale.            |
| `notes`                         | markdown                                  | Reference only.                                                                 |
| `rev`, `updatedAt`, `updatedBy` |                                           | Concurrency ([180](https://github.com/Xerilium/stack/pull/180) `FR:write`).     |

### 4.4 States

| State      | In next pool | Exit                                                                                  |
| ---------- | ------------ | ------------------------------------------------------------------------------------- |
| `draft`    | No           | Passes the gate > `ready`. Agent enriches; owner only gives missing facts.            |
| `ready`    | Yes          | Start, defer, wait, someday, done, drop                                               |
| `active`   | Yes (pinned) | Done, wait, back to ready. Max 1 human task active.                                   |
| `deferred` | No           | `availableAt` passes > `ready`                                                        |
| `waiting`  | No           | Blocker resolves or `followUp` passes > `ready`                                       |
| `someday`  | No           | Weekly review promotes > `draft` or `ready`; else drops after 90 days with no promote |
| done       | Deleted      | Counts once in today's day plan, then is gone                                         |
| dropped    | Deleted      | No count                                                                              |

Agent-owned tasks use the same states. The agent run carries the work status. When an agent needs the owner, it does not edit its own task. It creates a human task (owner `me`) that blocks its task. This keeps "agent work never goes to the owner" structural.

### 4.5 "What's next" inputs

Filter first, then rank. Filters are hard; scores never revive a filtered task.

| Step      | Input                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Filter    | `owner = me`; state `ready` or `active`; available now; not blocked; passes gate; in a sequential project only if first.        |
| Rank 1    | Today's priority order by weekday ([179](https://github.com/Xerilium/stack/pull/179) `slot`, `days`). Ad hoc money tasks first. |
| Rank 2    | Hard deadline inside effort + buffer (Motion hard deadline [R8]).                                                               |
| Rank 3    | Daily goal: an area with no done today gets a boost; boost grows through the day.                                               |
| Rank 4    | Fit: effort ≤ free time to the next calendar event; energy matches the slot.                                                    |
| Rank 5    | Planned today; then soft deadline; then age since `reviewBy` (stale goes to review, not up the list).                           |
| Tie-break | Fewer steps; unblocks an agent (a task that blocks an agent run wins).                                                          |
| Output    | 1 task, with one line "why", plus the next 3 on demand. Never the full list.                                                    |

## 5. Daily loop

| Phase   | Who                  | When                     | What                                                                                                                                                                                                       |
| ------- | -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture | Sources + owner      | Always                   | Connectors write inbox items: 6 mailboxes (flagged or needs-reply only), PRs (review requested, threads to him, CI on his PRs), calendar (prep and follow-up), agent asks, quick capture (one text field). |
| Clarify | Agents first         | Within 15 min of capture | Agent turns an item into a task (gate fields filled), a link on an existing task, waiting, someday, reference or drop. Only items the agent cannot clarify reach the owner as one "decide" card.           |
| Plan    | Owner + CoS          | Morning, < 5 min         | Day plan proposes picks: ≥1 per area for today's areas, priority order by weekday, fit to free calendar time, capacity warning [R7]. Owner accepts or swaps.                                               |
| Do      | Owner                | Day                      | Now shows one task. Done > next appears. Defer and "not today" are one tap. Agents work their tasks in parallel.                                                                                           |
| Review  | Owner + CoS          | Shutdown, < 3 min        | Done-today per area; unfinished picks roll `planned` with no guilt. Yesterday's day plan is deleted.                                                                                                       |
| Weekly  | CoS, owner signs off | Once a week, < 15 min    | Stuck projects, stale `reviewBy`, someday promote or drop, waiting follow-ups. Agents do the sweep; owner answers only the cards. GTD weekly review [R1], Linear auto-close [R10].                         |

## 6. Implications for the store

Facts only. No pick.

### 6.1 Load and writers

| Fact           | Value                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size           | ~1,100 tasks, ~100 projects, few KB each. Under 10 MB total. Any store fits.                                                                                                             |
| Writers        | Owner on Mac, web and phone; many local agent sessions at once; cloud agents; source connectors (email, PR, calendar) on a timer.                                                        |
| Off-Mac need   | Phone capture and cloud agents must write when the Mac sleeps. [180](https://github.com/Xerilium/stack/pull/180) R1 accepts read-only. The loop above needs capture and clarify all day. |
| Conflict shape | Mostly one writer per task (owner field). Hot rows: day plan, project order. Optimistic `rev` is enough.                                                                                 |
| Queries        | Small set: next (filter + rank), inbox, project view, review. Rank runs in app code over < 2k rows.                                                                                      |
| Live push      | Views refresh on change (SSE today).                                                                                                                                                     |
| History        | Not wanted. Day plan keeps 2 days. No event log.                                                                                                                                         |

### 6.2 Options

| Need                   | SQLite on Mac ([180](https://github.com/Xerilium/stack/pull/180))                                                                | Azure SQL (serverless)                                                                                                                 | Azure Cosmos DB (NoSQL)                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Writes when Mac is off | No. One host; phone read-only.                                                                                                   | Yes                                                                                                                                    | Yes                                                                                          |
| Many writers           | One writer at a time; WAL lets readers run during a write [R16]. Not safe on a network file system [R17]. Fine for local agents. | Row locks; many writers                                                                                                                | Per-document; ETag optimistic concurrency [R19]                                              |
| Model fit              | Relational; links and parent ids are plain                                                                                       | Relational; same schema as SQLite                                                                                                      | One document per task; links as arrays; cross-document joins in code                         |
| Live push              | Host emits SSE                                                                                                                   | Polling or app-level events                                                                                                            | Change feed [R19]                                                                            |
| Cost at this size      | Free                                                                                                                             | Free offer: 100k vCore-seconds and 32 GB per month, one database per subscription [R18]. Auto-pause adds a cold start on resume [R18]. | Free tier: 1,000 RU/s and 25 GB for the account lifetime, one account per subscription [R19] |
| Offline / no network   | Works on the Mac                                                                                                                 | Needs network                                                                                                                          | Needs network                                                                                |
| Ops                    | Backup is ours (snapshots in [180](https://github.com/Xerilium/stack/pull/180))                                                  | Managed backup                                                                                                                         | Managed backup                                                                               |

### 6.3 What the evidence says

- The model above is relational (area, project, task, links, day plan). It moves to any of the three.
- The deciding fact is the writer set, not size or query power. If phone capture and cloud agents must write with the Mac off, a Mac-only SQLite writer does not meet the loop.
- Between Azure SQL and Cosmos DB the evidence is weak. Azure SQL keeps one schema with local SQLite (tests, offline cache). Cosmos DB gives change feed and no cold start. Decide on a measured cold start and on the live-push design.
- Keep the store behind `TaskStore` ([180](https://github.com/Xerilium/stack/pull/180) `FR:store.@type`) so the pick stays cheap to change.

## 7. Open questions

1. Must phone capture and cloud agents write while the Mac is off? This decides the store (section 6.3).
2. Area per weekday: is a "goal ≥1 done per project" scoped to today's areas only (Thu-Sun has no QM), or to all areas every day?
3. Cap N6 (7 available tasks per project): accept a hard cap with overflow to someday, or a soft warning only?
4. Import: turn every parent row with children into a project (N2), or let the CoS rewrite the top 100 first and import the rest as `draft`?
5. Done today: is a count per area enough, or does the owner want to see the titles of today's done tasks at shutdown?

## References

- [R1] Getting Things Done, five steps and weekly review: [Asana GTD guide](https://asana.com/resources/getting-things-done-gtd), [Graham Mann book notes](https://grahammann.net/book-notes/getting-things-done-david-allen), [Thomas Frank 5-minute guide](https://thomasjfrank.com/productivity/the-5-minute-guide-to-gtd-getting-things-done/)
- [R2] Things 3 Today, Upcoming, Anytime, Someday, start dates, deadlines: [Cultured Code support](https://culturedcode.com/things/support/articles/2803579/), [Cultured Code features](https://culturedcode.com/things/features/), [vanja.io guide](https://vanja.io/things-3-complete-guide/)
- [R3] OmniFocus defer, due, planned dates, project types, review: [OmniFocus 4 manual, Outline](https://support.omnigroup.com/documentation/omnifocus/universal/4.8.11/en/outline/), [OmniFocus 4 manual, Perspectives](https://support.omnigroup.com/documentation/omnifocus/universal/4.8.5/en/perspectives/)
- [R4] Todoist due dates vs deadlines: [Todoist, How to use Todoist effectively](https://doist.com/blog/how-to-use-todoist-effectively), [Todoist changelog](https://help.todoist.com/help/articles/changelog-HD3jJAtLd)
- [R5] Todoist sub-task depth (4 indent levels): [Todoist, Introduction to sub-tasks](https://todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)
- [R6] Org-mode scheduling, deadlines, stuck projects: [Org guide, Deadlines and Scheduling](https://orgmode.org/guide/Deadlines-and-Scheduling.html), [Org manual, Global TODO list](https://www.gnu.org/software/emacs/manual/html_node/org/Global-TODO-list.html), [Org refcard](https://www.gnu.org/software/emacs/refcards/pdf/orgcard.pdf)
- [R7] Sunsama daily planning, workload, shutdown: [Asian Efficiency review](https://www.asianefficiency.com/schedule-management/sunsama-review/), [Sunsama llms.txt](https://www.sunsama.com/llms.txt)
- [R8] Motion auto-scheduling and hard deadlines: [Motion, What auto-scheduling considers](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers), [Motion, Concept: auto-scheduling](https://usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling)
- [R8a] Akiflow universal inbox: [Akiflow universal inbox](https://akiflow.com/universal-inbox), [Akiflow review](https://dhruvirzala.com/akiflow-review/)
- [R9] Superhuman and HEY triage: [Superhuman, Remind Me](https://help.superhuman.com/hc/en-us/articles/43822934607251-Remind-Me), [HEY features](https://hey.com/features/), [The Sweet Setup on HEY](https://thesweetsetup.com/hey-email-disrupted-my-email-workflow/)
- [R10] Linear auto-close, auto-archive, parent and sub-issues: [Linear changelog, auto-close and auto-archive](https://linear.app/changelog/2020-08-19-auto-close-and-auto-archive), [Linear docs, archive issues](https://linear.app/docs/archive-issues), [Linear changelog, parent and sub-issue auto-close](https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues)
- [R11] Masicampo and Baumeister (2011), plan making and unfulfilled goals: [Consider It Done!](https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_proquest_miscellaneous_918752704), [Simply Psychology, Zeigarnik effect](https://www.simplypsychology.org/zeigarnik-effect.html)
- [R12] Choice overload and its replication debate: [Scheibehenne et al. 2009](https://abcwest.cogs.indiana.edu/pmwiki/pdf/Scheibehenne.psychmarket.2009.pdf), [Kellogg Insight](https://insight.kellogg.northwestern.edu/article/what-predicts-consumer-choice-overload), [The Decision Lab](https://thedecisionlab.com/reference-guide/psychology/choice-overload)
- [R13] Things 3 headings and checklists: [Cultured Code, headings](https://culturedcode.com/things/support/articles/4438545/), [MacRumors, Things 3 launch](https://www.macrumors.com/2017/05/18/things-3-task-manager-for-mac-ios-and-apple-watch/)
- [R14] Workflowy and Roam outliners, block references: [Lindy, Workflowy alternatives](https://www.lindy.ai/blog/workflowy-alternatives), [Obsidian forum, block reference](https://forum.obsidian.md/t/block-reference/674/113)
- [R15] Notion sub-tasks and dependencies: [Notion help](https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies)
- [R16] SQLite WAL, one writer and concurrent readers: [sqlite.org/wal.html](https://www.sqlite.org/wal.html)
- [R17] SQLite over a network file system: [sqlite.org/useovernet.html](https://www.sqlite.org/useovernet.html)
- [R18] Azure SQL Database free offer and serverless auto-pause: [InfoQ, Azure SQL free preview](https://www.infoq.com/news/2023/10/public-preview-azure-sql-free/), [Microsoft Learn, serverless tier](https://learn.microsoft.com/azure/azure-sql/database/serverless-tier-overview)
- [R19] Azure Cosmos DB free tier, optimistic concurrency, change feed: [Microsoft Learn, free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier), [Microsoft Learn, optimistic concurrency](https://learn.microsoft.com/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency), [Microsoft Learn, change feed](https://learn.microsoft.com/azure/cosmos-db/change-feed)
