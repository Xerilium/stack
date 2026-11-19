---
id: pri-first-ranking
title: Priority-first ranking
description: "Rank the owner's ordered priorities first: one action row per priority, then linked tasks, then the rest."
dependencies: [pris-aware-ranking, task-lifecycle]
---

<!-- markdownlint-disable single-title -->

# Feature: Priority-first ranking

## Purpose

The owner's ordered priorities decide what he does next. `stack next`, `stack rank` and the web Home show his priorities first and other work after them. The README summaries are out of scope.

## Scenarios

### FR:order: Rank tasks by priority first

Owner needs `stack next`, `stack rank` and the web Home to follow his priority order so that backlog and agent rows never hide a priority.

- **FR:order.input** (P1):
  - Priorities (@req FR:pris-aware-ranking/link.model) — the owner's ordered list from `~/.stack/pris.json`
  - Ranked tasks (@req FR:task-lifecycle/$ranked-task) — the engine order after the owner filter
- **FR:order.linked** (P1): Ranker MUST put each linked task above every unlinked task.
  > - @req FR:pris-aware-ranking/link.best
  - **FR:order.linked.rank** (P1): Ranker MUST order linked tasks by priority rank, 1 first.
  - **FR:order.linked.score** (P1): Ranker MUST keep the engine order inside one priority.
- **FR:order.unlinked** (P1): Ranker MUST keep the engine order for unlinked tasks.
- **FR:order.overrides** (P1): Ranker MUST apply the owner overrides after the priority order.
  > - @req FR:task-lifecycle/rank.overrides
- **FR:order.none** (P1): Ranker MUST keep the engine order when no priority links.
- **FR:order.next** (P1): Ranker MUST give the first task row below the action rows to a lifecycle command with no ref.
  > - @req FR:task-lifecycle/next.rank

### FR:action: Show one action per priority

Owner needs one row per priority that names his own next step so that he acts without reading agent notes.

- **FR:action.input** (P1): Newest weekly note (string) — the `pris note` text of each priority
  > - @req FR:pris-aware-ranking/cos.note
- **FR:action.parse** (P1): Parser MUST take the action from the text after the last `Michael:` in the newest weekly note.
  - **FR:action.parse.none** (P1): Parser MUST return no action when that text starts with `none` and the next character is not `;`.
  - **FR:action.parse.rest** (P1): Parser MUST return the text after `none;` as the action.
- **FR:action.first** (P1): Ranker MUST put the action rows above every task row, in priority order.
- **FR:action.one** (P1): Ranker MUST show at most one action row per priority.
- **FR:action.output** (P1): Action row (@req FR:$pri-action) — one per priority with an action

### FR:cli: Show the order in the CLI

Owner needs `stack next` and `stack rank` to show the priority order so that the CLI and the web Home agree.

- **FR:cli.@cli** (P1): Interface: `stack next [--top n]`, `stack rank [--engine e] [--top n] [--explain]`
- **FR:cli.read** (P1): CLI MUST read the priorities from `~/.stack/pris.json` (or `STACK_HOME`).
  - **FR:cli.read.bad** (P2): CLI MUST rank without priorities when the file is missing or invalid.
- **FR:cli.rows** (P1): CLI MUST print each action row as `pri:<rank> <score> <title> <action>`.
  - **FR:cli.rows.score** (P2): CLI MUST give an action row the boost of its priority.
    > - @req FR:pris-aware-ranking/engine.boost
- **FR:cli.json** (P1): CLI MUST give each JSON action row `pri` (`{ id, rank, title }`) and no `ref`.
- **FR:cli.explain** (P1): CLI MUST end each linked row of `--explain` with `serves=<rank>:<id> "<title>" via <via> "<term>"`.
  - **FR:cli.explain.action** (P1): CLI MUST end each action row of `--explain` with `serves=<rank>:<id> "<title>" via note`.
  - **FR:cli.explain.json** (P1): CLI MUST give each linked JSON row of `--explain` the `link` (`PriLink`).

### FR:api: Show the order in the web Home

Owner needs the web Home to show the same priority order so that every screen agrees.

- **FR:api.@api** (P1): Interface: `GET /api/rank`, `GET /api/next`
- **FR:api.order** (P1): API MUST rank tasks with the priorities of its priority store.
- **FR:api.tasks** (P1): API MUST return task rows only, no action rows.
- **FR:api.pri** (P1): API MUST give each task row linked to a priority `pri: { rank, title }`: the priority it ranked under (`FR:order.linked`), with its rank for the day. An unlinked row has no `pri`.

### FR:day: Order the priorities for the day

Owner needs the priority order to change by weekday so that each day starts with that day's focus.

- **FR:day.schema** (P1): Day fields on each priority in `pris.json`
  > - @req FR:$pri-day
- **FR:day.input** (P1): Clock (string) — the injected `now`, read as a weekday in the configured time zone
- **FR:day.slot** (P1): Ranker MUST order the priorities by their slot for the day, lowest first.
  - **FR:day.slot.day** (P1): Ranker MUST use the `days` entry for the weekday as the slot when it exists.
  - **FR:day.slot.base** (P1): Ranker MUST use `slot` when the weekday has no entry.
  - **FR:day.slot.none** (P1): Ranker MUST use the file position when a priority has no slot.
- **FR:day.tie** (P1): Ranker MUST put a priority with a weekday entry above one on the same slot without an entry.
  - **FR:day.tie.file** (P2): Ranker MUST use the file order for the other ties.
- **FR:day.off** (P1): Ranker MUST leave out a priority whose weekday entry is `off`.
- **FR:day.validate** (P1): Parser MUST reject a slot that is not a whole number from 0 to 99.
  - **FR:day.validate.key** (P1): Parser MUST reject a `days` key that is not `mon`, `tue`, `wed`, `thu`, `fri`, `sat` or `sun`.
- **FR:day.cli** (P1): Interface: `stack pris put --file <json>`
  - **FR:day.cli.put** (P1): CLI MUST replace the priority list with the JSON array in the file.

### FR:daily: Track one task per project per day

Owner needs each project's pick for today and whether he finished a task in it today so that he does at least one task in every project each day.

- **FR:daily.@cli** (P1): Interface: `stack next --daily`, `stack rank --daily`
- **FR:daily.@api** (P1): Interface: `GET /api/rank?daily=1`
- **FR:daily.pick** (P1): Ranker MUST name the first ranked task of each project as its pick.
- **FR:daily.done** (P1): Ranker MUST mark a project done when a Stack commit of today completes, rolls or removes one of its tasks.
  - **FR:daily.done.edit** (P1): Ranker MUST mark a project done when one of its checked owner rows changed today.
  - **FR:daily.done.day** (P1): Ranker MUST start today at midnight in the configured time zone.
  - **FR:daily.done.history** (P2): Ranker MUST mark a project not done when the storage keeps no line history.
- **FR:daily.order** (P1): Ranker MUST list the projects in the order of their picks, then the projects with no pick.
- **FR:daily.cli** (P1): CLI MUST print one line per project as `<name> done=yes|no <ref> <text>`, with `-` for no pick.
  - **FR:daily.cli.alone** (P2): CLI MUST reject `--daily` with `--top`, `--engine` or `--explain`.
- **FR:daily.web** (P1): Home MUST show `done today` or `not yet today` on each project row.
- **FR:daily.output** (P1): Daily row (@req FR:$daily-row) — one per project

### FR:proof: Prove the order on the owner's priorities

Owner needs a test on his real priorities so that the order cannot drift.

- **FR:proof.fixture** (P1): Fixture MUST hold the owner's 12 priorities with the notes of 2026-11-17.
- **FR:proof.top** (P1): Test MUST show the actions of priorities 2, 3, 4, 6, 7 and 10 as the `stack next --top 6` rows, in order.
- **FR:proof.backlog** (P1): Test MUST show that no blog backlog or sweep row ranks above an action row.

## Data Model

- **FR:$pri-day** (P1): **`Pri` day fields** — `slot` (whole number 0-99, optional), `days` (optional map of `mon`..`sun` to a slot or `off`).
- **FR:$daily-row** (P1): **`DailyRow`** — `project`, `name` (file name), `done` (done today), `pick` (`ref`, `text`; optional).
- **FR:$pri-action** (P1): **`PriAction`** — `id` (priority id), `rank` (1 is highest), `title`, `text` (the action), `score` (the priority boost).

## Architecture Constraints

- Actions come from `pris.json` notes only. No new CoS file, no task file edits.
- The order is a pure function of the ranked rows and the priorities.

## External Dependencies

None
