---
id: task-lifecycle
title: Task Lifecycle
description: Start, complete, skip/park, resume, suspend, set-properties, remove-completed, add-project, add-task, start-date and suspend sweeps, and next-task selection over parsed task documents
dependencies: [scoring-engine, recurring-rows, task-parser, storage-git, config]
---

<!-- markdownlint-disable single-title -->

# Feature: Task Lifecycle

## Purpose

Give every surface (CLI, API, MCP) one tested set of operations that change task files the way the legacy PowerShell Stack does, so the rebuild can replace it. Edits touch only the edited lines; every other byte stays as it was.

Legacy parity target: `Start/Complete/Skip/Suspend/Resume-StackTask`, `Remove-StackCompletedTasks`, `Add-StackProject`, `Set-Task`, `Update-TaskStartDates`, `Update-TaskDates`. `add-task` is new. `Update-TaskDates` due-date (`📅`) escalation is included.

## Scenarios

### FR:doc: Documents and storage

- **FR:doc.load** (P1): Operations MUST read task files through the `Storage` interface and parse them with the task parser. A task is addressed by `TaskRef { path, line }` (0-based line index in the file)
- **FR:doc.lossless** (P1): A write MUST change only the edited lines (or removed/inserted ones). All other bytes (BOM, CRLF, trailing whitespace, unknown lines) MUST be identical
- **FR:doc.crlf** (P1): Edited lines MUST keep their original line ending; inserted lines MUST use the file's line ending
- **FR:doc.version** (P1): Writes MUST pass the version read as `expectedVersion`, so a concurrent change surfaces as `ConflictError` and nothing is overwritten
- **FR:doc.noop** (P2): An operation that produces identical content MUST NOT write
- **FR:doc.target** (P1): Operations that act on "the current task" take an optional `TaskRef`; when omitted they act on the result of `nextTask`. A ref that is not a task line MUST throw `LifecycleError`
- **FR:doc.guard** (P1): `TaskRef` has an optional `text` (the task text after the checkbox). When present, an operation MUST throw `ConflictError` if the row at `line` no longer has that text (whitespace-collapsed compare), changing nothing. `nextTask`, `addTask`, and edit results fill `ref.text`
- **FR:doc.result** (P1): Operations MUST return `{ changed, ref?, before?, after?, message? }`; when nothing applies (no tasks, already in state) they return `changed: false` with a message and MUST NOT throw
- **FR:doc.json** (P1): A surface that prints a lifecycle result as JSON (`--json`) MUST add `command` (canonical name: `park` is `skip`), `project` (base name of `ref.path` without `.md`), and `text` (task text after the checkbox, from `after`) to the `FR:doc.result` fields, and `ref.line` MUST be 1-based. A no-op keeps `command` and `project` when a ref exists

### FR:next: Next-task selection

- **FR:next.@function** (P1): Interface: `nextTask(ctx, at?): Promise<NextTask | null>` where `NextTask = { ref, text, project, score }`
- **FR:next.rank** (P1): MUST return the first task of `rankStack` (`FR:rank.order`), so `nextTask`, `GET /next`, `stack next`, and the web Home never disagree
- **FR:next.map** (P1): The returned `ref` MUST point at the exact line of the scored task (Active section only, unchecked rows only, as the scoring adapter sees them)
- **FR:next.none** (P1): MUST return `null` when no task qualifies

### FR:rank: Ranked tasks

Owner needs one ranked list of what to do next so that the CLI, the API, the `/next` skill, and the web Home all show the same order.

- **FR:rank.@function** (P1): Interface: `rankStack(ctx, at?, limit?, opts?): Promise<RankedTask[]>`
- **FR:rank.order** (P1): `rankStack` MUST return the highest-scoring leaf, non-parked tasks across all project files, using the scoring engine named by `ctx.engine` (default `stack`) and its time-block filter at `at` (default now), then apply the owner's overrides
  > - @req FR:scoring-engine/rank.order
  > - @req FR:scoring-engine/overrides.tiers
- **FR:rank.overrides** (P1): `rankStack` MUST read overrides from `.stack/priorities.json` in the storage (absent or unreadable means none) and MUST keep the rows of a `top` rule in the ranking even when the time block would hide them
  > - @req FR:scoring-engine/overrides.invalid
- **FR:rank.blocks** (P2): With `opts.ignoreBlocks`, `rankStack` MUST NOT drop tasks the current time block would hide (a surface that places tasks across the whole day), keeping the due-date lens, the overrides, and the order otherwise
- **FR:rank.limit** (P2): `rankStack` MUST return at most `limit` tasks when given
- **FR:rank.root** (P1): `rankStack` MUST give each task under a parent its top-level row (`root`), so a surface that shows top-level rows groups the leaves without parsing the files itself
- **FR:rank.owner** (P1): `rankStack` MUST return only rows the owner must do: the owner queue that Now, My day, `stack next` and `stack rank` show. Ancestors come from the parsed Markdown tree of the Active section (checked rows included; any indent width). The owner of a row, first match wins: its own mark (`🙋` is the owner; `🤖` or `🪄` is an agent; the `🤖:level` autonomy marker is not a mark), else the nearest ancestor with exactly one kind of mark (an ancestor with both is skipped), else the owner. A row with both marks is mixed and is not the owner's. So an agent row and the unmarked rows under it never rank, and an open `🙋` row under an agent row does. `opts.owner: 'any'` keeps rows of every owner
- **FR:rank.stale** (P1): A row is stale when its `📅` date is 3 or more days past and no commit changed the row in the last 3 days (`FR:storage-git/git.activity`). A stale row gets due tier 0, a final score of at most 500 (`STALE_CAP`) after inherited scores and every other boost, and carries `stale`. When the storage gives no line activity for the row, the row is never stale
- **FR:rank.explain** (P2): `explainStack(ctx, at?, opts?)` MUST give, per ranked task, its rank, ref, score, and why it has that place: the due tier and days, and for a stale row the overdue days, the last commit date, tier 0 and the cap. It also counts the rows the owner filter dropped (`FR:rank.owner`). `stack rank --explain` prints it for the `stack` engine
- **FR:rank.output** (P1): List of ranked tasks (@req FR:$ranked-task)

### FR:start: Start

- **FR:start.status** (P1): `startTask` MUST add `🚧` (after a leading priority emoji, else at the start), remove other status emojis, remove any `💤` suspend marker, and collapse whitespace on the task text (legacy `Set-Task`)
- **FR:start.already** (P1): A task already carrying `🚧` MUST be left unchanged (`changed: false`). A checked `[x]` row MUST also be left unchanged

### FR:complete: Complete

- **FR:complete.check** (P1): `completeTask` MUST set `[x]`, remove status emojis (`🚧 ⏸️ 👀 ⏳ ⛔️`) and any `💤` marker, and collapse whitespace
- **FR:complete.already** (P1): An already-checked task MUST be left unchanged
- **FR:complete.summary** (P2): With `summary`, a `> Prompt:` note line under the task is replaced by `{indent}> ✅ **COMPLETED**: {summary}`; with no prompt line, `{task indent}  > ✅ **COMPLETED**: {summary}` is inserted right after the task line. The prompt search stops at the next task or heading line
- **FR:complete.remove** (P2): With `remove: true`, the task line and all following blank or deeper-indented lines are deleted instead (a `🔄` row that rolls is rolled, not deleted; see FR:complete.recurring)
- **FR:complete.recurring** (P1): A `🔄` recurring row MUST roll in place using `rollRecurring` with `config.shiftWeekends` (block = the row plus its nested lines): the row stays unchecked with its next due date, `result.rolled` is `true`, and the row is never deleted, including with `remove: true` (the roll takes precedence). If `rollRecurring` returns `null` the row completes normally

### FR:skip: Skip / park

- **FR:skip.park** (P1): `skipTask` MUST prefix the task text with `🅿️ ` without any other change (no whitespace collapse); it only applies to unchecked rows
- **FR:skip.already** (P1): A task already carrying `🅿️` MUST be left unchanged
- **FR:skip.alias** (P3): `parkTask` is an alias of `skipTask`

### FR:resume: Resume

- **FR:resume.first** (P1): `resumeTask` MUST pick the first `🅿️` task in file order (files sorted, Active section order) when no ref is given
- **FR:resume.remove** (P1): It MUST remove a leading `🅿️` and the whitespace after it, changing nothing else. A `🅿️` that is not at the start of the text leaves the line unchanged with a warning message
- **FR:resume.none** (P1): With no parked task it MUST return `changed: false`

### FR:suspend: Suspend

- **FR:suspend.marker** (P1): `suspendTask` MUST write `💤 {when}: ` at the start of the task text, replacing any earlier marker, without collapsing whitespace
- **FR:suspend.days** (P1): `days` (default 1, 1-365) gives `MMM d` for now plus N days
- **FR:suspend.hours** (P1): `hours` (1-8760) gives `HH:mm` when the target is still today, else `MMM d HH:mm`. More than 24 hours converts to days plus remainder hours (an exact multiple of 24 becomes days only)
- **FR:suspend.clock** (P1): Dates and times use the wall clock in `config.timezone`
- **FR:suspend.already** (P1): A suspended or checked task MUST be left unchanged
- **FR:suspend.validate** (P1): Giving both `days` and `hours`, or out-of-range values, MUST throw `LifecycleError`

### FR:set: Set properties

- **FR:set.props** (P1): `setProperties(ctx, ref, props)` supports `status`, `priority`, `effort`, `impact` (an emoji from that category or `'None'` to clear), `checkbox` (`'Complete' | 'Incomplete'`), `suspend` (`''` clears), and `removeAllEmojis`, with legacy `Set-Task` placement rules. Setting `effort` also replaces or clears the `🔹` (12 min) mark quick capture writes
- **FR:set.placement** (P1): Priority goes first; status goes after a leading priority emoji; effort goes before a trailing impact emoji, else last; impact goes last. Emojis of the same category are replaced
- **FR:set.invalid** (P1): Unknown emojis for a category MUST throw `LifecycleError`

### FR:remove: Remove completed

- **FR:remove.blocks** (P1): `removeCompleted` MUST delete every `- [x] ` row (any section, any depth) with all following blank or deeper-indented lines, in all files or only `opts.project` (file base name)
- **FR:remove.count** (P1): The result reports `removed` task count and the files changed. Unchanged files are not written
- **FR:remove.missing** (P2): An unknown `opts.project` MUST throw `LifecycleError`

### FR:project: Add project

- **FR:project.file** (P1): `addProject` MUST create `tasks/{kebab-name}.md` (or `fileName`) from the legacy template: title, optional description, `Repository`, `Aliases`, `Project priority`, and `{Block} capacity` metadata bullets, then the Active, Up next, and Backlog sections each with an empty `- [ ] ` row
- **FR:project.capacity** (P2): Capacity for a block name not in `config.timeBlocks` is skipped. `weeklyCapacity` alone means `Work` capacity
- **FR:project.exists** (P1): An existing file MUST NOT be overwritten unless `force: true`; otherwise `ConflictError`
- **FR:project.name** (P1): A name with no usable filename characters MUST throw `LifecycleError`

### FR:add: Add task

- **FR:add.insert** (P1): `addTask` MUST add `- [ ] {text}` at the end of the project's section (default Active, matched case-insensitively by heading text), after the last existing task block
- **FR:add.placeholder** (P2): An empty top-level `- [ ] ` placeholder row in that section is filled instead of adding a new row
- **FR:add.parent** (P2): With `parent`, the row is added as the last subtask of that task, indented 2 more spaces
- **FR:add.invalid** (P1): Empty text, unknown project, or unknown section MUST throw `LifecycleError`

### FR:sweep: Start-date and suspend sweeps

- **FR:sweep.start** (P1): `sweepStartDates` MUST remove every `⏰ Mon D: ` marker whose date is today or earlier (a date more than six months ahead counts as last year) and report the count; unparseable dates are skipped
- **FR:sweep.suspend** (P1): `sweepSuspended` MUST remove `💤 {when}: ` from unchecked rows whose time has passed. Date-only uses `config.startOfDay`; time-only means today; all in `config.timezone`
- **FR:sweep.year** (P1): Suspend (`💤`) and due (`📅`) dates without a year resolve to the occurrence nearest to now (previous, current, or next year), so `💤 Jan 4:` written on Dec 30 waits for next January and a Dec 30 date seen on Jan 2 counts as past
- **FR:sweep.due** (P1): `sweepDueDates` escalates unchecked rows carrying `📅 Mon D:` (the label stays) by days until due: 1 to 3 days ahead gets `🔺` (kept if `‼️`/`🚨` is present); due today to 2 days overdue gets `‼️` (kept if `🚨`); 3+ days overdue gets `🚨`. Any other priority emoji (`🔺 ‼️ 🚨 🔻`) is replaced, the new one goes first, whitespace collapses. Rows with a lower escalation than they already hold, and rows more than 3 days out, are untouched
- **FR:sweep.due-move** (P2): A top-level row escalated to `‼️` or `🚨` in the `⏭️ Up next` or `📋 Backlog` section moves, with its nested lines, to the top of the Active task list (before the first Active task row; at the end of Active when it has none). Legacy moved only the single line above the section text; this keeps the block together
- **FR:sweep.all** (P2): `sweep` runs start, suspend, and due sweeps and writes all changed files in one multi-file write (one commit)

## Data Model

- **FR:$ranked-task** (P1): **`RankedTask`** — One ranked task.
  - `ref` (TaskRef) — the exact line (`FR:next.map`)
  - `text` (string) — row text
  - `project` (string)
  - `score` (number) — the engine score
  - `rule` (string?) — the matching override's `match`, when one applied
  - `root` (TaskRef?) — the top-level row it sits under
  - `stale` ({ overdueDays, lastActivity }?) — set when the row is stale (`FR:rank.stale`); `lastActivity` is the ISO time of the last commit that changed the row. CLI and API rank items show it as `stale: true`

## Architecture Constraints

None

## External Dependencies

None

## Intentional Legacy Differences

Legacy behavior is the contract for the tasks-only migration. These differences are deliberate; the parity harness (flanakin/todo `npm run parity`) will show them, and they are not bugs.

- **Target task**: Legacy `start`, `complete`, `skip`, and `suspend` act on the "Top of the stack" row that the last `Update-StackSummary` wrote to README.md. Stack acts on `nextTask` (`FR:next.rank`): the live `rankStack` at `--now`, with the owner overrides. Why: the README goes stale as time blocks change, and the CLI, API, `/next`, and the web Home must pick the same task. The parity run started `12 Days` (legacy, stale README) and the Amex payment row (Stack, which the refreshed legacy README also ranked first). The README and `stack next` also named different rows on a current README (issue 136): `update` used the `legacy` engine, ignored `.stack/priorities.json`, and showed the first step of an outcome, not its highest-ranked step. Now `update` uses the `stack` engine by default (`FR:cli/cmd.update.engine`). So the README top is the row that a no-ref `start`, `complete`, or `skip` acts on. The two differ only when the clock, a task file, or `.stack/priorities.json` changes after the last update. Why one engine: no-ref commands that read the README would split `start` from `stack next`, the API, and the web Home. The summaries now show `stack` scores and order, not legacy ones. The parity harness must run `update --engine legacy` before it compares the summaries. It passes the legacy README top row as an explicit ref to `start`, `complete`, and `skip`, so the other differences show.
- **Nested due-date rows**: Legacy `Update-TaskDates` moved an escalated `‼️`/`🚨` row of any depth to the top of Active as a bare line. That orphaned the row, left a blank line, and left its subtasks behind. Stack moves only top-level rows, with their block (`FR:sweep.due-move`); a nested row escalates in place under its parent. The parity run shows this as `11 urgent` (legacy) vs `10 urgent` (Stack): a nested `🚨 📅 Nov 6` row stayed under its Up next parent.
- **Query refresh after a command**: Legacy refreshed every `🔎` query after each command. Stack does it only with `--queries` (`FR:cli/cmd.refresh`), like `update` (`FR:cli/cmd.update.queries`). Why: it uses the network and is slow (legacy update took minutes on the real task repo). The parity harness must pass `--queries` to compare query rows.
- **Recurring rows on complete**: Legacy `complete` checked a `🔄` row and left it checked. Stack rolls it in place to the next due date (`FR:complete.recurring`). The parity run shows this as `[x] 📅 Nov 19` (legacy) vs `[ ] 📅 Dec 21 <!--nominal:2026-12-19-->` (Stack). The summaries then differ where that row ranks.
- **Tied scores**: Legacy sorted with `Sort-Object -Descending`, which does not keep the input order for equal scores. Stack keeps file order for ties (`FR:scoring-engine/rank.order`). The parity run shows this as swapped rows with equal `🟰` scores in projects.md and stack.md.
