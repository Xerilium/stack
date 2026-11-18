---
id: task-store
title: Task store
description: "SQLite holds live tasks with stable project/slug IDs; the app, CLI and MCP read and write it; md is imported once and exported on demand."
dependencies:
  [
    storage-git,
    task-model,
    task-lifecycle,
    cli,
    mcp-server,
    api,
    tailnet-access,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Task store

## Purpose

Stack answers one question: what is next. The answer comes from day-aware priorities ([179](https://github.com/Xerilium/stack/pull/179)).

Today tasks live in `tasks/*.md`. Problems:

- A task has no stable ID. Refs are path and line, so they break on each edit.
- Parsing and rewriting markdown on each write is slow and fragile.
- Generated files (`README.md`, `stack.md`, `projects.md`) cause noise and merge conflicts.

This spec replaces md storage with one SQLite file. The store holds live tasks only.

## Principles

- **P1 Live tasks only**: The store holds open work. Done means deleted. No history, no archive, no event log.
- **P2 One file, one writer host**: The Mac host owns the database. Other devices use the host.
- **P3 Views live in the app**: No generated md files. Agents read JSON. `stack export md` runs on demand only.
- **P4 md until the app is ready**: md stays the source of truth until every cutover gate passes (`FR:cutover`).

## Scenarios

### FR:store: Task store

Stack System needs one place for live tasks so that every surface reads and writes the same data by stable ID.

- **FR:store.@type** (P1): Interface: `TaskStore { list(q?): Task[]; get(id): Task; add(input): Task; update(id, patch, opts): Task; remove(id, opts): void; projects(): Project[] }`
- **FR:store.file** (P1): The store MUST be one SQLite file at `$STACK_HOME/stack.db`. It MUST use `node:sqlite` (no native npm dependency) in WAL mode with a busy timeout of 5 seconds.
- **FR:store.memory** (P1): The store MUST open on `:memory:` for tests.
- **FR:store.schema** (P1): The store MUST keep a `schema_version` and run forward migrations on open. An unknown newer version MUST refuse to open with `StoreError`.
- **FR:store.atomic** (P1): Each call MUST run in one transaction. A failed call changes nothing.

### FR:id: Task IDs

Agents and the owner need IDs that survive edits so that links and refs never break.

- **FR:id.form** (P1): An ID MUST be `{project}/{slug}`. Both parts are kebab-case, `[a-z0-9-]`, at most 60 characters each.
- **FR:id.make** (P1): `add` MUST make the slug from the first 6 words of the title. On a clash it MUST add `-2`, `-3`, and so on.
- **FR:id.stable** (P1): A title edit MUST NOT change the ID.
- **FR:id.move** (P2): `stack task mv {id} {new-id}` MUST change the ID and update every link that points to it, in one transaction.
- **FR:id.loose** (P1): A lookup MUST accept the full ID, or a slug or slug prefix that matches one task. Zero or many matches MUST throw `NotFoundError` or `AmbiguousError` with the candidates.

### FR:write: Agent and owner writes

Agents need a safe write path so that two writers never lose each other's edits.

- **FR:write.surfaces** (P1): CLI, MCP and the REST API MUST call the same `TaskStore`. The existing lifecycle verbs (`add`, `start`, `complete`, `skip`, `resume`, `suspend`, `set`, `claim`) keep their names and flags. `ref` takes a task ID.
- **FR:write.json** (P1): Every read command MUST support `--json` and give the `Task` shape (`FR:$task`).
- **FR:write.actor** (P1): Each write MUST record `updatedBy`. The actor is the API token's owner, else `STACK_ACTOR`, else `me`.
- **FR:write.rev** (P1): Each task MUST have an integer `rev`. Each write MUST add 1.
- **FR:write.expect** (P1): A write MAY give `expectRev`. When it differs from the current `rev`, the write MUST throw `ConflictError` with the current task. The caller reads again and retries.
- **FR:write.lww** (P2): A write with no `expectRev` MUST apply field by field. Only the fields in the patch change.
- **FR:write.host** (P1): When the Mac host runs, CLI and MCP MUST write through the host API. When it does not run, they MUST open the file direct. SQLite locks keep the two safe.

### FR:done: Complete and remove

The owner needs done work to leave so that the store holds only what is next.

- **FR:done.delete** (P1): `complete` MUST delete the task and its links.
- **FR:done.recurring** (P1): `complete` on a recurring task MUST roll its dates (`FR:task-model/$recurrence`) and keep the task.
- **FR:done.children** (P1): `complete` on a task with open children MUST throw `LifecycleError`, unless `--cascade` is given. `--cascade` deletes the children too.
- **FR:done.dangling** (P1): A `blocks` link to a missing ID MUST count as resolved.
- **FR:done.output** (P1): `complete --json` MUST give the deleted task, so an agent can report it.

### FR:rank: What is next

The owner needs one answer so that the app, CLI and agents agree on the next task.

- **FR:rank.source** (P1): `stack next`, `GET /api/next` and `GET /api/rank` MUST read tasks from the store and rank them with the pri-first order of [179](https://github.com/Xerilium/stack/pull/179).
- **FR:rank.activity** (P1): Rules that use the last change of a task (stale cap, activity) MUST use `updatedAt`, not `git blame`.
- **FR:rank.parity** (P1): For the same tasks, the store ranking MUST equal the md ranking.

### FR:sync: Devices

The owner needs the phone to show and change the same tasks so that work does not wait for the Mac.

- **FR:sync.host** (P1): The phone MUST use the Mac host over the tailnet (`tailnet-access`). The phone holds no copy of the database.
- **FR:sync.offline** (P2): When the host does not answer, the phone MUST show the last list it got, marked `Offline since h:mm`, read-only.
- **FR:sync.live** (P2): The host MUST push a change signal (existing SSE or Web Push) after each write, so open views refresh.

### FR:backup: Snapshot backup and restore

The owner needs a copy of the store so that a bad write or a lost disk costs at most one interval.

- **FR:backup.snap** (P1): The host MUST write a snapshot every 60 minutes and on host stop, with `VACUUM INTO`, to `$STACK_HOME/backups/stack-{yyyyMMdd-HHmm}.db`. It MUST skip the snapshot when nothing changed.
- **FR:backup.copy** (P2): When `backup.dir` is set (for example iCloud Drive), the host MUST also copy the snapshot there.
- **FR:backup.keep** (P2): The host MUST keep the last 48 snapshots and delete older ones.
- **FR:backup.restore** (P1): `stack restore [file]` MUST stop writes, keep the current file as `stack.db.before-restore`, and put the latest (or given) snapshot in place.
- **FR:backup.list** (P2): `stack backups` MUST list snapshots with time and task count.

### FR:import: One-time md import

The owner needs the current tasks moved over once so that nothing is lost at cutover.

- **FR:import.run** (P1): `stack import md [--dry-run]` MUST parse `tasks/*.md` with the current parser and write every open task, with its fields, notes, children and links.
- **FR:import.ids** (P1): Import MUST make IDs per `FR:id.make`, with the project from the file name.
- **FR:import.report** (P1): Import MUST print counts per project, every row it could not map, and every duplicate slug it renamed. `--dry-run` writes nothing.
- **FR:import.once** (P1): Import into a store that holds tasks MUST refuse, unless `--replace` is given. `--replace` is for the shadow stage only (`FR:cutover.shadow`).
- **FR:import.done** (P1): Import MUST skip done rows (`- [x]`).

### FR:export: md on demand

The owner needs a way back to md so that a failed cutover is never a dead end.

- **FR:export.run** (P1): `stack export md [--out dir]` MUST write one file per project in the current md format, readable by the current parser.
- **FR:export.roundtrip** (P1): `import md` of the export MUST give the same tasks, fields and links (IDs excepted when slugs clash).
- **FR:export.json** (P2): `stack export json` MUST write all tasks as one JSON array.

### FR:cutover: Stages and gates

The owner needs the app to be good enough before md stops so that he never loses his view of the work.

- **FR:cutover.stages** (P1): Cutover MUST go in this order. A stage starts only when the gates of the one before it pass.

  | Stage       | Source of truth | md                                    | Store                                     |
  | ----------- | --------------- | ------------------------------------- | ----------------------------------------- |
  | 0 Build     | md              | Read and write                        | Not used                                  |
  | 1 Shadow    | md              | Read and write                        | Rebuilt from md on each change, read-only |
  | 2 Cutover   | Store           | Read-only (a check rejects edits)     | Read and write                            |
  | 3 Retire md | Store           | Deleted from `main` (kept in git log) | Read and write                            |

- **FR:cutover.shadow** (P1): In Stage 1 the host MUST run `import md --replace` after each md commit, so the app and agents can test reads against the store.
- **FR:cutover.flag** (P1): One config key `store: "md" | "shadow" | "sqlite"` MUST pick the stage. Changing it back MUST work at any time.
- **FR:cutover.gates** (P1): Stage 2 starts only when all of these pass:

  | Gate           | Passes when                                                                                                        |
  | -------------- | ------------------------------------------------------------------------------------------------------------------ |
  | `G1 next`      | Now shows the one next task. It equals `stack next` on md for 5 work days in a row.                                |
  | `G2 do`        | The owner can add, edit, start, complete, suspend and reorder a task in the app on Mac and phone, with no md edit. |
  | `G3 find`      | The app shows all tasks by project with search and filters, so the owner never opens md to find a task.            |
  | `G4 agents`    | Every CoS and worker agent file uses CLI or MCP with `--json`. A scan of agent files finds no `tasks/*.md` path.   |
  | `G5 roundtrip` | `export md` then `import md` on the live data gives the same tasks (`FR:export.roundtrip`).                        |
  | `G6 restore`   | A restore drill from the latest snapshot works in under 2 minutes.                                                 |
  | `G7 owner`     | The owner says go.                                                                                                 |

- **FR:cutover.final** (P1): Stage 2 MUST start with one final `import md`, a snapshot, and the md read-only check, in that order.
- **FR:cutover.retire** (P1): Stage 3 starts after 10 work days in Stage 2 with no rollback.

### FR:rollback: Rollback

The owner needs a fast undo so that a bad change or a bad cutover is cheap.

- **FR:rollback.write** (P1): To undo bad writes, the owner runs `stack restore` (`FR:backup.restore`). Writes after the snapshot are lost. There is no per-write undo.
- **FR:rollback.md** (P1): To return to md from Stage 2 or 3: `stack export md` into `tasks/`, commit, set `store: "md"`. The md adapters (`storage-git`, `storage-batch`) MUST stay in the code until Stage 3 ends.

### Non-functional Requirements

- **NFR:perf.read** (P1): `list` and `next` on 2,000 tasks MUST answer in under 100 ms on the Mac.
- **NFR:perf.write** (P1): A single write MUST finish in under 20 ms.
- **NFR:privacy** (P1): Logs MUST NOT hold task text. Snapshots stay on the owner's devices and the configured backup dir.

## Data Model

- **FR:$task** (P1): **`Task`**: One live task. Table `tasks`.
  - `id` (string): `project/slug`, primary key
  - `project` (string): project ID
  - `parentId` (string?): parent task ID
  - `order` (number): sort order among siblings
  - `title` (string)
  - `status` (`open` | `started` | `suspended` | `parked`)
  - `owner` (string): `me` or an agent ID
  - `priority`, `impact`, `effort` (number?): same values as `task-model`
  - `due`, `start`, `suspendedUntil` (IsoDate?)
  - `recurrence` (Recurrence?): JSON
  - `autonomy` (Autonomy)
  - `next`, `doneWhen`, `context` (string?)
  - `notes` (Note[]): JSON tree `{text, children}`
  - `links` (Link[])
  - `createdAt`, `updatedAt` (IsoDateTime), `updatedBy` (string), `rev` (number)
- **FR:$link** (P1): **`Link`**: Table `links`, key `(taskId, kind, target)`.
  - `kind` (`blocks` | `pr` | `req` | `url`)
  - `target` (string): a task ID for `blocks`; `owner/repo#N` for `pr`; `FR:{feature}/{req}` for `req`; a URL for `url`
  - `req` links are optional and for product work only
- **FR:$project** (P1): **`Project`**: Table `projects`.
  - `id` (string), `name` (string), `aliases` (string[]), `repos` (string[]), `meta` (JSON: other project metadata)
- **FR:$errors** (P1): **`StoreError`** base; **`NotFoundError`**, **`AmbiguousError`**, **`ConflictError`** extend it.

## Architecture Constraints

- Core module `src/core/task-store.ts` (interface, SQLite adapter, errors). Import and export in `src/core/task-io.ts`.
- `node:sqlite` only. No ORM. Plain SQL in one file.
- The store sits behind `TaskStore`, as storage does today (`.xe/architecture.md`, Dependency Abstraction Pattern).
- Out of scope: event log, history, archive, multi-user, a phone replica, the deployed SWA host reading the store.

## Risks

| Risk                                                                                                                                      | Mitigation                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| R1 The Mac is the only writer. When it sleeps or is off, the phone is read-only, and the deployed host (`stack.xerilium.com`) goes stale. | Accept for now. Keep the Mac awake as host. A later spec can push a read-only snapshot to the deployed host. |
| R2 No history. A bad agent write is lost until the next snapshot, up to 60 minutes of work.                                               | `expectRev` on agent writes; hourly snapshots; restore drill `G6`.                                           |
| R3 Agents still read or write `tasks/*.md` after cutover and drift from the store.                                                        | Gate `G4`; md read-only check in Stage 2.                                                                    |
| R4 `node:sqlite` is marked experimental in Node 22.                                                                                       | Pin Node 22.13 or later; the contract suite runs in CI on each Node upgrade.                                 |
| R5 Import maps some md rows wrong (odd markers, deep notes).                                                                              | `--dry-run` report; shadow stage; round-trip gate `G5`.                                                      |

## External Dependencies

Node.js 22.13 or later (`node:sqlite`).
