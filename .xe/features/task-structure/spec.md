---
id: task-structure
title: Task Structure
author: flanakin
description: "Read task files from a folder tree under tasks/, keep system files in .stack/ folders, and name each project by path."
dependencies: [agent-inbox, agent-team, ai-triage-assist, api, ask-queue, storage-git, task-parser]
---

<!-- markdownlint-disable single-title -->

# Feature: Task Structure

## Purpose

The owner groups goals by company and product in folders (`tasks/xerilium/stack/goal.md`). Stack must read every level, keep its own files out of the task list, and give each goal one stable ID.

## Scope

- In: recursive task listing, `.stack/` system folders at any level, path-based project IDs, refs and agent scopes with nested IDs, repo discovery.
- Out (this slice): task IDs, `stack ids assign`, task metadata (see Next slices), frontmatter scoring, Catalyst spec mapping, a derived aggregate cache, UI redesign.
- No compatibility with the old plain folders (`tasks/asks`, `tasks/agents`, `tasks/logs`, `tasks/inbox`, `tasks/wake`). Migration: `docs/task-structure-migration.md`.

## Scenarios

### FR:tree: Folder tree

The owner needs Stack to read task files at every folder level so that goals can be grouped by company and product.

- **FR:tree.list** (P1): `list` MUST return the sorted paths of every `.md` file under `tasks/` at any depth
- **FR:tree.dot** (P1): `list` MUST skip every file and folder whose name starts with `.` (this skips every `.stack/` folder)
- **FR:tree.path** (P1): Storage MUST accept a task path at any depth when no segment starts with `.` (`..` is thus never valid)
- **FR:tree.symlink** (P1): `FsStorage.list` MUST NOT follow a symlinked folder or file at any depth
- **FR:tree.readme** (P2): A `README.md` at any level is never a project
- **FR:tree.discover** (P2): Repo discovery MUST accept a git repo whose `tasks/` folder holds a `.md` file at any depth

### FR:id: Project IDs

The owner needs each project named by its path so that nested goals get stable, distinct IDs.

- **FR:id.project** (P1): A project ID MUST be its path relative to `tasks/` without `.md` (`tasks/xerilium/stack/goal.md` is `xerilium/stack/goal`; `tasks/alpha.md` stays `alpha`)
  - **FR:id.project.repos** (P3): A project's repo folder names MUST start with its file name, then its folder name (`goal`, `stack`)
  - **FR:id.project.review** (P3): Review ask keys MUST keep nested IDs apart (`a/b` and `a-b` never share a key)
- **FR:id.ref** (P1): An API ref `<project-id>:<line>` MUST accept a nested ID; a ref whose last segment is `README` (any case) is invalid
- **FR:id.scope** (P2): An agent scope MUST accept a nested ID
  - Scope `a/b` covers project `a/b`, every project under folder `a/b/`, and section `b` of project `a`.
  - Most specific first: project section, project, folder, `*`.

### FR:system: System folders

The owner needs Stack system files kept apart from task files so that they never show up as tasks.

- **FR:system.path** (P1): Stack system files MUST live in a `.stack/` folder at any level under `tasks/`: `<dir>/.stack/{asks,asks/archive,agents,logs,inbox,wake}/<name>.md`, same name rules as before
- **FR:system.list** (P1): `listAsks` and `listAgents` MUST return the files from every `.stack/` level, sorted
- **FR:system.beside** (P1): A project's result logs and inbox MUST live in the `.stack/` folder beside the project file
  - Example: `tasks/a/b.md` uses `tasks/a/.stack/logs/b.md` and `tasks/a/.stack/inbox/b.md`.
- **FR:system.root** (P1): Stack MUST write new asks, agent files, wake files, and the session log in `tasks/.stack/`
  - An existing ask or agent file at any level is updated where it is.
- **FR:system.ask-key** (P1): An ask key MUST resolve to its file at any level
  - A key in more than one folder resolves to the first path in sort order.
  - Archive moves an ask to `archive/` in its own `.stack/` folder.
  - Superseded by `FR:task-asks/place.unique` (an ask key resolves to its row; the first task file in sort order wins) and `FR:task-asks/core.archive`.
- **FR:system.watch** (P2): The file watcher MUST report a change under any `tasks/**/.stack/asks/` folder as `asks`

## Next slices

- PR 2: task IDs, `stack ids assign`, blockquote metadata, `stack mv`, lint (`.xe/features/task-ids/spec.md`).
- PR 3: asks as nested 🙋 tasks (`.xe/features/task-asks/spec.md`).
- Until PR 3, asks stay files in `.stack/asks/` (a stopgap).

## Data Model

None

## Architecture Constraints

- One module (`src/core/task-paths.ts`) owns every task and system path rule. Other modules call it; none build `tasks/...` strings by hand.
- Breaking change. No shims for the old folders.

## Dependencies

- `storage-git`: list, read, write, path validation.
- `ask-queue`, `agent-team`, `agent-inbox`, `ai-triage-assist`: system file paths.
- `api`: `FR:api/input.ref`.

## External Dependencies

None
