---
id: task-asks
title: Asks as Tasks
author: flanakin
description: "An ask is a nested 🙋 task under the task it blocks. One store for tasks and asks; the ask API keeps its shape."
dependencies: [ask-queue, task-ids, task-parser, task-structure]
---

<!-- markdownlint-disable single-title -->

# Feature: Asks as Tasks

> Status: built (PR 3 of 3). The ask files, `tasks/.stack/asks/`, and the old ask code are deleted in a later PR.

## Purpose

Asks live in a second store today (`.stack/asks/<key>.md`), apart from the task they block. An ask is a human step of a task. It must sit under that task, in the same file, so one read shows the work and what blocks it.

## Scope

- In: the ask-as-task format, reading and writing asks as tasks behind the current ask core (`putAsk`, `answerAsk`, `handleAsk`, `listAsks`, `archiveAsks`), a one-time import of open ask files.
- Out: deleting `.stack/asks/` and its code (later PR); API, MCP, CLI, and web changes (they keep the `ask-queue` contract).

## Ask format

An ask is a task row with the human-blocker emoji 🙋 (`HUMAN_MARK`), nested under the task it blocks. Its text is the ask. Its ID slug is the ask key, so the full ID is `T:<project-id>.<key>`.

```markdown
- [ ] 🚧 Ship v2
  > id: ship-v2
  - [ ] 🙋 ‼️ Approve merging PR 879 into dev
    > id: pr-879-approve
    > kind: approve
    > from: allyte-cos
    > why: Go-live is Oct 29; CI is green
    > recommend: Approve
    > default: Merges Oct 29 8:00am
    > by: 2026-10-29T15:00:00Z
    > link: https://github.com/o/r/pull/879
```

- Emoji fields stay emoji (`FR:task-ids/meta.emoji`): ask priority `crit`/`high`/`low` is 🚨/‼️/🔻 (none is `normal`); the open/done state is the checkbox.
- All other ask fields are `> key: value` metadata with the `ask-queue` names. The duration estimate is `time` (the `effort` name belongs to the effort emoji). `state` is written only when the checkbox and `answer` cannot tell it.
- Detail and thread follow the metadata as blockquote lines, so no detail line can parse as a task or as metadata:

```markdown
    > ## Detail
    > Long markdown, one line per line (`>` alone for a blank line).
    > ## Thread
    > - 2026-10-28T14:03:11Z owner: go
```

## Scenarios

### FR:format: Ask rows

The owner needs each ask stored as a task row so that one read shows the work and what blocks it.

- **FR:format.row** (P1): A task row whose text has 🙋 and whose metadata has `kind` MUST be read as an ask
  - Its key is its `id`.
- **FR:format.fields** (P1): Ask fields MUST map as in "Ask format": checkbox to state, priority to its emoji, every other field to metadata
  - State: `[x]` is `done`; `answer` without `[x]` is `answered`; else `open`.
- **FR:format.roundtrip** (P1): Writing an ask MUST change only its own row and lines; every other byte of the file stays
- **FR:format.clean** (P1): `putAsk` and `importAsks` MUST strip Stack mark emoji from the ask text (status, priority, effort, impact, and special marks; 🙋 🪄 🤖 ⏫ 📅 ⏰ 🅿️ 💤 ⭐️ 🔹 🔓 🌐; keycaps 1️⃣-5️⃣), so ask text never sets a row property; a text that is empty after the strip is refused
- **FR:format.detail** (P1): The `> ## Detail` and `> ## Thread` lines MUST be found anywhere in the ask row's subtree (outside its child rows), also after an owner note line; a write replaces them at the row's block and never duplicates them
- **FR:format.key** (P2): The ID lint (`id-slug`) MUST check an ask row's `id` against the ask key rule and name that rule in its message

### FR:place: Where an ask lives

The owner needs each ask placed under the task it blocks so that the ask sits beside its work.

- **FR:place.ref** (P1): An ask with `ref` (or a parent task ID) MUST be written as the last child of that task
- **FR:place.project** (P1): An ask with only `project` MUST be written at the end of that project's first section
- **FR:place.default** (P1): An ask with neither (email, permission asks) MUST be written at the end of the first section of `tasks/asks.md`
  - Stack creates `tasks/asks.md` with a `# Asks` title and an `## Open` section when missing.
- **FR:place.unique** (P1): A key MUST be unique across all task files
  - A put on an existing key updates that row where it is.
  - A new key equal to a task `id` in any task file MUST be refused (`LifecycleError`).
  - Uniqueness MUST be checked again at the write: a create writes against the file versions it checked, and a create that then finds the key in another row removes its own row and retries, so two creates of one key never both succeed (the second updates the first).

### FR:core: Same core contract

Every surface needs the ask core to keep its contract so that the API, MCP, CLI, and web stay unchanged.

- **FR:core.contract** (P1): The ask core MUST read and write ask rows instead of ask files, keeping inputs, outputs, errors, and scores (`FR:ask-queue/*`)
  - Ask core: `putAsk`, `answerAsk`, `handleAsk`, `listAsks`, and `archiveAsks`.
- **FR:core.archive** (P2): `archiveAsks` MUST delete the rows (with their lines) of `done` asks older than `days`, in one write; git history keeps them. An ask whose subtree holds an open row or any line that is not its own (an owner note, a child row) MUST be skipped. `removeCompleted` MUST NOT delete ask rows; archive owns their age rule
- **FR:core.reads** (P3): `putAsk`, `answerAsk`, and `handleAsk` MUST read the task files once per write attempt (a create adds one read for its key check, `FR:place.unique`); `resolveThreads` MUST use one ask listing, not one read per ask
- **FR:core.wake** (P2): Wake files keep working (`FR:ask-queue/wake.*`)

### FR:rank: Asks are not ranked tasks

- **FR:rank.skip** (P1): Ask rows (and their subtrees) MUST NOT rank or count as tasks: not in `rankStack`/`nextTask`, the summaries, the human checkpoint count, or the daily done check. They show only in the ask queue. A file with only ask rows (`tasks/asks.md`) adds no ranked tasks

### FR:import: One-time import

The owner needs open ask files turned into ask rows once so that no open ask is lost.

- **FR:import.cmd** (P1): `stack asks import [--dry-run]` MUST turn each open or answered ask file into an ask row (`FR:place.*`) in one write
  - The command leaves the ask files in place.
- **FR:import.idempotent** (P1): A key already present as a row MUST be skipped

## Data Model

None (ask fields are in "Ask format")

## Decisions

- **Ask keys as IDs**: an ask row's `id` keeps the ask key rule (`[a-z0-9][a-z0-9._-]{0,79}`), not the task slug rule (`[a-z0-9]+(-[a-z0-9]+)*`, up to 40). So every existing key (`perm-<session>-<request>`, `mail-<hash>`, keys with `.` or `_`) stays valid with no rename. The ID lint (`id-slug`) accepts that rule on ask rows only (🙋 with `kind`). A key that is not a slug is not a `T:` ref target; the ID index keeps slugs only.
- **Row layout**: the row is `- [ ] 🙋 <priority emoji> <ask>`. Metadata follows in a fixed order, and empty or default values are not written (`reversible` only when `yes`, `blocks` only when above 0). Unknown metadata keys are kept.
- **Placement edge cases**: a `ref` row that is gone, or a project file with no `## ` section, falls through to the next rule. `tasks/asks.md` without a `## ` section gets an `## Open` section.
- **Archive**: deletes the row with its whole subtree, only when the subtree is the ask's own lines.
- **Known limit**: inserting or deleting ask rows shifts the `project:line` refs of rows below the edit. Refs move to `T:` IDs in a later PR.
- **Watcher**: the watcher classes do not change. The web page reloads asks on a `tasks` change too, because ask rows are task file lines.

## Architecture Constraints

- Reuse `parseProject`, the `task-ids` metadata parser, and `writeAll`. No second ask parser.
- Asks are read from the same file reads as tasks (one store).

## External Dependencies

None
