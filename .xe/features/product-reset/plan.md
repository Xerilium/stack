# Plan: product reset

- Small PRs, in order. Each PR can ship alone.
- Each PR writes tests first (`.xe/process/development.md`).
- No PR adds a new private way to draw a task, ask, thread or agent.

## Existing work: what happens to it

| Work                                                                | State on 2026-11-12     | Decision                                                                         |
| ------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| [156](https://github.com/Xerilium/stack/pull/156) my-day-grid       | Draft                   | Pause. Rebase onto Stage 4. Becomes Stage 8. Keep `grid.ts` slot and lane logic. |
| [155](https://github.com/Xerilium/stack/pull/155) agents-whole-team | Draft                   | Keep the scan (data). Drop its layout. The org layout ships in Stage 10.         |
| [161](https://github.com/Xerilium/stack/pull/161) agent-delivery    | Open                    | Adopt as Stage 1.                                                                |
| `xe/connect-outlook`                                                | Branch, no commits      | Superseded by Stage 7.                                                           |
| `xe/notifications-nav`                                              | Branch, no commits      | Superseded by Stage 9.                                                           |
| `xe/ask-briefs`                                                     | Branch, no commits      | Superseded by Stage 9 (`AskCard`) and Stage 3 (rubric).                          |
| `xe/cos-view-base-of-ops`                                           | Branch, 1 commit, no PR | Superseded by Stage 11 (`FR:ia.cos`).                                            |

## Stage 0: Quick fixes (1 PR each, ship now)

| PR                  | Change                                                                                                                                                                                                                                        | Spec                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0a now-done-advance | Done on Now plays the check animation, then opens the next queue task. Undo toast.                                                                                                                                                            | `FR:ui.done`, `FR:ia.now`                                   |
| 0b no-go-with-it    | Replace `Go with it` (`asks.ts:55,59`, `views.tsx:516`) with `Approve: {recommend}`, clipped to 40 characters.                                                                                                                                | `FR:ui.askcard`                                             |
| 0c ref-links        | Remove the `Open {host} ↗` button (`NowAsks.tsx:73,75`). Autolink refs in `markdown.ts` (`FR:schema.refs` resolution order). Data step for the CoS (todo repo, not code): add `Repository:` or `Repos:` to the 13 project files that lack it. | `FR:ui.reflink`, `FR:schema.refs`                           |
| 0d one-agent        | Use `ownerOf` in AgentChip, AgentTalk and tiles (`useTeam.ts:59`, `AgentTalk.tsx:24`, `App.tsx:957`). Add the agent picker chip to `NowChat`.                                                                                                 | `FR:schema.agent`, `FR:ui.thread`                           |
| 0e card-hover       | Hover and focus change the card background in light and dark (`nowscreen.css`, `asks.css`, `myday.css`).                                                                                                                                      | `FR:ui.taskcard`                                            |
| 0f queue-owner      | The ranker drops agent-owned rows (`🤖`/`🪄`, and unmarked rows under an agent-owned ancestor) from the owner queue. An open `🙋` child of an agent row ranks.                                                                                | `FR:rank.owner`, `FR:schema.owner` (markers only), audit R1 |
| 0g stale-cap        | A row overdue 3+ days, with no commit to it in 3+ days, gets tier 0 and a score cap of 500. The last-change map is cached per revision.                                                                                                       | `FR:rank.stale`, `FR:rank.stale.score`, audit R2            |

## Stages 1-11

| #   | PR                | Delivers                                                                                                                                                                                                                                                                                                             | Supersedes                                                 |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | agent-delivery    | Thread messages reach the agent headless. Replies post to the thread. `Sign in to Claude` in the app. Remote message state (`FR:connect.agents.remote`). The agent gets the row text, notes and project; Stage 2 upgrades this to `TaskFull`.                                                                        | `xe/agent-delivery` (adopt)                                |
| 2   | task-schema       | Parser fields, note tree, owner with inheritance, refs, blocked. `ownerOf` moves to `src/core/agents.ts`. `GET /tasks` summary fields. `GET /tasks/{ref}?view=full`. Agent delivery sends `TaskFull`.                                                                                                                | —                                                          |
| 3   | quality-gate      | Quality checks. `stack task check`. Single and bulk enrich. `docs/task-rubric.md`, linked from CoS agent files. Ranker uses the owner field, the gate, blocked and `Checked:`. Now shows the needs-context item when the queue is empty. `Still true?` actions on rows.                                              | Rubric part of `xe/ask-briefs`                             |
| 4   | components        | `TaskCard`, `TaskDetail`, `Thread`, `AgentChip`, `AskCard`, `RefLink`. The one-component test (`FR:ui.test`). Priorities moves to the components. Remove Composer modes, `AgentTalk`, `RowDetail`.                                                                                                                   | Ask / Do it, Review / Do it / Plan                         |
| 5   | now-surface       | Now as TaskDetail plus Thread. Auto-advance on Done. The header uses the current calendar source and the Needs you count; Stages 7 and 9 upgrade both with no Now change.                                                                                                                                            | `NowView`, `NowChat`, `NowAsks`                            |
| 6   | nav-back          | URL per view, Back and breadcrumb, right pane at 1100 px. Tasks with filters replaces Projects and Full stack. Rail and tab bar per `FR:ia.nav`; the Notifications entry opens the current Needs you page until Stage 9. Redirects for `#/home`, `#/next`, `#/focus`, `#/projects`, `#/list`. Keys per `FR:ia.keys`. | `ProjectsView`, `ListView`, `HomeView`                     |
| 7   | connect-microsoft | In-app Microsoft sign-in for calendar and mail, with a step list. GitHub device flow. Remove every command and docs string; add the `FR:connect.rule.test`.                                                                                                                                                          | `xe/connect-outlook`                                       |
| 8   | myday-grid        | Grid on the shared components. `Respond`, `Validate`, `Do` and `Focus` blocks.                                                                                                                                                                                                                                       | [156](https://github.com/Xerilium/stack/pull/156) (rebase) |
| 9   | notifications     | One ranked list. `AskCard` with a brief. Needs-context, stale and mail items. Inbox and Needs you pages stop; redirects for `#/asks` and `#/inbox`.                                                                                                                                                                  | `xe/notifications-nav`, `xe/ask-briefs`                    |
| 10  | agents-org        | Org tree of the whole team. Agent page with tasks, threads, sessions.                                                                                                                                                                                                                                                | [155](https://github.com/Xerilium/stack/pull/155) layout   |
| 11  | cos-wide          | Now at 1280 px or wider as the CoS view (`FR:ia.cos`).                                                                                                                                                                                                                                                               | `xe/cos-view-base-of-ops`                                  |

## Order rationale

- Stage 0 removes the worst friction with no model change.
- Stage 1 comes next: an app whose agents never answer is not usable.
- Stages 2 and 3 fix the data. Stage 3 ships bulk enrich, so the queue fills again as agents add context.
- Stages 4-6 need the API fields from Stage 2.
- Stage 7 comes before Stage 8: the grid needs the live calendar.

## Done when

- At least 80% of open owner-owned rows score 4.
- No owner-facing string fails `FR:connect.rule.test`.
- On 5 work days in a row, the owner queue is not empty at 9:00 and the owner sends no feedback that a task is not actionable.
