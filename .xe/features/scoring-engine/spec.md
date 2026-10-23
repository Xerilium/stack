---
id: scoring-engine
title: Scoring Engine
author: flanakin
description: "Pluggable task-scoring engine whose default reproduces the legacy formula exactly, plus legacy time-block filtering."
dependencies: [task-parser, config]
---

<!-- markdownlint-disable single-title -->

# Feature: Scoring Engine

## Purpose

Rank tasks so Stack can say what to do next. The engine sits behind an interface so a redesigned formula can replace it later (scoring-bakeoff); the default engine reproduces the legacy PowerShell formula exactly, proven by golden outputs generated from the legacy code.

## Scope

- In: emoji extraction, weights, project value and weight, placement bonus, effort divisor, score breakdown, parked/active-leaf selection, time-block filtering, engine registry, adapter from parsed projects, golden parity.
- Non-goals: redesigning the formula; outcome de-duplication and first-actionable (`🔀`) selection (summaries/task-lifecycle); date-driven state changes (recurring-rows/task-lifecycle); file I/O.
- Legacy quirks are preserved on purpose and listed under Legacy Parity. Fixing any of them is a bake-off decision, not a change here.

## Scenarios

### FR:emojis: Extract scoring emojis

Scoring needs the emojis in a task's text grouped by category.

- **FR:emojis.@function** (P1): Interface: `extractEmojis(text: string, config: StackConfig): TaskEmojis`
- **FR:emojis.input** (P1): Task text (string), config (@req FR:config/$stack-config)
- **FR:emojis.categories** (P1): `extractEmojis` MUST report Priority, Status, Effort, Impact, Value, Special, and TimeBlocks emojis by literal substring match, in the legacy category order
- **FR:emojis.value-repeat** (P1): `extractEmojis` MUST report each Value emoji once per occurrence (`💰💰` is two entries); every other category reports presence once
- **FR:emojis.timeblocks** (P1): `extractEmojis` MUST take TimeBlocks emojis from `config.timeBlocks`, so emojis shared by several blocks are reported once per block
- **FR:emojis.output** (P1): TaskEmojis (@req FR:scoring-engine/$task-emojis)

### FR:score: Score tasks

Stack needs one score per task so the highest can be shown first.

- **FR:score.@function** (P1): Interface: `ScoringEngine.score(projects: ScoringProject[], config: StackConfig): ScoredTask[]`
- **FR:score.input** (P1): Scoring projects (@req FR:scoring-engine/$scoring-project), config (@req FR:config/$stack-config)
- **FR:score.formula** (P1): The legacy engine MUST compute `(emoji + projectBonus + placementBonus) / outcomeEffortHours`
- **FR:score.aggregate** (P1): Emojis MUST be aggregated from the task and all its ancestors
  - **FR:score.aggregate.single** (P1): Status and Impact MUST contribute only their highest-weighted known emoji
  - **FR:score.aggregate.multi** (P1): Priority, TimeBlocks, and Special MUST contribute each unique known emoji once
  - **FR:score.aggregate.value** (P1): Value MUST contribute every occurrence, including repeats across ancestors
  - **FR:score.aggregate.effort** (P1): Effort emojis MUST NOT contribute additively (they only drive the divisor)
- **FR:score.timeblock-weight** (P2): A TimeBlocks weight MUST default to 8 per configured block emoji, be replaced by `timeBlocks.default` when that value is non-zero, then be overridden by per-emoji weights
- **FR:score.project-value** (P1): A project's value score MUST be the sum of its `**Project value:**` emoji weights (Value category, repeats counted)
- **FR:score.project-weight** (P1): Projects MUST be ranked by calculated priority (value tier `100 - valueScore`, then explicit `**Project priority:**`, then `100 - weeklyCapacity` when above 0, else 50), ties keeping input order; the project at rank `i` of `n` gets weight `n - 1 - i`, added to every task in the project
- **FR:score.placement** (P1): Each leaf task MUST receive `(leafCount - position) / 10`, where `position` is its 0-based index among the project's leaf tasks in document order
- **FR:score.effort** (P1): Effort hours MUST be the sum of own-effort hours over all incomplete leaf tasks under the task's outcome parent; own effort (default 1 hour) when the task is a root or has no incomplete leaves
  - **FR:score.effort.parent** (P1): The outcome parent MUST be the highest `🎯` ancestor, else the root ancestor
  - **FR:score.effort.own** (P1): A task's own effort MUST be the hours of the first effort emoji in legacy category order (`🔹 🟢 🟡 🟠 🔴 ⚫️`), default 1
- **FR:score.validate** (P2): `score` MUST throw `ScoringError` when an effort divisor is not positive
- **FR:score.breakdown** (P1): Each scored task MUST carry a breakdown: emoji contributions (category, emoji, value), projectBonus, placementBonus, baseScore, effortHours, calculatedTotal
- **FR:score.output** (P1): ScoredTask[] in input order (@req FR:scoring-engine/$scored-task)

### FR:filter: Select and filter candidates

The next task must be an unparked leaf allowed in the current time block.

- **FR:filter.parked** (P1): `isParked` MUST be true for a task or any ancestor carrying `🅿️`, `💤`, `⏰`, or `⛔️`
- **FR:filter.blocks** (P1): `activeTimeBlocks(config, at)` MUST return the names of every block active at the instant in the configured timezone, matching the legacy rule: current-day membership only, inclusive start and end, overnight when end is before start
- **FR:filter.time** (P1): `filterByTimeBlock` MUST apply the legacy rules in order
  - **FR:filter.time.critical** (P1): `🚨` tasks are always kept
  - **FR:filter.time.emoji-active** (P1): A task with a time-block emoji whose block is active is kept when its project has no capacity lines or lists that block
  - **FR:filter.time.emoji-inactive** (P1): A task whose time-block emojis match no active block is dropped
  - **FR:filter.time.capacity** (P1): A task without time-block emojis is kept when its project has no capacity lines or lists an active block
  - **FR:filter.time.unknown-project** (P2): Tasks of unknown projects are kept
- **FR:filter.capacity** (P1): Capacity lines `- **<Block> capacity:** <n>h` MUST be read from project content, ignoring blocks not in the config

### FR:rank: Rank candidates

- **FR:rank.@function** (P1): Interface: `rankTasks(engine: ScoringEngine, projects: ScoringProject[], config: StackConfig, at?: Date): ScoredTask[]`
- **FR:rank.order** (P1): `rankTasks` MUST return unparked leaf tasks, time-filtered when `at` is given, sorted by score descending with ties keeping input order

### FR:engine: Pluggable engines

- **FR:engine.interface** (P1): A `ScoringEngine` MUST expose `id`, `score`, and `filter`
- **FR:engine.registry** (P1): `registerEngine`, `getEngine(id?)`, and `listEngines()` MUST manage engines; `getEngine()` MUST default to `legacy`
- **FR:engine.unknown** (P2): `getEngine` MUST throw `ScoringError` for an unregistered id
- **FR:engine.stack** (P1): A `stack` engine MUST be registered and is the default for `next`: legacy score, plus a due-date lens in `filter` — a `📅` date beyond 14 days out (calendar days in the config timezone) is not a candidate; overdue or due today adds 3000 to the score, within 3 days 2000, within 7 days 1000; overdue by more than 30 days counts as stale and gets 1000 (it no longer jumps the queue). Dates without a year use the nearest year (up to ~60 days past counts as overdue). `legacy` stays registered unchanged for parity

### FR:load: Adapt parsed projects

- **FR:load.@function** (P1): Interface: `toScoringProject(project: Project, fallbackName?: string): ScoringProject`
- **FR:load.name** (P1): The name MUST be the H1 on the first line, else `fallbackName` with `-` replaced by a space
- **FR:load.metadata** (P1): `toScoringProject` MUST read `**Project value:**` emojis, `**Weekly capacity:**` (default 40), `**Project priority:**`, and capacity lines from the project content
- **FR:load.tasks** (P1): Tasks MUST be the unchecked `- [ ] text` lines of the first `🔄 Active` section in document order, with ids `<name>_task_<n>`, level `floor(indent / 2)`, and parents from the legacy level walk

## Data Model

- **FR:$task-emojis** (P1): **`TaskEmojis`** — `Priority`, `Status`, `Effort`, `Impact`, `Value`, `Special`, `TimeBlocks` (each `string[]`).
- **FR:$scoring-project** (P1): **`ScoringProject`** — `name`, `value` (string[]), `weeklyCapacity`, `explicitPriority?`, `capacity` (block → hours), `tasks` (ScoringTask[]).
- **FR:$scoring-task** (P1): **`ScoringTask`** — `id`, `parent` (id or null), `text`, `level`, `project`, `complete?`.
- **FR:$scored-task** (P1): **`ScoredTask`** — `task`, `leaf`, `parked`, `score`, `breakdown`.

## Legacy Parity

- **FR:parity.golden** (P1): Golden outputs generated by the legacy PowerShell code over the fixtures in `tests/fixtures/scoring/` MUST match: project weights, per-task score and breakdown, ranking, and time-filtered candidates at fixed instants
- **FR:parity.quirks** (P1): These legacy behaviors are preserved:
  - The outcome parent is the highest `🎯` ancestor
  - A task's time-block emoji maps to the first configured block using it (so `🏠` never matches `Family weekend`)
  - Block end is inclusive (both blocks match at an exact boundary second)
  - Tabs count as one indent character and indentation is halved for level
  - Checked tasks are skipped without re-parenting their unchecked children
  - Only the Active section is scored; the `effort` weight category is ignored
  - Equal scores have no defined order in legacy (PowerShell `Sort-Object` is unstable); the engine keeps input order, and goldens compare tie groups as sets
  - Project weight ties break on `Priority` (projects.md order, 999 when absent); the engine keeps input order instead, since file I/O is out of scope
  - Project name is the H1 on line 1 only, else the file base name with `-` replaced by a space
  - `score.validate` throws on negative effort; legacy fails only on zero (deliberate deviation)

## Architecture Constraints

- Pure functions; no file or network access.
- Reuses `StackConfig` and `Project` types from config and task-parser.

## External Dependencies

None
