---
id: product-reset
title: Product reset
author: flanakin
description: "One task model with typed context and a quality gate, one component set, a small set of destinations with Back, and an app that connects itself."
dependencies:
  [
    task-parser,
    task-model,
    api,
    web-app,
    agent-thread,
    ask-queue,
    scoring-engine,
    day-inputs,
    graph-signin,
    ux-consolidation,
  ]
---

# Feature: Product reset

## Purpose

The owner cannot act on what the app shows. Causes (see `audit.md`):

- 91% of open tasks have no context, and the app drops the context that exists.
- Each page draws tasks, asks, threads and agents its own way.
- Messages to agents are not delivered. Setup asks the owner to run commands.
- The ranking puts agent work and stale dates in the owner's queue.

This spec sets the end state. `plan.md` sets the order of delivery.

## Changes to other specs

| Spec               | Requirement                                   | Change                                                                                                                 |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `task-parser`      | `FR:task.notes`                               | Notes keep their nesting as a tree (`FR:schema.notes.tree`). Typed fields come out of the notes (`FR:schema.grammar`). |
| `scoring-engine`   | `FR:engine.stack`                             | The 30-day stale rule is replaced by `FR:rank.stale.score`. The owner filter `FR:rank.owner` applies before scoring.   |
| `ux-consolidation` | `FR:nav.rail`, `FR:nav.tabbar`, `FR:nav.keys` | Replaced by `FR:ia.nav` and `FR:ia.keys`.                                                                              |
| `home`, `top-asks` | Top asks page                                 | Removed (`FR:ia.removed`).                                                                                             |
| `now-screen`       | Now layout                                    | Replaced by `FR:ia.now`.                                                                                               |

## Principles

- **P1 One task, one look**: Every page draws a task, an ask, a thread and an agent with the components in `FR:ui`. No page draws its own.
- **P2 Garbage in is visible**: The app never shows a task as ready to do when it is not. It shows `Needs context` and gets the owning agent to fix it.
- **P3 The owner's queue is the owner's work**: Now and My day show only tasks the owner must do, that are not blocked, and that pass the quality gate.
- **P4 Talk, do not pick modes**: The owner writes free text to the task's agent. The agent decides what to do.
- **P5 Connect by itself**: No screen tells the owner to run a command or read docs. The app does the setup and shows progress.

## Scenarios

### FR:schema: Structured task (plain markdown)

A task stays one `- [ ]` row. Typed context is nested bullets under the row. Files with no typed fields stay valid.

- **FR:schema.grammar** (P1): A nested bullet under a task row can be a field. Its form is `- {Key}: {value}` or `- **{Key}:** {value}`. `{Key}` is one of the keys in `FR:schema.keys`, case-insensitive. Bullets nested under a field bullet are part of that field's value. Any other nested line is a note. A nested `- [ ]` row is a child task.

  ```markdown
  - [ ] 🙋 Answer the acks in flanakin/f4-music#97 📅 Nov 14: 🟢
    - Next: Reply to the 3 open threads in flanakin/f4-music#97
    - Done when: Each thread has a reply and the PR has no open threads
    - Context: The acks decide the cut of Shchedryk and two remakes. Roland set the date.
    - Owner: me
    - Notes:
      - Roland wants the remakes first
    - [ ] 🙋 Child task
  ```

- **FR:schema.keys** (P1): The keys are:

  | Key          | Field       | Value                                                            | Count |
  | ------------ | ----------- | ---------------------------------------------------------------- | ----- |
  | `Next`       | `next`      | One action, verb first, one sentence                             | 0..1  |
  | `Done when`  | `doneWhen`  | An observable result                                             | 0..1  |
  | `Context`    | `context`   | Text; nested bullets kept as lines                               | 0..n  |
  | `Links`      | `links`     | URLs and refs (`FR:schema.refs`); comma or bullet separated      | 0..n  |
  | `Owner`      | `owner`     | `me`, or an agent id from the team                               | 0..1  |
  | `Blocked by` | `blockedBy` | A task ref, a task title, or a person                            | 0..n  |
  | `Checked`    | `checked`   | `YYYY-MM-DD`: the last date the owner said the row is still true | 0..1  |
  | `Notes`      | `notes`     | Free text; nesting kept                                          | 0..n  |

- **FR:schema.notes.tree** (P1): The parser keeps note nesting. A note is `{text, children}`. Attachment follows `FR:task-parser/task.notes`.
- **FR:schema.compat** (P1): `FR:task-parser/roundtrip.exact` stays true for every input. Field parsing never changes the bytes of a file. A file with no fields gives the same tasks and notes as before.
- **FR:schema.write** (P1): A field write edits only that field's lines. A new field goes after the last field and before the first child task.
- **FR:schema.owner** (P1): Owner resolution, first match wins:
  1. The `Owner:` field.
  2. The row marker: `🙋` is `me`. `🤖` or `🪄` is the task's agent (`FR:schema.agent`).
  3. The owner of the nearest ancestor that has one by rule 1 or 2.
  4. `me`.

  A row with both `🙋` and `🤖`/`🪄` and no `Owner:` field is `mixed`. A mixed row fails `single` (`FR:quality.rules`).

- **FR:schema.agent** (P1): The task's agent is the agent that the thread talks to. When the owner is an agent, it is that agent. Else it is the most specific agent whose scope covers the project and section. `ownerOf` moves from `web/src/team.ts` to `src/core/agents.ts`. The server computes the value. Every page uses the server value.
- **FR:schema.refs** (P1): A PR or issue ref is any of `owner/repo#N`, `repo#N`, `#N`, `PR N`, `FH N`, or a GitHub PR or issue URL. A short ref gets its repo from the project `Repo:` metadata. Else it gets the repo from the nearest ancestor's links. An unresolved ref stays text.
- **FR:schema.blocked** (P1): A `Blocked by:` value is open unless it resolves to a done task. A value that does not resolve to a task (a person, free text) is open.

### FR:quality: Task quality gate

- **FR:quality.rules** (P1): Four checks. Each is deterministic. No model call.

  | Check      | Passes when                                                                                          |
  | ---------- | ---------------------------------------------------------------------------------------------------- |
  | `next`     | A `Next:` field exists, or the row is a leaf whose title starts with a verb from `src/core/verbs.ts` |
  | `doneWhen` | A `Done when:` field exists, or the row links exactly one PR or issue (done is merged or closed)     |
  | `context`  | The row has a `Context:` field, a `Links:` field, a PR or issue ref in the title, or 1+ notes        |
  | `single`   | The owner is not `mixed`, and the title does not join two verbs with `and`, `;` or `then`            |

- **FR:quality.score** (P1): `score` is the count of checks that pass (0-4). `actionable` is `score === 4`. `missing` lists the failed checks in table order.
- **FR:quality.ui** (P1): A task that is not actionable shows `Needs context` and the names of the missing checks. Its main action is `Ask {agent} to fill it in`. Start and Done are not main actions on it.
- **FR:quality.enrich** (P1): `Ask {agent} to fill it in` sends one thread message of kind `enrich` to the task's agent. The message names the missing checks. The agent edits the row fields per `FR:quality.rubric` and replies in the thread. The card updates when the file changes.
- **FR:quality.enrich.batch** (P1): A bulk enrich sends one `enrich` message per agent, with up to 20 rows each. The host runs the agents one at a time. A second bulk enrich within 1 hour sends only rows that got no reply.
- **FR:quality.rubric** (P1): Every agent that creates or edits a task applies this rubric. CoS agents must apply it. The text lives in `docs/task-rubric.md`. Agent files link to it:

  ```text
  Task rubric (apply to every task you create or touch)
  1. One thing. Split a row that has two actions or two owners.
  2. Title: verb first, under 12 words, says the result, not the topic.
  3. Owner: add "Owner: me" or "Owner: <agent id>". Mark 🙋 or 🤖 to match.
  4. Agent work never goes to Michael. If he must act, make a 🙋 child for his part only.
  5. Next: one action he can start in under 2 minutes, with the place to do it.
  6. Done when: one result anyone can check (merged, sent, booked, decided).
  7. Context: 1-3 lines. Why it matters, what was tried, what he decides.
  8. Links: every PR, issue, doc, thread. Use owner/repo#N, never a bare #N.
  9. Decisions: state the options and your recommendation in Context.
  10. Blocked by: name the blocker, or omit. Blocked rows never rank.
  11. Due date: only a real deadline. Say who set it in Context.
  12. Stale: overdue with no activity? Ask "Still true?"; do not re-date silently.
  13. Effort: set an effort emoji. Over 2 hours: split it.
  14. Parent rows are outcomes; leaf rows are actions.
  15. Run the quality gate (stack task check <ref>); fix until score 4.
  16. If you cannot reach score 4, set Next: "Michael: give <missing>" and stop.
  ```

### FR:rank: Owner queue

- **FR:rank.owner** (P1): The owner queue feeds Now, My day and the `GET /rank` default. A row is in the queue only when all of these are true:
  - The owner is `me`.
  - The row is open.
  - The row is not blocked: no `⛔️`, no `⏳`, no open `Blocked by:` (`FR:schema.blocked`).
  - `actionable` is true.
- **FR:rank.agent-work** (P1): Agent-owned rows show in that agent's thread and in Agents (`FR:ia.agents`). They never show in Now or My day. An agent-owned parent with an open owner child puts only the child in the queue.
- **FR:rank.needs-context** (P1): Owner rows that fail the gate are not in the queue. One summary item shows them: `{n} tasks need context` with `Ask agents to fill them in` (`FR:quality.enrich.batch`). Notifications shows it. When the queue is empty, Now shows it too.
- **FR:rank.stale** (P1): A row is stale when both are true:
  - It is overdue by 3 days or more.
  - It has had no activity for 3 days or more.

  Activity is the latest of: the `Checked:` date, a thread message, a lifecycle action, or a commit that changed the row. The host caches a last-change map per repo revision.

- **FR:rank.stale.score** (P1): A stale row gets due tier 0. Its final score, after all boosts, is capped at 500 (`STALE_CAP`). The rank item has `rule: 'stale'`.
- **FR:rank.stale.prompt** (P1): A stale row shows `Still true?` with three one-tap actions:
  - `Keep`: writes `Checked: {today}`. The row is not stale for 3 more days.
  - `Update date`: a date picker with `Tomorrow`, `Next week`, and `Pick`. It writes the new `📅`.
  - `Drop`: skips the row (`skipTask`). A toast offers Undo.

  The prompt shows on the row in Tasks and in TaskDetail. Notifications shows one item: `{n} overdue dates may be stale`.

### FR:api: API and CLI

- **FR:api.summary** (P1): `GET /tasks` adds these fields, opt-in with `fields`: `title`, `parent`, `parentTitle`, `owner`, `agent`, `due`, `effort`, `status`, `quality`, `childCount`, `refs`. `quality` is `{actionable, score, missing}`. `childCount` is `{open, total}`.
- **FR:api.full** (P1): `GET /tasks/{ref}?view=full` returns `TaskFull`:

  ```ts
  interface TaskFull {
    ref: string;
    project: { name: string; title: string };
    section: string;
    text: string; // raw row text
    title: string; // markers and lifted links removed
    status: "open" | "done" | "skipped" | "suspended";
    markers: {
      priority?: string;
      effort?: string;
      impact?: string;
      state?: string;
      due?: string;
      recurrence?: string;
    };
    owner: { kind: "me" } | { kind: "agent"; id: string } | { kind: "mixed" };
    agent: AgentRef;
    ancestors: { ref: string; title: string }[]; // root first
    children: TaskSummary[]; // direct children
    next?: string;
    doneWhen?: string;
    context: string[];
    blockedBy: { text: string; ref?: string; open: boolean }[];
    checked?: string;
    links: {
      href: string;
      label: string;
      kind: "pr" | "issue" | "url";
      repo?: string;
      number?: number;
      state?: "open" | "draft" | "merged" | "closed";
    }[];
    notes: Note[];
    quality: {
      score: 0 | 1 | 2 | 3 | 4;
      actionable: boolean;
      missing: ("next" | "doneWhen" | "context" | "single")[];
    };
    stale?: { overdueDays: number; lastActivity: string };
    thread: { unanswered: number; lastAt?: string }; // unanswered: agent messages with no owner reply
  }
  interface AgentRef {
    id: string;
    name: string;
    icon?: string;
    role?: string;
  }
  interface Note {
    text: string;
    children: Note[];
  }
  type TaskSummary = Pick<
    TaskFull,
    "ref" | "title" | "status" | "owner" | "agent" | "quality"
  > & {
    due?: string;
    effort?: string;
    parentTitle?: string;
    childCount: { open: number; total: number };
  };
  ```

- **FR:api.rank** (P1): `GET /rank` items add `title`, `parent`, `ancestors`, `owner`, `agent`, `quality` and `stale`. `parent` is the direct parent ref. `?owner=any` lists all owners. The default is `me`.
- **FR:api.enrich** (P1): `POST /tasks/{ref}/enrich` sends the `enrich` message (`FR:quality.enrich`) and returns the thread message id. `POST /tasks/enrich` with `{refs}` does a bulk enrich (`FR:quality.enrich.batch`).
- **FR:cli.check** (P1): `stack task check <ref>` prints the quality score and the missing checks. It exits 0 at score 4, else 1. Agents use it; the owner never sees it.

### FR:ui: One component set

Every page uses only these components for these entities. A test fails when a page draws a task, ask, thread or agent another way.

- **FR:ui.taskcard** (P1): `TaskCard`.
  - Line 1: tick, title (with `RefLink`s inline), `AgentChip` when the owner is an agent, due, effort, `n/m` children.
  - Line 2, muted: the direct parent title.
  - Not actionable: a `Needs context` badge. Stale: a `Still true?` badge.
  - Tap opens TaskDetail. Hover and focus change the background.
- **FR:ui.taskdetail** (P1): `TaskDetail`. Top to bottom:
  1. Back, then the breadcrumb: project › ancestors. Each is a link.
  2. Title with inline `RefLink`s.
  3. `Next`, then `Done when`, in large type. If not actionable: the `Needs context` panel (`FR:quality.ui`).
  4. Context, Links, Blocked by.
  5. Notes as a nested list.
  6. Children as `TaskCard`s.
  7. `Thread` with the task's agent.
  8. Actions: Done, Defer, Drop. Markers (priority, effort, due) are in a `More` menu.
- **FR:ui.thread** (P1): `Thread`. Chat bubbles with `AgentChip`. One text box and Send. No modes, no quick buttons. The `AgentChip` above the box is the recipient. Tap it to send the next messages to another agent. The picker never writes the task file. Only an agent changes `Owner:`, per the rubric. The agent's reply shows in the thread (`FR:connect.agents`).
- **FR:ui.agentchip** (P1): `AgentChip`. Fluent emoji avatar plus `agent.name`. No other name source exists. States: idle, working (spinner), needs you (dot).
- **FR:ui.askcard** (P1): `AskCard`.
  - Shows: from (`AgentChip`), the ask, then a brief: problem, recommendation, options, risks, links (`RefLink`).
  - The primary button names the action, for example `Approve: merge f4-music#97`. "Go with it" does not exist.
  - An ask with no brief shows `No brief` and `Ask {agent} for a brief`.
- **FR:ui.reflink** (P1): `RefLink` draws each ref from `FR:schema.refs` as an inline link. The label is short (`f4-music#97`). A state dot shows when the state is known. All refs in one text are links. No "Open {host}" button exists anywhere.
- **FR:ui.done** (P1): Done on a `TaskCard` or TaskDetail plays a 400 ms check and collapse. With reduced motion, there is no animation. A toast offers Undo for 5 s.

### FR:ia: Destinations and navigation

- **FR:ia.nav** (P1): Desktop rail, in order: New task, Now, My day, Tasks, Notifications (count), Priorities, Agents. Phone tab bar: Now, My day, New task (center), Notifications (count), More. More holds Tasks, Priorities and Agents.
- **FR:ia.keys** (P2): Chords: `g n` Now, `g d` My day, `g t` Tasks, `g k` Notifications, `g r` Priorities, `g s` Agents. Old chords go to the new page per `FR:ia.removed`.
- **FR:ia.removed** (P1): These pages stop. Each old hash redirects:

  | Old                           | New                           |
  | ----------------------------- | ----------------------------- |
  | `#/home`, `#/next`, `#/focus` | `#/now`                       |
  | `#/asks`                      | `#/notifications`             |
  | `#/inbox`                     | `#/notifications?source=mail` |
  | `#/projects`                  | `#/tasks?group=project`       |
  | `#/list?project=X`            | `#/tasks?project=X`           |
  | `#/list`                      | `#/tasks`                     |
  | `#/agents` sessions view      | `#/agents`                    |

- **FR:ia.back** (P1): Each view has a URL. Opening a task pushes `#/tasks/{ref}`. A page that is not a destination root has Back at the top left. Back goes to the previous URL, else to the parent in the breadcrumb. Esc does the same. Back restores filters and scroll.
- **FR:ia.pane** (P2): At 1100 px or wider, TaskDetail opens as a right pane, and the list stays usable. Below 1100 px it is a full page with Back.
- **FR:ia.now** (P1): Now is the single working surface.
  - It shows the top task in the owner queue (`FR:rank.owner`) as TaskDetail, with the `Thread` open.
  - Done (`FR:ui.done`) opens the next task in the queue with no tap.
  - The header shows the next meeting (`FR:connect.calendar`) and the Notifications count.
  - An empty queue shows the needs-context item (`FR:rank.needs-context`), or `Nothing needs you` when there is none.
- **FR:ia.cos** (P1): At 1280 px or wider, Now is the CoS view. Left: the top 3 Notifications (`AskCard`). Center: Now. Right: the next 3 hours of My day. It uses the same components. There is no separate CoS page.
- **FR:ia.myday** (P1): My day is a calendar grid of equal 30-minute slots from wake to bed, with a now line. Meetings are blocks at their real times. The planner fills free slots with these blocks:

  | Block      | Size        | Holds                                                                          | Placement                                                                                       |
  | ---------- | ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
  | `Respond`  | 30 min      | Open asks and agent replies, best score first                                  | After each meeting when 3+ asks are open; also when 2 hours pass since the last `Respond` start |
  | `Validate` | 30 min      | PRs and features that wait on the owner to test                                | Next free slot after a `Respond` block                                                          |
  | `Do`       | 30 min      | Owner queue tasks with effort under 60 min, in queue order, up to 30 min total | Remaining free slots, queue order                                                               |
  | `Focus`    | Task effort | One owner queue task with effort of 60 min or more                             | Remaining free slots, queue order                                                               |

  Each block lists its items as `TaskCard`s or `AskCard`s.

- **FR:ia.tasks** (P1): Tasks is one tree list of `TaskCard`s. Filters: project, owner (`me`, an agent, any), quality (`actionable`, `needs context`, `stale`), status. Projects and Full stack are saved filters. A project header row sets the project filter and never opens a different page. Parents collapse.
- **FR:ia.notifications** (P1): One ranked list of things that need the owner. Each item has one primary action. Items:
  - Asks (`AskCard`).
  - PR escalations.
  - `{n} tasks need context` (`FR:rank.needs-context`).
  - `{n} overdue dates may be stale` (`FR:rank.stale.prompt`).
  - Mail that needs an action, from the connected inboxes.
- **FR:ia.priorities** (P2): Priorities keeps the `pris-sessions-ui` behavior and uses the shared components.
- **FR:ia.agents** (P1): Agents shows the whole team as an org tree: CoS at the top, then each sub-CoS, then project agents. Each node is an `AgentChip` with its state and open work count. Tap opens the agent page: its open tasks (`TaskCard`s), its threads, its sessions.

### FR:connect: Connect by itself

- **FR:connect.rule** (P1): No owner-facing string names a CLI command, a script, an environment variable, a terminal, or a docs path.
- **FR:connect.rule.test** (P1): A test scans owner-facing strings and fails on a match:
  - Scope: JSX text, `aria-label`, `title`, toast and error text in `web/src`, and the `message` and `steps` fields of setup routes.
  - Patterns: `\bstack (web|graph|asks|task|report)\b`, `\.ps1\b`, `\b(npm|pnpm|npx|az|gh) `, `\bSTACK_[A-Z_]+`, `docs/`, `runbook`, `\bterminal\b`.
  - Exempt: agent prompt text (`web/src/team.ts` prompt builders, `src/agents/*`) and `docs/`.
- **FR:connect.flow** (P1): Each connection is one button. The app runs the setup and shows a step list with live state (`Waiting for sign-in`, `Checking access`, `Connected`). A failure shows the reason in plain words and `Try again`.
- **FR:connect.calendar** (P1): `Connect calendar` signs in to Microsoft (personal and work) in the app (`graph-signin`). The app then reads the calendar live. The same sign-in offers the mailboxes.
- **FR:connect.mail** (P1): Connected mailboxes feed Notifications (`FR:ia.notifications`). There is no Inbox page.
- **FR:connect.agents** (P1): Thread messages reach the agent with no owner step. The host runs the agent headless with the task context and posts the reply in the thread. When the agent login is missing or expired, the app shows `Sign in to Claude`. The app starts the sign-in and opens the browser.
- **FR:connect.github** (P1): The host uses the GitHub login it finds on the machine. When there is none, the app shows `Sign in to GitHub` and runs the device flow in the app.

## Architecture constraints

- Markdown stays the source of truth. No new store for task fields.
- The parser, owner resolution, `ownerOf` and quality checks are pure functions in `src/core`. The web gets computed values from the API and never parses fields.
- The `owner`, `agent` and `quality` values come from the server only.

## Dependencies

- `task-parser`: grammar and round-trip.
- `api`: routes.
- `agent-thread`: message store.
- `scoring-engine`: due tiers.
- `graph-signin`: Microsoft sign-in.
- `ux-consolidation`: nav (replaced).
- `my-day-grid` ([156](https://github.com/Xerilium/stack/pull/156)): grid layout.
- `agents-team` ([155](https://github.com/Xerilium/stack/pull/155)): team scan.
