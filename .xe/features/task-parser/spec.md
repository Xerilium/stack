---
id: task-parser
title: Task Parser
author: flanakin
description: "Parse project markdown into a task tree and serialize it back byte-for-byte."
dependencies: []
---

<!-- markdownlint-disable single-title -->

# Feature: Task Parser

## Purpose

Read a project markdown file into a task tree and write it back without changing a byte, so Stack can edit task state safely in files people also edit by hand.

## Scope

- In: title, metadata bullets, sections, task tree, notes, checkbox toggling, lossless round-trip.
- Non-goals: task text semantics (dates, emoji, scoring), adding/removing/moving tasks, file I/O, nested `###` sub-sections, `*`/`+` bullets.
- `Task`, `Section`, and `Project` types are provisional until the task-model slice unifies them.

## Scenarios

### FR:parse: Parse project structure

- **FR:parse.@function** (P1): Interface: `parseProject(src: string): Project`
- **FR:parse.title** (P1): `parseProject` MUST read the first `# ` heading as the title
- **FR:parse.metadata** (P1): `parseProject` MUST read `- **Key:** value` bullets before the first `##` heading as metadata
- **FR:parse.sections** (P1): `parseProject` MUST read each `## ` heading as a section holding its tasks
- **FR:parse.tree** (P1): `parseProject` MUST nest tasks by indentation under the nearest shallower task
  - **FR:parse.tree.tabs** (P2): Tabs MUST count as 4 columns for depth and note ownership only; line text is never altered
  - **FR:parse.tree.orphan** (P2): Tasks before the first `##` heading are NOT parsed as tasks; the lines are preserved for round-trip

### FR:task: Task shape

- **FR:task.state** (P1): A task MUST record checkbox state (`[ ]` unchecked; `[x]`/`[X]` checked), text, children, line index, and depth
- **FR:task.notes** (P1): Indented non-checkbox lines, including blockquote notes (`> text`), MUST attach as trimmed notes to the nearest shallower task

### FR:roundtrip: Lossless round-trip

- **FR:roundtrip.exact** (P1): `serializeProject(parseProject(x)) === x` for any input: BOM, CRLF/LF mix, tabs, no trailing newline, empty string, and unknown lines (`### sub`, prose, `* [ ]`)

### FR:mutate: Mutations

- **FR:mutate.set-checked** (P1): `setChecked` MUST change only the target line's checkbox, preserving line endings and all other bytes
