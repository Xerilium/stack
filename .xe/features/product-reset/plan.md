# Plan: product reset

Small PRs, in order. Each PR can ship alone. Each PR has tests first (`.xe/process/development.md`). Each PR moves its page to the shared components; no PR adds a new private way to draw a task, ask, thread or agent.

## Existing work: what happens to it

| Work                                                                | State on 2026-11-12        | Decision                                                                         |
| ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| [156](https://github.com/Xerilium/stack/pull/156) my-day-grid       | Draft                      | Pause. Rebase onto Stage 4. Becomes Stage 8. Keep `grid.ts` slot and lane logic. |
| [155](https://github.com/Xerilium/stack/pull/155) agents-whole-team | Draft                      | Keep the scan (data). Drop its layout. The org layout ships in Stage 10.         |
| `xe/agent-delivery`                                                 | Branch, spec commit, no PR | Adopt as Stage 1.                                                                |
| `xe/connect-outlook`                                                | Branch, no commits         | Superseded by Stage 7.                                                           |
| `xe/notifications-nav`                                              | Branch, no commits         | Superseded by Stage 9.                                                           |
| `xe/ask-briefs`                                                     | Branch, no commits         | Superseded by Stage 9 (`AskCard`) and Stage 3 (rubric).                          |
| `xe/cos-view-base-of-ops`                                           | Branch, 1 commit, no PR    | Superseded by Stage 11 (`FR:ia.cos`).                                            |

## Stage 0: Quick fixes (1 PR each, ship now)

| PR                  | Change                                                                                                                                                                                   | Spec                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 0a now-done-advance | Done on Now plays the check animation, then opens the next queue task. Undo toast.                                                                                                       | `FR:ui.done`, `FR:ia.now`                        |
| 0b no-go-with-it    | Replace `Go with it` (`asks.ts:55,59`, `views.tsx:516`) with `Approve: {recommend}`, clipped to 40 characters.                                                                           | `FR:ui.askcard`                                  |
| 0c ref-links        | Remove the `Open {host} ↗` button (`NowAsks.tsx:73,75`). Autolink refs in `markdown.ts` (`#N`, `repo#N`, `owner/repo#N`, PR and issue URLs, `FH N`). Repo from project `Repo:` metadata. | `FR:ui.reflink`, `FR:schema.refs`                |
| 0d one-agent        | Use `ownerOf` in AgentChip, AgentTalk and tiles (`useTeam.ts:59`, `AgentTalk.tsx:24`, `App.tsx:957`). Add the agent picker chip to `NowChat`.                                            | `FR:schema.agent`, `FR:ui.thread`                |
| 0e card-hover       | Hover and focus change the card background in light and dark (`nowscreen.css`, `asks.css`, `myday.css`).                                                                                 | `FR:ui.taskcard`                                 |
| 0f queue-owner      | The ranker drops rows marked `🤖`/`🪄` from the owner queue. An agent row with an open `🙋` child ranks the child.                                                                       | `FR:rank.owner` (marker part), audit R1          |
| 0g stale-cap        | Stale rule: overdue 3+ days with no commit to the row in 3+ days gets tier 0 and a score cap of 500.                                                                                     | `FR:rank.stale`, `FR:rank.stale.score`, audit R2 |

## Stages 1-11

| #   | PR                | Delivers                                                                                                                                                                              | Supersedes                                                 |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | agent-delivery    | Thread messages reach the agent headless; replies post to the thread; `Sign in to Claude` flow in the app.                                                                            | `xe/agent-delivery` (adopt)                                |
| 2   | task-schema       | Parser fields, note tree, owner, refs; `GET /tasks` summary fields; `GET /tasks/{ref}?view=full`; round-trip tests on the live sample shape.                                          | —                                                          |
| 3   | quality-gate      | Quality checks, `stack task check`, `POST /tasks/{ref}/enrich`, `docs/task-rubric.md`, rubric link in CoS agent files, ranker uses `owner` field and the gate, `Still true?` actions. | Rubric part of `xe/ask-briefs`                             |
| 4   | components        | `TaskCard`, `TaskDetail`, `Thread`, `AgentChip`, `AskCard`, `RefLink`; the "one component" test. Remove `Composer` modes, `AgentTalk`, `RowDetail`.                                   | Ask / Do it, Review / Do it / Plan                         |
| 5   | now-surface       | Now as TaskDetail plus Thread; auto-advance on Done; next meeting in the header.                                                                                                      | `NowView`, `NowChat`, `NowAsks`                            |
| 6   | nav-back          | Six destinations, URL per view, Back and breadcrumb, right pane at 1100 px, redirects from old hashes; Tasks with filters replaces Projects and Full stack.                           | `ProjectsView`, `ListView`, `HomeView`                     |
| 7   | connect-microsoft | In-app Microsoft sign-in for calendar and mail with a step list; removes every command and docs string (`FR:connect.rule` test).                                                      | `xe/connect-outlook`                                       |
| 8   | myday-grid        | Grid on the shared components; `Respond`, `Validate`, `Focus` blocks.                                                                                                                 | [156](https://github.com/Xerilium/stack/pull/156) (rebase) |
| 9   | notifications     | One ranked list; `AskCard` with a brief; needs-context and stale summary items; mail items. Inbox page and Needs you stop.                                                            | `xe/notifications-nav`, `xe/ask-briefs`                    |
| 10  | agents-org        | Org tree of the whole team; agent page with tasks, threads, sessions.                                                                                                                 | [155](https://github.com/Xerilium/stack/pull/155) layout   |
| 11  | cos-wide          | Now at 1280 px+ as the CoS view (`FR:ia.cos`).                                                                                                                                        | `xe/cos-view-base-of-ops`                                  |

## Order rationale

- Stage 0 removes the worst friction with no model change.
- Stage 1 is first after that: an app whose agents never answer is not usable.
- Stages 2-3 fix the data. Stages 4-6 depend on the API fields.
- Stage 7 before 8: the grid needs the live calendar.

## Done when

- The owner works a full day from Now and My day with no command, no docs, and no "what do I do here" moment.
- Every open owner task in the queue scores 4. The rest show `Needs context` or sit with an agent.
