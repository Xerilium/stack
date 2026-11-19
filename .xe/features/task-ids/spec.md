---
id: task-ids
title: Task IDs and Metadata
author: flanakin
description: "Give each task a readable, path-qualified ID, read blockquote metadata under a task, and move project files without breaking refs."
dependencies: [cli, task-lint, task-parser, task-structure]
---

<!-- markdownlint-disable single-title -->

# Feature: Task IDs and Metadata

> Status: built (PR 2 of 3).

## Purpose

Line numbers break on every edit. A task needs one stable, readable ID that people and agents can cite (`@req T:xerilium/stack/goal.ship-v2`), that Stack can resolve, and that survives a file move.

## Scope

- In: the task ID format, `stack ids assign`, the ID index, blockquote metadata, `stack mv`, lint for dangling and duplicate IDs.
- Out: replacing `project:line` refs in the API, asks, and inbox (later, after `task-asks`); moving emoji fields into metadata.

## Task ID format

- Full ID: `T:<project-id>.<slug>`. Example: `T:xerilium/stack/goal.ship-v2`.
- The `T:` prefix is one constant (`TASK_ID_PREFIX`). Nothing else spells it.
- The file stores only the slug, as metadata under the task: `> id: ship-v2`. The project ID comes from the file path (`FR:task-structure/id.project`), so a move never edits the task line.
- A slug is `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 40 characters, unique in its project file. The full ID splits at the last `.`.

```markdown
- [ ] 🚧 1️⃣ Ship v2 🔴
  > id: ship-v2
  > agent: [Stack architect](#local_abc)
  > pr: https://github.com/Xerilium/stack/pull/313
  - [ ] 🙋 Approve the release plan
    > id: approve-release-plan
```

## Scenarios

### FR:meta: Blockquote metadata

The owner needs extra task fields as `key: value` lines under a task so that people and agents can read and set them.

- **FR:meta.parse** (P1): The parser MUST read each indented `> key: value` line directly under a task row as task metadata
  - Only consecutive lines before any other content of the task count.
  - Key: `[a-z][a-z0-9_-]*` (lint flags `_`). Value: trimmed rest of line.
- **FR:meta.model** (P1): `Task` MUST expose metadata as ordered `[key, value]` pairs
  - Unknown keys are kept. Metadata lines other than `id` also stay notes, so every reader of notes still sees them.
- **FR:meta.emoji** (P1): A field that has an emoji today MUST stay an emoji
  - Fields: priority ⭐️ and 1️⃣-5️⃣, status 🚧/⛔/💤, due 📅, start-after ⏰, effort 🔹🟢🟡🟠🔴⚫️, impact, human blocker 🙋, agent 🪄/🤖, and every other emoji in `.stack/README.md`.
  - The emoji is the source of truth; a metadata key that names such a field is ignored by the model and flagged by lint.
  - No migration.
- **FR:meta.fields** (P2): Known metadata keys: `id`, `agent` (a session link, `[Name](#local_<id>)`; overrides the inherited agent, see `goal-model`), `blocked` (`T:` IDs), and typed links, one per line: `pr`, `issue`, `mail`, `session`, `doc`, `link` (generic). The key sets how the UI renders the value and which actions show. Others are kept as unknown
- **FR:meta.retired** (P2): Lint MUST flag (as a warning) a key with `_`, and the retired keys `owner` (the default owner is the owner; a task is agent-owned only through an agent), `next` (the next action is the next subtask), `req`, and `blocked_by`
- **FR:meta.roundtrip** (P1): Reading metadata MUST NOT change a byte (`FR:task-parser/roundtrip.exact`)

### FR:id: Task IDs

The owner needs one stable, readable ID per task so that people and agents can cite a task after edits and moves.

- **FR:id.format** (P1): A task ID MUST be `T:<project-id>.<slug>`, with the prefix from one constant
- **FR:id.parse** (P1): `parseTaskId(s)` MUST return `{ project, slug }` or null; it splits at the last `.`
- **FR:id.index** (P1): `taskIndex(storage)` MUST map every full ID to `{ path, line }`, built on read from the `> id:` metadata of every task file

### FR:assign: `stack ids assign`

The owner needs IDs added to existing tasks so that every task can be cited without hand edits.

- **FR:assign.add** (P1): `stack ids assign [--project p] [--dry-run]` MUST add `> id: <slug>` directly under each task row that has none, indented one level under the row
- **FR:assign.slug** (P1): The slug MUST come from the task text without emoji, markdown, and `--` reasons
  - Format: lower case, words joined by `-`, cut at 40 characters on a word end.
  - A slug taken in the file gets `-2`, `-3`, and so on.
- **FR:assign.keep** (P1): The command MUST keep every other byte, including all nested children, notes, and line endings (CRLF stays CRLF)
- **FR:assign.idempotent** (P1): A second run MUST change nothing
- **FR:assign.commit** (P2): All changed files MUST be one write (one commit in git)

### FR:mv: `stack mv`

The owner needs to move a project file so that every ref to its tasks keeps working.

- **FR:mv.file** (P1): `stack mv <from-id> <to-id>` MUST move the project file with its logs and inbox in one write
  - Logs and inbox move to the `.stack/` folder beside the new path, renamed to the new base name.
- **FR:mv.refs** (P1): It MUST rewrite every ref to the old project in every file under `tasks/` (task files and `.stack/` files)
  - Rewrites: `T:<old>.` to `T:<new>.`, `tasks/<old>.md:` to `tasks/<new>.md:`, and `ref: <old>:<n>` to `ref: <new>:<n>`.
- **FR:mv.safe** (P1): It MUST refuse when the target exists or the source is missing, and write nothing
- **FR:mv.report** (P2): It MUST print each changed file and the count of rewritten refs; `--dry-run` writes nothing

### FR:lint: Lint

The owner needs dangling and duplicate IDs flagged so that every ref resolves to one task.

- **FR:lint.duplicate** (P1): `stack lint` MUST flag a slug used twice in one project file
- **FR:lint.dangling** (P1): `stack lint` MUST flag a `T:` ref in any task file that the index does not resolve
- **FR:lint.slug** (P2): `stack lint` MUST flag an `id` value that is not a valid slug, a metadata key that names an emoji field (`meta-emoji`, `FR:meta.emoji`), and a key with `_` or a retired key (`meta-key`, `FR:meta.retired`)
- **FR:lint.status-note** (P2): `stack lint` MUST flag (as a warning) status-note prose in a nested line of an open task (`as of`, `done`, `merged`, `shipped`, `waiting`, a date, and progress claims such as `50%` or `3/5`). State lives in emoji, git history, and the app

## Data Model

None (task metadata is ordered `[key, value]` pairs on `Task`)

## Architecture Constraints

- ID rules live in `src/core/task-ids.ts`; path rules stay in `src/core/task-paths.ts`.
- Writes go through `Storage.writeMany` (one commit).

## External Dependencies

None

## Decisions

- Store the slug only, not the full ID. A move then edits refs, never the task line itself.
- Slugs, not random short IDs: the owner chose readable IDs.
