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

### FR:next: Next-task selection

- **FR:next.@function** (P1): Interface: `nextTask(ctx, at?): Promise<NextTask | null>` where `NextTask = { ref, text, project, score }`
- **FR:next.rank** (P1): MUST return the highest-scoring leaf, non-parked task across all project files, using the scoring engine named by `ctx.engine` (default `legacy`) and its time-block filter at `at` (default now)
- **FR:next.map** (P1): The returned `ref` MUST point at the exact line of the scored task (Active section only, unchecked rows only, as the scoring adapter sees them)
- **FR:next.none** (P1): MUST return `null` when no task qualifies

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

- **FR:set.props** (P1): `setProperties(ctx, ref, props)` supports `status`, `priority`, `effort`, `impact` (an emoji from that category or `'None'` to clear), `checkbox` (`'Complete' | 'Incomplete'`), `suspend` (`''` clears), and `removeAllEmojis`, with legacy `Set-Task` placement rules
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
