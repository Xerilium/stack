# Audit: product reset

Owner feedback, 2026-11-12: the app is not usable. This audit finds the causes in the code and the data. All paths are under `web/src/` unless shown.

## 1. Data: what is lost between markdown and the screen

Sample: `~/dev/todo-live/tasks` (read-only), 2026-11-12.

| Measure                                                    | Value     |
| ---------------------------------------------------------- | --------- |
| Open rows                                                  | 1093      |
| Open rows that are nested under a parent                   | 789 (72%) |
| Open rows with any nested note line                        | 102 (9%)  |
| Open rows with a typed field (`Next:`, `Owner:` and so on) | 1 (0.1%)  |
| Open rows marked agent (`🤖`/`🪄`)                         | 59        |
| Open rows marked human (`🙋`)                              | 14        |

Result: 91% of open rows have no context in the file. The app cannot show context that does not exist. The data problem and the display problem both need a fix.

### Chain from file to screen

| Step        | Code                                          | Keeps                                                            | Loses                                                                                                                                                                                                                |
| ----------- | --------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse       | `src/core/parser.ts` `parseProject`           | Tree (`children`), checkbox, raw text, `notes` per task          | Note nesting: each note line is `trim()`ed into a flat string list, so `- Rec:` lines under a sub-bullet lose their parent. Lines at column 0 under a task (for example `Note:`) attach to nothing. No typed fields. |
| Model       | `src/core/model.ts` `Task`                    | `priority`, `effort`, `dueDate`, `autonomy`, `notes`, `subtasks` | Not used by the API path. No owner, next action, done-when, links or quality.                                                                                                                                        |
| API list    | `src/api/handler.ts` `flatten` (`GET /tasks`) | `ref, text, project, section, done, depth, notes`                | Parent ref, ancestor chain, child refs. The tree becomes a flat list with `depth` only.                                                                                                                              |
| API one     | `GET /tasks/{ref}`                            | Same 7 fields                                                    | Same losses.                                                                                                                                                                                                         |
| API rank    | `GET /rank` (`RankItem`)                      | `ref, text, project, score, rule, root`                          | Notes, children, parent chain (only `root`, the top row, not the direct parent).                                                                                                                                     |
| Client tree | `now.ts` `children`, `progress`               | Rebuilds subtasks from list order and `depth`                    | Breaks when the list is filtered or paged out of order. No ancestors helper.                                                                                                                                         |
| Row parse   | `row.ts` `parseRow`                           | Markers, due, `who` (agent/human), bare URLs lifted to `links`   | `#97` and `repo#97` stay plain text. `markdown.ts` links only `[text](url)`.                                                                                                                                         |
| Now card    | `NowView.tsx:41`                              | Title and a "why" line                                           | Notes, children, parent, links, project, owner.                                                                                                                                                                      |

Example from the sample: `flantastic-4.md:99` `Answer the acks in PR #97` sits under `Christmas After Dark` (`:91`). Now shows only the leaf title. The parent is lost, and `#97` is not a link.

## 2. Where each entity renders

### Tasks

| File:symbol                      | Page                 | Fields                                                                              | Actions                                       |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `NowView.tsx:41`                 | Now                  | Title, why                                                                          | Done, Defer. No way to open detail.           |
| `views.tsx:747` focus block      | Top asks (`#/home`)  | Title, project, late, agent has it                                                  | Start, Done, More time, menu, expand          |
| `views.tsx:806` TopRow           | Top asks             | Project, title, minutes, due                                                        | Expand in place                               |
| `views.tsx:585` PlanBlock        | My day               | Time, tick, title, links, project, due, status, tags                                | Opens TaskDetail; hover Start/Defer/Message   |
| `views.tsx:477` no-fit list      | My day               | Estimate, title, links, due, project                                                | Opens TaskDetail                              |
| `views.tsx:164` TaskRow          | Full stack           | Status, tags, title, priority, effort, project, AgentChip, due, n/m                 | Expand in place; Enter opens TaskDetail; drag |
| `views.tsx:57` RowDetail         | Top asks, Full stack | Notes, subtasks, actions, thread                                                    |                                               |
| `TaskDetail.tsx:142`             | Overlay              | Project · section · status, title, "host ↗" chips, pickers, notes, subtasks, thread | Close ✕ only. No breadcrumb, no Back.         |
| `views.tsx:242` ProjectsView row | Projects             | Project, top task text, counts, load                                                | Whole row goes to the filtered list           |
| `views.tsx:542` tile             | My day side          | Project, top task, agent chip                                                       | Goes to the list                              |

### Asks

| File:symbol                       | Page        | Fields                                                                    | Actions                                                                 |
| --------------------------------- | ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `NowAsks.tsx:28` Card             | Now         | Ask, avatar, name, deadline; expanded: why, recommend, options, default   | Primary, `Open {host} ↗` (`:73`), Reply, Defer                          |
| `AsksView.tsx:71` Row, `:97` Card | Needs you   | Ask, verb, deadline, project, from, why, ref, reply, recommend, if-silent | Go with it / Approve / Reject / options, Defer, Reply, agent talk, Undo |
| `views.tsx:509` decision card     | My day side | Project, title, recommended                                               | Go with it, Reply, Details. Answers via `sendReply`, not `asks.answer`. |
| `ThreadView.tsx:16` AskEntry      | Thread      | Ask, why, answered                                                        | Send buttons, "Reply in Asks"                                           |
| `PrsPanel.tsx:272`                | PR flyout   | Escalations                                                               | Accept, Answer, Reply on GitHub                                         |

### Threads

| File:symbol                             | Page                              | Shows                      | Actions                                                                                                          |
| --------------------------------------- | --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NowChat.tsx:24`                        | Now                               | Bubbles, "To" line         | Text, Send. No agent picker. Every send calls `delegate()` (`App.tsx:628`): adds 🪄 and writes an `instruction`. |
| `ThreadView.tsx:33` + `Composer.tsx:34` | Row expand, TaskDetail            | Meta lines, verdicts, asks | Agent chips, **Ask / Do it** toggle, Send                                                                        |
| `AgentTalk.tsx:23`                      | Floating on Today, Projects, rows | `<select>` To, About       | Review / Do it / Plan                                                                                            |
| `views.tsx:272` Reply + Sent            | My day side                       | "To the X agent"           | Send                                                                                                             |
| `SessionsView.tsx:130` Drawer           | Agents                            | Transcript                 | Message, New session                                                                                             |
| `AsksView.tsx:151`, `NowAsks.tsx:85`    | Needs you, Now                    | "Reply to {from}"          | Send                                                                                                             |

### Agents

| File:symbol                                                                                                     | Form                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `NowChat.tsx:66`, `NowAsks.tsx:52`, `AsksView.tsx:115`, `App.tsx:951`, `Composer.tsx:83`, `SessionsView.tsx:52` | Avatar plus name, 4 different name sources |
| `AgentTalk.tsx:10` AgentChip (`team.ts:95`)                                                                     | Text chip, no avatar                       |
| Composer chips, `AgentTalk` select, `SessionsView.tsx:95` AgentPicker                                           | 3 different pickers. Now has none.         |

## 3. Inconsistencies

| #   | Problem                                     | Evidence                                                                                                                                                           | Owner feedback it explains                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | The same task gets different default agents | `ownerOf` (`team.ts:38`) in Now, Composer, Message. `chain[0]` (the roll-up) in AgentChip (`useTeam.ts:59`), AgentTalk (`AgentTalk.tsx:24`), tiles (`App.tsx:957`) | "connects to the wrong agent with no way to change it" |
| 2   | Three message controls with different modes | Now: none, always delegates. Composer: Ask / Do it. AgentTalk: Review / Do it / Plan                                                                               | "I don't want Ask vs Do it"                            |
| 3   | Messages are not delivered                  | Sends write `tasks/inbox`; no runner picks them up (issue [152](https://github.com/Xerilium/stack/issues/152) D)                                                   | "Now isn't connecting to agents or getting responses"  |
| 4   | Task fields differ on each page             | See the task table                                                                                                                                                 | "every page feels like it was created from scratch"    |
| 5   | "Open the task" does 4 different things     | Expand in place, full overlay, nothing (Now), jump to a filtered list (Projects)                                                                                   | "no back button or hierarchy"                          |
| 6   | Three ask card versions                     | `NowAsks` Card, `AsksView` Card, `views.tsx:509`                                                                                                                   | "Needs you is overwhelming"                            |
| 7   | "Go with it" with no brief                  | `asks.ts:55,59`, `views.tsx:516`                                                                                                                                   | "'go with it' is strange phrasing"                     |
| 8   | PR refs: link, plain text, button           | `views.tsx:403`, `PrsPanel.tsx:255,319`, `NowAsks.tsx:73`; `markdown.ts:4` never links `#N`                                                                        | "open github.com shouldn't be a button"                |
| 9   | Four thread displays                        | NowChat bubbles, ThreadView meta lines, Sent lines, Drawer                                                                                                         | Inconsistent experience                                |
| 10  | Calendar connect differs                    | My day links to `docs/runbook.md` (`views.tsx:437`); Now shows a form and a CLI command (`NowNext.tsx:67-73`)                                                      | "doesn't connect to my calendar automatically"         |
| 11  | My day is a list                            | `myday.css:38` resets `min-height`, so every block is one row high                                                                                                 | "doesn't look like a calendar"                         |
| 12  | Done on Now swaps silently                  | `doAct` (`App.tsx:560`) refreshes; no animation, no open of the next task                                                                                          | "needs an animation and to auto-open the next item"    |
| 13  | Leaf rows shown with no parent              | `RankItem` has `root` only; Now shows the title only                                                                                                               | "Stack seems to show only the leaf node"               |

## 4. Strings that tell the owner to run a command or read docs

| Where                                                                      | String                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NowNext.tsx:67`                                                           | Connect from `stack web` on your computer, or set `STACK_CALENDAR_ICS` on this host. |
| `NowNext.tsx:72`, `calsource.ts:16`                                        | `stack graph login --client-id <app id> --with calendar`                             |
| `views.tsx:437`                                                            | No calendar · Connect (links to `docs/runbook.md`)                                   |
| `InboxSources.tsx:30`                                                      | Server steps with a `CopyCommand` and "How to connect {Source}"                      |
| `team.ts:18`                                                               | Agent prompt cites `stack asks put`, `docs/asks.md`                                  |
| `AgentTalk.tsx:63`, `useTeam.ts:71`, `Composer.tsx:108`, `useThread.ts:61` | Runs in stack web on your machine                                                    |
| `SessionsView.tsx:354`                                                     | Open Stack with `stack web` there.                                                   |
| `api.ts:29`                                                                | Is stack web still running?                                                          |
| `App.tsx:927`                                                              | `scripts/setup-azure.ps1 -Owner …`                                                   |
| `OnboardingView.tsx:34,114`                                                | Check the terminal… / Run this in a terminal…                                        |

## 5. Ranking defects (`stack rank --top 15`, CoS, 2026-11-12)

| #   | Defect                                                                                     | Cause                                                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| R1  | Agent-owned rows rank in the owner's list (for example allyte rows 31, 32, 35, 36, 38, 41) | The ranker does not filter by owner. `row.ts` reads `who` for display only.                                   |
| R2  | Stale overdue rows (F4, due Nov 2-6) score 3000+ and lead                                  | `dueTier` (`src/core/scoring.ts:451`) gives tier 3 to any row overdue up to 30 days. Activity is not checked. |
