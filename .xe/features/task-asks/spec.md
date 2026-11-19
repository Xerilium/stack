---
id: task-asks
title: Asks as Tasks
author: flanakin
description: "An ask is a nested 🙋 task under the task it blocks. One store for tasks and asks; the ask API keeps its shape."
dependencies: [task-structure, task-ids, ask-queue, task-parser]
---

<!-- markdownlint-disable single-title -->

# Feature: Asks as Tasks

> Status: planned (PR 3 of 3; build after `task-ids`). The ask files, `tasks/.stack/asks/`, and the old ask code are deleted in a later PR.

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
- All other ask fields are `> key: value` metadata with the `ask-queue` names. The duration estimate is `time` (the `effort` name belongs to the effort emoji).
- `## Detail` and `## Thread` content becomes indented lines under the metadata.

## Scenarios

### FR:format: Ask rows

- **FR:format.row** (P1): A task row whose text has 🙋 and whose metadata has `kind` MUST be read as an ask; its key is its `id`
- **FR:format.fields** (P1): Ask fields MUST map as in "Ask format": checkbox to state (`[x]` is `done`; `answer` without `[x]` is `answered`; else `open`), priority to its emoji, every other field to metadata
- **FR:format.roundtrip** (P1): Writing an ask MUST change only its own row and lines; every other byte of the file stays

### FR:place: Where an ask lives

- **FR:place.ref** (P1): An ask with `ref` (or a parent task ID) MUST be written as the last child of that task
- **FR:place.project** (P1): An ask with only `project` MUST be written at the end of that project's first section
- **FR:place.default** (P1): An ask with neither (email, permission asks) MUST be written at the end of the first section of `tasks/asks.md`, created with a `# Asks` title and an `## Open` section when missing
- **FR:place.unique** (P1): A key MUST be unique across all task files; a put on an existing key updates that row where it is

### FR:core: Same core contract

- **FR:core.contract** (P1): `putAsk`, `answerAsk`, `handleAsk`, `listAsks`, and `archiveAsks` MUST keep their inputs, outputs, errors, and scores (`FR:ask-queue/*`) and read and write ask rows instead of ask files
- **FR:core.archive** (P2): `archiveAsks` MUST check the row (`[x]`); removal of checked rows stays with `stack remove-completed`
- **FR:core.wake** (P2): Wake files keep working (`FR:ask-queue/wake.*`)

### FR:import: One-time import

- **FR:import.cmd** (P1): `stack asks import [--dry-run]` MUST turn each open or answered ask file into an ask row (`FR:place.*`), in one write, and leave the files in place
- **FR:import.idempotent** (P1): A key already present as a row MUST be skipped

## Architecture Constraints

- Reuse `parseProject`, the `task-ids` metadata parser, and `writeAll`. No second ask parser.
- Asks are read from the same file reads as tasks (one store).
