---
id: task-store
title: Task store
description: "Azure Cosmos DB (lifetime free tier) holds live areas, projects, tasks and inbox items with stable IDs; every writer uses one TaskStore with ETag checks; md stays the source of truth until the cutover gates pass."
dependencies:
  [
    storage-git,
    task-model,
    task-lifecycle,
    cli,
    mcp-server,
    api,
    azure-host,
    tailnet-access,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Task store

## Purpose

Stack answers one question: what is next. The answer comes from day-aware priorities ([179](https://github.com/Xerilium/stack/pull/179)).

Today tasks live in `tasks/*.md`. Problems:

- A task has no stable ID. Refs are path and line, so they break on each edit.
- Open text grows into deep nests. 26% of rows are 2+ levels deep; 83 rows sit in "Active" (`research.md` section 1).
- Capture and commitment mix. PR rows, agent logs and status prose live as tasks.
- Many writers (owner on Mac and phone, local agents, cloud agents, connectors) edit one git repo. Writes collide or wait for the Mac.

This spec defines one task model and one cloud store for it. Evidence and prior art: `research.md`.

## Principles

- **P1 One next action**: The model makes a big list impossible, not only hidden. Only a leaf task can be next.
- **P2 Fixed shape**: Area > Project > (sub-project) > Task > Step. Free text lives in a markdown `body`, never as child rows.
- **P3 Capture is not commitment**: Sources write inbox items. A task exists only when it passes the quality gate (`FR:gate`).
- **P4 Live work only**: Done deletes. No history, archive or event log in the store. Backups are not history.
- **P5 Many writers, no lost writes**: Every write checks a version. A stale write fails; it never overwrites.
- **P6 Free forever**: The store costs $0 by a hard limit, not by luck (`FR:cost`).
- **P7 md until the app is ready**: md stays the source of truth until every cutover gate passes (`FR:cutover`).

## Decision: Store

**Azure Cosmos DB for NoSQL, lifetime free tier.** One account, one database, one container.

| Need                    | SQLite + GitHub snapshot ([180](https://github.com/Xerilium/stack/pull/180) v1)                                                   | Azure SQL free offer                                                                                                                                                                                                 | **Cosmos DB free tier**                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Many writers            | **Fails.** One writer host. A db file in git has no merge; the last push wins and drops writes. Mac off means phone is read-only. | Row locks. Safe.                                                                                                                                                                                                     | ETag `If-Match` per item [C2]. Safe. Transactional batch in one partition [C3].                |
| Writes with the Mac off | No                                                                                                                                | Yes, until the monthly limit                                                                                                                                                                                         | Yes                                                                                            |
| Free forever            | Yes                                                                                                                               | **At risk.** 100k vCore-seconds per month [S1]. Idle pause is fixed at 15 min [S2]. A connector on a timer under 15 min keeps it awake; at 0.5 vCore that uses the month in about 2.3 days, then the db is off [S2]. | Yes. 1,000 RU/s and 25 GB for the account lifetime [C1]. Account limit caps RU/s at free [C4]. |
| Latency                 | Local                                                                                                                             | Cold start on each resume                                                                                                                                                                                            | Always on, single-digit ms                                                                     |
| Nesting                 | `parent_id` + markdown body                                                                                                       | Same                                                                                                                                                                                                                 | Same. One partition read (< 2k items) builds the tree in code.                                 |
| Live push               | Host SSE                                                                                                                          | Polling                                                                                                                                                                                                              | Change feed [C5]                                                                               |
| Offline                 | Mac only                                                                                                                          | None                                                                                                                                                                                                                 | None native. Mac cache and phone capture queue (`FR:offline`).                                 |
| Restore                 | Ours only                                                                                                                         | 7-day point-in-time restore [S2]                                                                                                                                                                                     | 7-day continuous backup, no storage charge [C6]; plus our JSON snapshot (`FR:backup`)          |
| SLA                     | None                                                                                                                              | None on free [S2]                                                                                                                                                                                                    | Same SLA as paid [C1]                                                                          |

Why Cosmos DB wins:

- Multi-writer safety: ETag checks give `P5` with no lock server and no host.
- Cost: provisioned RU/s has no monthly quota to run out. The account throughput limit makes overage impossible.
- Load: ~1,100 tasks, < 10 MB. A point read is ~1 RU; a write is ~10 RU. 1,000 RU/s is ~100 writes per second.
- Azure SQL loses on the always-on agent load, not on features. Its relational fit does not matter at this size.

Known costs of the pick (accepted):

- No offline writes for tasks. Mitigated by `FR:offline`.
- No local emulator on every dev box. The contract suite runs on the in-memory adapter; the Cosmos adapter runs the same suite in CI on the Linux emulator.
- A restore from Cosmos backup has a small per-GB charge [C6]. At < 10 MB it is under $0.01. The primary restore is our free JSON snapshot.

## Scenarios

### FR:model: Fixed shape

The owner needs a shape that cannot grow into giant lists so that "what is next" is one answer.

- **FR:model.levels** (P1): The store MUST hold these types: `area`, `project`, `task`, `inbox`, `dayplan`, `priority`. Shape: Area > Project > (sub-project) > Task > Step.
- **FR:model.area** (P1): An area MUST NOT finish. It has a weekday weight. Every project MUST belong to one area.
- **FR:model.subproject** (P1): A project MAY have one parent project. A sub-project MUST NOT have a sub-project.
- **FR:model.task** (P1): A task MUST have one project. A task MUST NOT have child tasks. A write that gives a task a task parent MUST throw `ShapeError`.
- **FR:model.steps** (P1): A task MAY hold `steps`: a flat list of `{text, done}`. Steps have no owner, date or rank.
- **FR:model.body** (P1): Every area, project and task MAY hold `body`: markdown, any depth of nested lists, at most 64 KB. `body` is reference text. The store MUST NOT parse tasks, dates or owners from it.
- **FR:model.links** (P1): A PR, issue, email or URL MUST be a link on the item, never a child row.
- **FR:model.sequential** (P2): A project MUST be `sequential` or `parallel`. In a sequential project only the first open task is available.
- **FR:model.cap** (P2): A project with more than 7 available tasks MUST show a warning in review. The store does not refuse the write.

### FR:gate: Inbox and quality gate

The owner needs only clear actions in the queue so that every task can be done as written.

- **FR:gate.inbox** (P1): Connectors (email, PR, calendar), agents and quick capture MUST write `inbox` items, not tasks. An inbox item holds `text`, `source`, `link` and `capturedAt`.
- **FR:gate.fields** (P1): A task MUST pass the gate on every write:

  | Field      | Rule                                                |
  | ---------- | --------------------------------------------------- |
  | `title`    | Verb first, one action, at most 80 characters       |
  | `doneWhen` | One check anyone can make                           |
  | `owner`    | `me` or one agent ID                                |
  | `project`  | An existing project ID                              |
  | `links`    | At least one when the action happens in another app |

- **FR:gate.reject** (P1): A task write that fails the gate MUST throw `GateError` with the failed fields. It MUST NOT write a partial task.
- **FR:gate.clarify** (P1): `clarify(inboxId, outcome)` MUST, in one transactional batch, delete the inbox item and do one of: create a task, add a link to a task, create a project, or drop.
- **FR:gate.human** (P1): When an agent needs the owner, it MUST create a task with owner `me` that blocks its own task. It MUST NOT edit its task to ask.

### FR:id: Stable IDs

Agents and the owner need IDs that survive edits and moves so that refs never break.

- **FR:id.form** (P1): An ID MUST be kebab-case `[a-z0-9-]`, at most 60 characters, unique in the store. It MUST NOT hold the project, so a move never changes it.
- **FR:id.make** (P1): `add` MUST make the ID from the first 6 words of the title. On a clash it MUST add `-2`, `-3`, and so on.
- **FR:id.stable** (P1): A title edit or a move MUST NOT change the ID.
- **FR:id.ref** (P1): A lookup MUST accept the ID, `{project}/{id}`, or a prefix that matches one item. Zero or many matches MUST throw `NotFoundError` or `AmbiguousError` with the candidates.

### FR:store: Store contract

Every surface needs one store contract so that the app, CLI, MCP and agents agree.

- **FR:store.@type** (P1): Interface: `TaskStore { list(q?): Item[]; get(id): Item; add(input): Item; update(id, patch, opts): Item; remove(id, opts): void; clarify(inboxId, outcome): Item?; tree(projectId?): Node[]; changes(since): Change[] }`
- **FR:store.adapters** (P1): The store MUST have an in-memory adapter (tests) and a Cosmos DB adapter. Both MUST pass one contract suite.
- **FR:store.container** (P1): The Cosmos adapter MUST use one container with partition key `/ownerId`. All of one owner's items share one logical partition, so a move or cascade runs as one transactional batch [C3].
- **FR:store.atomic** (P1): Each call MUST be atomic. A call that changes more than one item MUST use a transactional batch. A failed call changes nothing.
- **FR:store.schema** (P1): Each item MUST hold `schemaVersion`. The adapter MUST upgrade older items on read and write. An unknown newer version MUST throw `StoreError`.

### FR:write: Many writers

Many writers need a safe write path so that no writer loses another's edit.

- **FR:write.surfaces** (P1): CLI, MCP, the Mac host and the Azure host MUST call the same `TaskStore`. The lifecycle verbs (`add`, `start`, `complete`, `skip`, `resume`, `suspend`, `set`, `claim`) keep their names and flags.
- **FR:write.json** (P1): Every read command MUST support `--json` and give the item shape (`FR:$item`).
- **FR:write.rev** (P1): Each item MUST carry `rev`, the Cosmos `_etag`.
- **FR:write.expect** (P1): Every update and remove MUST send `If-Match: rev`. A mismatch MUST throw `ConflictError` with the current item. The caller reads again and retries.
- **FR:write.patch** (P1): `update` MUST change only the fields in the patch. A retry after `ConflictError` MUST reapply the patch to the fresh item, at most 3 times, then throw.
- **FR:write.actor** (P1): Each write MUST record `updatedBy`: the API token's owner, else `STACK_ACTOR`, else `me`.
- **FR:write.throttle** (P1): A `429` MUST retry with the server's back-off. It MUST NOT surface to the owner unless it fails for 30 seconds.
- **FR:write.keys** (P1): No phone or browser MUST hold a Cosmos key. The phone and web write through the Azure host or the Mac host. The Mac CLI uses Entra ID data-plane roles; the Azure host uses a key in app settings.

### FR:done: Complete and remove

The owner needs done work to leave so that the store holds only what is next.

- **FR:done.delete** (P1): `complete` MUST delete the task and add 1 to today's `dayplan` done count for its area.
- **FR:done.recurring** (P1): `complete` on a recurring task MUST roll its dates and keep the task.
- **FR:done.project** (P1): `complete` on a project with open tasks MUST throw `LifecycleError`, unless `--cascade` is given. `--cascade` deletes the tasks in the same batch.
- **FR:done.dangling** (P1): A `blocks` link to a missing ID MUST count as resolved.
- **FR:done.output** (P1): `complete --json` MUST give the deleted item, so an agent can report it.
- **FR:done.dayplan** (P1): The store MUST keep `dayplan` items for today and yesterday only. Older ones MUST be deleted on the first write of the day.

### FR:rank: What is next

The owner needs one answer so that the app, CLI and agents agree on the next task.

- **FR:rank.source** (P1): `stack next`, `GET /api/next` and `GET /api/rank` MUST read the store and rank with the pri-first order of [179](https://github.com/Xerilium/stack/pull/179).
- **FR:rank.pool** (P1): Only tasks with owner `me`, available now, not blocked, not waiting, and first in a sequential project MUST enter the pool. Projects, steps and inbox items never rank.
- **FR:rank.activity** (P1): Rules that use the last change of a task MUST use `updatedAt`, not `git blame`.
- **FR:rank.parity** (P1): For the same tasks, the store ranking MUST equal the md ranking.

### FR:sync: Devices and live views

The owner needs the Mac, phone and web to show the same data so that work never waits for one device.

- **FR:sync.direct** (P1): The Mac host, the Azure host (`stack.xerilium.com`) and the CLI MUST read and write Cosmos DB direct. No host is the single writer.
- **FR:sync.phone** (P1): The phone MUST use the Azure host. It MAY use the Mac host over the tailnet when it answers. Both give the same data.
- **FR:sync.live** (P2): Each host MUST read the change feed [C5] and push a change signal (SSE or Web Push), so open views refresh within 5 seconds.

### FR:offline: No network

The owner needs capture and reads with no network so that a dead link loses nothing.

- **FR:offline.cache** (P2): The Mac host and CLI MUST keep a read cache of the partition in `$STACK_HOME/cache.db`, fed by the change feed. With no network, reads MUST come from the cache, marked `Offline since h:mm`.
- **FR:offline.capture** (P2): With no network, the phone PWA and CLI MUST queue inbox items and send them on reconnect. Inbox items are create-only, so they never conflict.
- **FR:offline.writes** (P2): With no network, task edits MUST fail with `OfflineError`. They MUST NOT queue. This keeps `P5`.

### FR:cost: Free forever

The owner needs the store to cost $0 forever so that it never becomes a bill.

- **FR:cost.tier** (P1): The account MUST be created with the free tier discount, one region, provisioned throughput, and no analytical store.
- **FR:cost.limit** (P1): The account total throughput limit MUST be set to the free tier amount (1,000 RU/s) [C4]. The database MUST use shared throughput of at most 1,000 RU/s.
- **FR:cost.backup** (P1): Backup MUST be continuous, 7-day tier [C6].
- **FR:cost.check** (P1): `stack store check` MUST verify `FR:cost.tier`, `FR:cost.limit` and `FR:cost.backup`, and fail when any drifts. It runs on the weekly CoS sweep.
- **FR:cost.alert** (P2): The subscription MUST have a budget alert at $1 per month.

### FR:backup: Snapshot and restore

The owner needs a copy outside Azure so that a lost account or a bad write recovers in minutes.

- **FR:backup.snap** (P1): The Azure host MUST export the partition as one JSON file 15 minutes after the last write (debounced) and once a day. It MUST skip the export when nothing changed.
- **FR:backup.remote** (P1): Each export MUST be a commit of `stack.json` on branch `snapshots` of the private repo in config `backup.remote` (default `{owner}/stack-data`). Commits accrue; the file is text, so git keeps it small.
- **FR:backup.private** (P1): The export MUST refuse to push when the repo is public.
- **FR:backup.fail** (P2): A failed push MUST retry on the next export and show `Backup failed at h:mm` in the app.
- **FR:backup.restore** (P1): `stack restore [--at <commit|time>]` MUST, in order: stop writes (`store.readOnly`), export the current state to `stack.before-restore.json`, replace the partition with the snapshot, and resume writes. No argument means the latest snapshot.
- **FR:backup.pitr** (P2): For damage inside 7 days that the snapshot missed, the owner MAY use Cosmos point-in-time restore to a new account [C6]. The runbook lives in `docs/restore.md`.
- **FR:backup.new** (P1): On a new Cosmos account, `stack setup --restore` MUST load the latest snapshot. A lost account recovers this way.

### FR:import: One-time md import

The owner needs current tasks moved once so that nothing is lost at cutover.

- **FR:import.run** (P1): `stack import md [--dry-run]` MUST parse `tasks/*.md` with the current parser and write every open item.
- **FR:import.map** (P1): Import MUST map rows to the shape:
  - A file becomes a project in the area from its project metadata.
  - A row with child rows becomes a project. Its children become tasks; deeper rows become steps or `body`.
  - A row that fails the gate becomes an inbox item, with the original text and path.
  - Notes, `>` quotes and status prose go to `body`.
- **FR:import.report** (P1): Import MUST print counts per project, rows sent to inbox, and renamed IDs. `--dry-run` writes nothing.
- **FR:import.once** (P1): Import into a store that holds items MUST refuse, unless `--replace` is given. `--replace` is for the shadow stage only.
- **FR:import.done** (P1): Import MUST skip done rows (`- [x]`).

### FR:export: md on demand

The owner needs a way back to md so that a failed cutover is never a dead end.

- **FR:export.md** (P1): `stack export md [--out dir]` MUST write one file per project in the current md format, readable by the current parser.
- **FR:export.roundtrip** (P1): `import md` of the export MUST give the same items, fields and links. Inbox items export to `inbox.md`.
- **FR:export.json** (P1): `stack export json` MUST write the format of `FR:backup.snap`.

### FR:cutover: Stages and gates

The owner needs the app to be good enough before md stops so that he never loses his view of the work.

- **FR:cutover.stages** (P1): Cutover MUST go in this order. A stage starts only when the gates of the one before it pass.

  | Stage       | Source of truth | md                                    | Store                                     |
  | ----------- | --------------- | ------------------------------------- | ----------------------------------------- |
  | 0 Build     | md              | Read and write                        | Not used                                  |
  | 1 Shadow    | md              | Read and write                        | Rebuilt from md on each change, read-only |
  | 2 Cutover   | Store           | Read-only (a check rejects edits)     | Read and write                            |
  | 3 Retire md | Store           | Deleted from `main` (kept in git log) | Read and write                            |

- **FR:cutover.shadow** (P1): In Stage 1 the Mac host MUST run `import md --replace` after each md commit, so the app and agents can test reads.
- **FR:cutover.flag** (P1): One config key `store: "md" | "shadow" | "cosmos"` MUST pick the stage. Changing it back MUST work at any time.
- **FR:cutover.gates** (P1): Stage 2 starts only when all of these pass:

  | Gate           | Passes when                                                                                                      |
  | -------------- | ---------------------------------------------------------------------------------------------------------------- |
  | `G1 next`      | Now shows the one next task. It equals `stack next` on md for 5 work days in a row.                              |
  | `G2 do`        | The owner can add, edit, start, complete and reorder a task in the app on Mac and phone, with no md edit.        |
  | `G3 find`      | The app shows all tasks by area and project with search, so the owner never opens md to find a task.             |
  | `G4 agents`    | Every CoS and worker agent file uses CLI or MCP with `--json`. A scan of agent files finds no `tasks/*.md` path. |
  | `G5 roundtrip` | `export md` then `import md` on the live data gives the same items (`FR:export.roundtrip`).                      |
  | `G6 restore`   | A restore drill (`stack restore` and `stack setup --restore` on a new account) works in under 5 minutes.         |
  | `G7 writers`   | A test with 10 writers on one task for 1 minute loses no write; each loser gets `ConflictError` and retries.     |
  | `G8 cost`      | `stack store check` passes and the bill shows $0 for 30 days of shadow traffic.                                  |
  | `G9 owner`     | The owner says go.                                                                                               |

- **FR:cutover.final** (P1): Stage 2 MUST start with one final `import md`, a snapshot, and the md read-only check, in that order.
- **FR:cutover.retire** (P1): Stage 3 starts after 10 work days in Stage 2 with no rollback.

### FR:rollback: Rollback

The owner needs a fast undo so that a bad change or a bad cutover is cheap.

- **FR:rollback.write** (P1): To undo bad writes, the owner runs `stack restore --at <time>`. Writes after the snapshot are lost. There is no per-write undo.
- **FR:rollback.md** (P1): To return to md from Stage 2 or 3: `stack export md` into `tasks/`, commit, set `store: "md"`. The md adapters (`storage-git`, `storage-batch`) MUST stay in the code until Stage 3 ends.

### Non-functional Requirements

- **NFR:perf.read** (P1): `list`, `tree` and `next` on 2,000 tasks MUST answer in under 300 ms from the Azure host and under 100 ms from the Mac cache.
- **NFR:perf.write** (P1): A single write MUST finish in under 200 ms at p95.
- **NFR:ru** (P1): A full partition read MUST cost under 100 RU. Normal use MUST stay under 200 RU/s at peak.
- **NFR:privacy** (P1): Logs MUST NOT hold task text. Data stays in the owner's Cosmos account and the private `backup.remote` repo.

## Data Model

- **FR:$item** (P1): **`Item`**: base of every stored item.
  - `id` (string): `FR:id.form`
  - `type` (`area` | `project` | `task` | `inbox` | `dayplan` | `priority`)
  - `ownerId` (string): partition key
  - `parentId` (string?): area for a project; project for a sub-project or task
  - `order` (number): sort among siblings
  - `title` (string), `body` (markdown?)
  - `links` (Link[])
  - `schemaVersion` (number), `createdAt`, `updatedAt` (IsoDateTime), `updatedBy` (string), `rev` (string, `_etag`)
- **FR:$task** (P1): **`Task`** extends `Item`:
  - `state` (`ready` | `active` | `deferred` | `waiting` | `someday`)
  - `owner` (`me` | agent ID), `doneWhen` (string), `context` (string?, at most 3 lines)
  - `deadline` ({date, hard}?), `planned` (IsoDate?), `availableAt` (IsoDateTime?), `waitingOn` ({ref, followUp}?), `reviewBy` (IsoDate)
  - `effort` (minutes?), `priority`, `impact` (number?), `recurrence` (Recurrence?), `autonomy` (Autonomy)
  - `steps` ({text, done}[])
- **FR:$project** (P1): **`Project`** extends `Item`: `doneWhen` (string), `mode` (`sequential` | `parallel`), `aliases`, `repos` (string[]), `reviewEvery` (days).
- **FR:$area** (P1): **`Area`** extends `Item`: `weekdays` (weight per weekday).
- **FR:$inbox** (P1): **`InboxItem`** extends `Item`: `source` (`email` | `pr` | `calendar` | `agent` | `capture` | `import`), `capturedAt`.
- **FR:$dayplan** (P1): **`DayPlan`** extends `Item`: `date`, `picks` (task ID[]), `doneByArea` (map), `note` (string?).
- **FR:$link** (P1): **`Link`**: `{kind, target}`.
  - `kind` (`blocks` | `pr` | `issue` | `email` | `req` | `url`)
  - `target`: a task ID for `blocks`; `owner/repo#N` for `pr` and `issue`; `FR:{feature}/{req}` for `req`; a URL otherwise
- **FR:$errors** (P1): **`StoreError`** base; **`NotFoundError`**, **`AmbiguousError`**, **`ConflictError`**, **`GateError`**, **`ShapeError`**, **`LifecycleError`**, **`OfflineError`** extend it.

## Architecture Constraints

- Core module `src/core/task-store.ts` (interface, errors, gate, in-memory adapter). Cosmos adapter in `src/core/task-store-cosmos.ts` on `@azure/cosmos`. Import and export in `src/core/task-io.ts`.
- The store sits behind `TaskStore`, as storage does today (`.xe/architecture.md`, Dependency Abstraction Pattern). A store swap is an adapter, not a model change.
- Gate, shape and rank logic live in core, not in the adapter, so every adapter enforces the same rules.
- Out of scope: event log, history, multi-user, multi-region, offline task edits, UI (lives in `product-reset`).

## Risks

| Risk                                                         | Mitigation                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| R1 Microsoft ends or changes the free tier.                  | `TaskStore` keeps the swap to one adapter. Daily JSON snapshot. `stack store check` flags drift. |
| R2 An agent loop burns RU/s and gets throttled.              | Account limit caps cost at $0. `FR:write.throttle`. `NFR:ru` alert in the weekly sweep.          |
| R3 No network means no task edits.                           | Read cache and capture queue (`FR:offline`). Edits are rare off-network.                         |
| R4 A Cosmos key leaks from the Azure host.                   | Key only in app settings; rotate on suspicion. Mac uses Entra ID. No key on any client.          |
| R5 Agents still read or write `tasks/*.md` after cutover.    | Gate `G4`; md read-only check in Stage 2.                                                        |
| R6 Import maps some md rows wrong (odd markers, deep notes). | Failing rows go to inbox, not lost. `--dry-run` report; shadow stage; round-trip gate `G5`.      |

## External Dependencies

- Azure Cosmos DB for NoSQL, free tier account; `@azure/cosmos`; Cosmos DB Linux emulator in CI.
- Node.js 22 or later.

## References

- [C1] [Cosmos DB lifetime free tier](https://learn.microsoft.com/azure/cosmos-db/free-tier)
- [C2] [Cosmos DB optimistic concurrency](https://learn.microsoft.com/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency)
- [C3] [Cosmos DB transactional batch](https://learn.microsoft.com/azure/cosmos-db/nosql/transactional-batch)
- [C4] [Limit total account throughput](https://learn.microsoft.com/azure/cosmos-db/limit-total-account-throughput)
- [C5] [Cosmos DB change feed](https://learn.microsoft.com/azure/cosmos-db/change-feed)
- [C6] [Continuous backup pricing](https://learn.microsoft.com/azure/cosmos-db/continuous-backup-restore-introduction#pricing)
- [S1] [Azure SQL free tier FAQ](https://learn.microsoft.com/azure/azure-sql/database/free-tier-faq)
- [S2] [Azure SQL free tier limits](https://learn.microsoft.com/azure/azure-sql/database/free-tier#considerations-and-limitations)
