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

## Principles

- **P1 One task, one look**: Every page draws a task, an ask, a thread and an agent with the components in `FR:ui`. No page draws its own.
- **P2 Garbage in is visible**: The app never shows a task as ready to do when it is not. It shows `Needs context` and gets the owning agent to fix it.
- **P3 The owner's queue is the owner's work**: Now and My day show only tasks the owner must do, that are not blocked, and that pass the quality gate.
- **P4 Talk, do not pick modes**: The owner writes free text to the task's agent. The agent decides what to do.
- **P5 Connect by itself**: No screen tells the owner to run a command or read docs. The app does the setup and shows progress.

## Scenarios

### FR:schema: Structured task (plain markdown)

A task stays one `- [ ]` row. Typed context is nested bullets under the row. Files with no typed fields stay valid.

- **FR:schema.grammar** (P1): Under a task row, a nested bullet `- {Key}: {value}` (or `- **{Key}:** {value}`) is a field when `{Key}` (case-insensitive) is one of the keys below. Bullets nested under a field bullet are part of that field's value. Any other nested line is a note. A nested `- [ ]` row is a child task.

  ```markdown
  - [ ] 🙋 Answer the acks in PR #97 📅 Nov 14: 🟢
    - Next: Reply to the 3 open threads in PR #97
    - Done when: Each thread has a reply and PR #97 has no open threads
    - Context: The acks decide the cut of Shchedryk and two remakes
    - Links: flanakin/f4-music#97
    - Owner: me
    - Blocked by: (none)
    - Notes:
      - Roland wants the remakes first
    - [ ] Child task
  ```

- **FR:schema.keys** (P1): The keys are:

  | Key          | Field       | Value                                                                       | Count |
  | ------------ | ----------- | --------------------------------------------------------------------------- | ----- |
  | `Next`       | `next`      | One action, verb first, one sentence                                        | 0..1  |
  | `Done when`  | `doneWhen`  | An observable result                                                        | 0..1  |
  | `Context`    | `context`   | Text; nested bullets kept as lines                                          | 0..n  |
  | `Links`      | `links`     | URLs, `owner/repo#N`, `#N`, `FH 1105` style refs; comma or bullet separated | 0..n  |
  | `Owner`      | `owner`     | `me`, or an agent id from the team                                          | 0..1  |
  | `Blocked by` | `blockedBy` | A task title, ref, person, or `(none)`                                      | 0..n  |
  | `Notes`      | `notes`     | Free text; nesting kept                                                     | 0..n  |

- **FR:schema.notes.tree** (P1): The parser keeps note nesting. A note is `{text, children}`. A line at column 0 below a task, before the next task or heading, is a note of that task.
- **FR:schema.compat** (P1): A file with no fields parses and round-trips byte for byte (`FR:task-parser/roundtrip.exact`). Old notes become `notes`.
- **FR:schema.write** (P1): Writes to a field edit only that field's lines. A new field goes after the last field and before the first child task.
- **FR:schema.owner** (P1): Owner resolution, first match wins:
  1. The `Owner:` field.
  2. The row marker: `🙋` is `me`; `🤖` or `🪄` is the task's agent (`FR:schema.agent`).
  3. A row with no owner gets `me`.

  A row with both `🙋` and `🤖`/`🪄` and no `Owner:` field is `mixed`. A mixed row fails `single` (`FR:quality.rules`).

- **FR:schema.agent** (P1): The task's agent is the agent the thread talks to. It is the `Owner:` agent when the owner is an agent. Else it is `ownerOf` (`web/src/team.ts`), the most specific agent whose scope covers the project and section. The server computes it once. Every page uses the server value.
- **FR:schema.refs** (P1): A PR or issue ref is any of `owner/repo#N`, `repo#N`, `#N`, `PR N`, `FH N`, or a GitHub PR or issue URL. A short ref resolves its repo from the project `Repo:` metadata, else from the nearest ancestor's links. An unresolved ref stays text.

### FR:quality: Task quality gate

- **FR:quality.rules** (P1): Four checks. Each is deterministic. No model call.

  | Check      | Passes when                                                                                           |
  | ---------- | ----------------------------------------------------------------------------------------------------- |
  | `next`     | A `Next:` field exists, or the row is a leaf whose title starts with a verb from `fixtures/verbs.txt` |
  | `doneWhen` | A `Done when:` field exists, or the row links exactly one PR or issue (done is merged or closed)      |
  | `context`  | The row has a `Context:` field, a `Links:` field, a link in the title, or 1+ notes                    |
  | `single`   | The owner is not `mixed`, and the title does not join two verbs with `and`, `;`, `+`, `then` or `/`   |

- **FR:quality.score** (P1): `score` is the count of checks that pass (0-4). `actionable` is `score === 4`. `missing` lists the failed checks in table order.
- **FR:quality.ui** (P1): A task that is not actionable shows `Needs context` and the names of the missing checks. It never shows Start or Done as the main action. Its main action is `Ask {agent} to fill it in`.
- **FR:quality.enrich** (P1): `Ask {agent} to fill it in` sends one thread message of kind `enrich` to the task's agent with the missing checks. The agent edits the row fields per `FR:quality.rubric` and replies in the thread. The task card updates when the file changes.
- **FR:quality.rubric** (P1): CoS agents (and every agent that creates or edits a task) apply this rubric. The rubric text lives in `docs/task-rubric.md` and agent files link to it:

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

- **FR:rank.owner** (P1): The owner queue (Now, My day, `GET /rank` default) has only rows where `owner = me`, the row is open, it is not blocked (`⛔️`, `⏳`, or an open `Blocked by:`), and `actionable` is true. An agent-owned parent with an open `🙋` child puts the child in the queue, not the parent.
- **FR:rank.agent-work** (P1): Agent-owned rows show in that agent's thread and in Agents (`FR:ia.agents`). They never show in Now or My day.
- **FR:rank.needs-context** (P1): Rows with `owner = me` that fail the gate are left out of the queue. Notifications shows one item: `{n} tasks need context` with `Ask agents to fill them in` (one tap sends `FR:quality.enrich` for each).
- **FR:rank.stale** (P1): A row is stale when it is overdue by 3+ days and has no activity for 3+ days. Activity is the latest of: an activity log entry for the ref, a thread message, a lifecycle action, or a commit that changed the row.
- **FR:rank.stale.score** (P1): A stale row gets due tier 0 and its score is capped at 500 (`STALE_CAP`). The rank item has `rule: 'stale'`. This replaces the 30-day rule in `src/core/scoring.ts` `dueTier`.
- **FR:rank.stale.prompt** (P1): A stale row shows `Still true?` with three one-tap actions:
  - `Keep`: records activity. The row is not stale for 3 more days.
  - `Update date`: a date picker with `Tomorrow`, `Next week`, and `Pick`. Writes the new `📅`.
  - `Drop`: skips the row (`skipTask`). A toast offers Undo.

  The prompt shows on the row in Tasks and in TaskDetail. Notifications shows one item: `{n} overdue dates may be stale`.

### FR:api: API shapes

- **FR:api.summary** (P1): `GET /tasks` adds these fields (opt-in with `fields`): `title`, `parent`, `owner`, `agent`, `due`, `status`, `quality` (`{actionable, score, missing}`), `childCount` (`{open, total}`), `refs`.
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
    agent: { id: string; name: string; icon?: string; role?: string };
    ancestors: { ref: string; title: string }[]; // root first
    children: TaskSummary[]; // direct children
    next?: string;
    doneWhen?: string;
    context: string[];
    blockedBy: string[];
    links: {
      href: string;
      label: string;
      kind: "pr" | "issue" | "url";
      repo?: string;
      number?: number;
      state?: "open" | "draft" | "merged" | "closed";
    }[];
    notes: { text: string; children: TaskFull["notes"] }[];
    quality: {
      score: 0 | 1 | 2 | 3 | 4;
      actionable: boolean;
      missing: ("next" | "doneWhen" | "context" | "single")[];
    };
    stale?: { overdueDays: number; lastActivity: string };
    thread: { open: number; lastAt?: string };
  }
  type TaskSummary = Pick<
    TaskFull,
    "ref" | "title" | "status" | "owner" | "quality"
  > & { childCount: { open: number; total: number } };
  ```

- **FR:api.rank** (P1): `GET /rank` items add `title`, `parent` (direct parent ref), `ancestors`, `owner`, `agent`, `quality`, `stale`. `?owner=any` lists all owners; the default is `me`.
- **FR:api.enrich** (P1): `POST /tasks/{ref}/enrich` sends the `enrich` message (`FR:quality.enrich`) and returns the thread message id.
- **FR:api.check** (P1): `stack task check <ref>` prints the quality score and the missing checks. Exit 0 at score 4, else 1.

### FR:ui: One component set

Every page uses only these components for these entities. A test fails when a page draws a task, ask, thread or agent another way.

- **FR:ui.taskcard** (P1): `TaskCard`. One line: tick, title (with `RefLink`s inline), `AgentChip` when the owner is an agent, due, effort, `n/m` children. A second line, muted: the direct parent title. Not actionable: a `Needs context` badge. Stale: a `Still true?` badge. Tap opens TaskDetail. Hover and focus change the background.
- **FR:ui.taskdetail** (P1): `TaskDetail`. Top to bottom:
  1. Back, then the breadcrumb: project › ancestors (each a link).
  2. Title with inline `RefLink`s.
  3. `Next`, then `Done when`, in large type. If not actionable: the `Needs context` panel (`FR:quality.ui`).
  4. Context, Links, Blocked by.
  5. Notes as a nested list.
  6. Children as `TaskCard`s.
  7. `Thread` with the task's agent.
  8. Actions: Done, Defer, Drop. Markers (priority, effort, due) are in a `More` menu.
- **FR:ui.thread** (P1): `Thread`. Chat bubbles with `AgentChip`. One text box and Send. No modes, no quick buttons. The `AgentChip` above the box is the recipient. Tap it to pick another agent for this task; the choice writes `Owner:` only when the owner said "do it". The agent's reply shows in the thread (`FR:connect.agents`).
- **FR:ui.agentchip** (P1): `AgentChip`. Fluent emoji avatar plus display name from the team file. One source for the name: `agent.name`. States: idle, working (spinner), needs you (dot).
- **FR:ui.askcard** (P1): `AskCard`. Shows: from (`AgentChip`), the ask, then a brief: problem, recommendation, options, risks, links (`RefLink`). The primary button names the action, for example `Approve: merge PR 97`. "Go with it" does not exist. An ask with no brief shows `No brief` and `Ask {agent} for a brief`.
- **FR:ui.reflink** (P1): `RefLink`. Draws every ref from `FR:schema.refs` as an inline link with the short label (`f4-music#97`) and a state dot when known. Many refs in one text all link. No "Open {host}" button exists anywhere.
- **FR:ui.done** (P1): Done on any `TaskCard` or TaskDetail plays a 400 ms check and collapse. With reduced motion, it plays no animation. A toast offers Undo for 5 s.

### FR:ia: Destinations and navigation

- **FR:ia.nav** (P1): Six destinations, in this order: Now, My day, Tasks, Notifications (bell with count), Priorities, Agents. Nothing else is in the nav.
- **FR:ia.removed** (P1): These pages stop: Top asks (`#/home`), Needs you (`#/asks`), Inbox (`#/inbox`), Projects (`#/projects`), Full stack (`#/list`), Sessions. Old hashes redirect to the new page with the same filter.
- **FR:ia.back** (P1): Each view has a URL. Opening a task pushes `#/tasks/{ref}`. Every page that is not a destination root has Back at the top left. Back goes to the previous URL, else to the parent in the breadcrumb. Esc does the same. Back restores filters and scroll.
- **FR:ia.pane** (P2): At 1100 px or wider, TaskDetail opens as a right pane. The list stays usable. Below 1100 px it is a full page with Back.
- **FR:ia.now** (P1): Now is the single working surface. It shows the top task in the owner queue (`FR:rank.owner`) as TaskDetail, with the `Thread` open. Done (`FR:ui.done`) opens the next task in the queue with no tap. The header shows the next meeting (`FR:connect.calendar`) and the Notifications count.
- **FR:ia.cos** (P1): At 1280 px or wider, Now is the CoS view: left, the top 3 Notifications (`AskCard`); center, Now; right, the next 3 hours of My day. It uses the same components. There is no separate CoS page.
- **FR:ia.myday** (P1): My day is a calendar grid of equal 30-minute slots from wake to bed with a now line. Meetings are blocks at their real times. The planner fills free time with blocks of these kinds:
  - `Respond`: answer agent asks and replies. 30 min. Placed after each meeting that ends with 3+ open asks, and at least every 2 hours. Holds the top asks.
  - `Validate`: test one PR or feature an agent finished. 30 min. Holds the PRs that wait on the owner.
  - `Focus`: one actionable owner task with effort of 60 min or more.

  Each block lists its items as `TaskCard`s or `AskCard`s. Block order follows the owner queue score.

- **FR:ia.tasks** (P1): Tasks is one tree list of `TaskCard`s with filters: project, owner (`me`, an agent, any), quality (`actionable`, `needs context`, `stale`), and status. Projects and Full stack are saved filters: `Tasks · project = X` and `Tasks · all`. A project header row opens the project filter; it never opens a different page. Parents collapse.
- **FR:ia.notifications** (P1): One ranked list of things that need the owner: asks (`AskCard`), PR escalations, `{n} tasks need context`, `{n} overdue dates may be stale`, and mail that needs an action (from the connected inboxes). Each item has one primary action.
- **FR:ia.priorities** (P2): Priorities keeps `pris-sessions-ui` behavior on the shared components.
- **FR:ia.agents** (P1): Agents shows the whole team as an org tree: CoS at the top, then each sub-CoS, then project agents. Each node is an `AgentChip` with state and open work count. Tap opens the agent page: its open tasks (`TaskCard`s), its threads, its sessions.

### FR:connect: Connect by itself

- **FR:connect.rule** (P1): No user-facing string names a CLI command, a script, an environment variable, a terminal, or a docs path. A test scans `web/src` strings and the server setup messages and fails on a match.
- **FR:connect.flow** (P1): Each connection is one button. The app runs the setup itself and shows a step list with live state (`Waiting for sign-in`, `Checking access`, `Connected`). A failure shows the reason in plain words and `Try again`.
- **FR:connect.calendar** (P1): `Connect calendar` signs in to Microsoft (personal and work) in the app (`graph-signin`) and reads the calendar live. The same sign-in offers the mailboxes.
- **FR:connect.mail** (P1): Connected mailboxes feed Notifications (`FR:ia.notifications`). There is no Inbox page.
- **FR:connect.agents** (P1): Thread messages reach the agent with no owner step. The host runs the agent headless with the task context (`TaskFull`) and posts the reply in the thread. When the agent login is missing or expired, the app shows `Sign in to Claude`. It starts the sign-in itself and opens the browser.
- **FR:connect.github** (P1): The host uses the GitHub login it finds on the machine. When there is none, it shows `Sign in to GitHub` and runs the device flow in the app.

## Architecture constraints

- Markdown stays the source of truth. No new store for task fields.
- The parser and quality checks are pure functions in `src/core`. The web gets computed values from the API and never parses fields itself.
- The `owner`, `agent` and `quality` values come from the server only.

## Dependencies

- `task-parser`: grammar and round-trip.
- `api`: routes.
- `agent-thread`: message store.
- `scoring-engine`: due tiers.
- `graph-signin`: Microsoft sign-in.
- `my-day-grid` ([156](https://github.com/Xerilium/stack/pull/156)): grid layout.
- `agents-team` ([155](https://github.com/Xerilium/stack/pull/155)): team scan.
