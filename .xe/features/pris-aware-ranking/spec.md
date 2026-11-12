---
id: pris-aware-ranking
title: Pris-aware ranking
author: flanakin
description: "Rank tasks by the owner's ordered priorities in ~/.stack/pris.json, explain which priority each task serves, and list priority gaps for the CoS."
dependencies: [session-inventory, auto-priority, scoring-engine, scoring-bakeoff]
---

<!-- markdownlint-disable single-title -->

# Feature: Pris-aware ranking

## Purpose

The owner keeps his ordered priorities in `~/.stack/pris.json` (`FR:session-inventory/pris`). The ranking does not read them, so the CoS guesses which tasks matter now. This feature links tasks to priorities, boosts linked tasks by priority order, and lists priorities that have no status, no tasks, or old status. Then the CoS always knows the real priorities.

## Scope

- In: optional link and status fields on each priority, a pure link function, the opt-in `pris` engine, `--explain` output that names the priority, `stack pris link`, `stack pris note`, `stack pris gaps`, and a bake-off on fixtures from the owner ground truth.
- Non-goals: changing the default engine; editing task files to link them; any LLM call; any UI.

## Scenarios

### FR:link: Link tasks to priorities without editing task files

A link lives in `pris.json`, never in the task files in git.

- **FR:link.model** (P1): A priority MAY have `projects` (project names or aliases), `keywords` (words or phrases) and `refs` (phrases that pin a task), each at most 20 strings of 1-100 characters, and `statusAt` (ISO date-time of the last status). `parsePris` MUST accept these fields and keep rejecting other unknown fields
- **FR:link.@function** (P1): Interface: `linkTask(pris: Pri[], row: { text: string; context?: string; project: string; aliases: string[] }): PriLink | undefined`
- **FR:link.active** (P1): Only `active` and `blocked` priorities link. Their order in the file, counting only these, is the priority rank (1 is highest)
- **FR:link.ref** (P1): A `refs` phrase links a task when it is a whole word or phrase in the task's own text (`via: 'ref'`)
- **FR:link.keyword** (P1): A `keywords` phrase links a task when it is a whole word or phrase in the task text or in the rows above it (`via: 'keyword'`)
- **FR:link.project** (P1): A `projects` entry links every task of the project whose name or alias equals it, case-insensitive (`via: 'project'`)
- **FR:link.auto** (P2): A priority with no `projects`, `keywords` or `refs` gets automatic terms from its title, outside parentheses: each project name or alias written as a capitalized whole word (`Personal`, `FTK`; not `personal`), and each version token (`v16`, `0.3.4`; a bare number is not a token). When the title names a project, its version tokens link only tasks in those projects
- **FR:link.best** (P1): When more than one priority links a task, the link with the highest boost wins; on a tie, the higher priority wins. `PriLink` is `{ id, rank, title, via, term, boost }`

### FR:engine: The `pris` engine

- **FR:engine.@function** (P1): Interface: `prisEngine: ScoringEngine` (id `pris`), `setPris(pris: Pri[]): void` and `registerPrisEngine(): void` (idempotent). Never the default
- **FR:engine.score** (P1): The score MUST be `unblock + urgency + value + pri` with the `autopri` parts unchanged (`FR:auto-priority/explain.parts`), then blockers lift as in `FR:auto-priority/engine.blockers`
- **FR:engine.boost** (P1): `pri` MUST be `3000 * (N + 1 - rank) / N` for `ref` and `keyword` links and half of that for `project` links, where `N` is the count of linking priorities. An unlinked task gets `0`
- **FR:engine.unblock** (P1): An unblocker (`🔓`), and a task that blocks one, MUST rank above every task that is neither, whatever its `pri` and urgency
- **FR:engine.same** (P1): With no priorities, the order MUST equal the `autopri` order
- **FR:engine.memo** (P2): A ranking cache MUST NOT return an order computed for other priorities. `setPris` with the same list MUST keep the version, so the cache still hits

### FR:explain: Explain which priority a task serves

- **FR:explain.cli** (P1): `stack rank --engine pris` reads `~/.stack/pris.json` (or `STACK_HOME`). `--explain` MUST print the `autopri` parts plus `pri=<n>` and, for a linked task, `serves=<rank>:<id> "<title>" via <via> "<term>"`. `--engine` accepts `autopri`, `pris` or `stack`; `--explain` needs `autopri` or `pris`
- **FR:explain.json** (P1): With `--json`, each item `parts` MUST carry `pri` (number) and, when linked, `link` (the `PriLink`)

### FR:cos: CoS commands

- **FR:cos.link** (P1): `stack pris link <id> [--projects a,b] [--keywords a,b] [--refs a,b]` MUST replace the given lists on that priority (an empty value clears the list) and write through `PriStore.put`. When no list is left, the output MUST say that automatic title terms apply (`FR:link.auto`). An unknown id or no flag exits `2`
- **FR:cos.note** (P1): `stack pris note <id> <text>` MUST set `statusAt` to now and set this ISO week's `weekly` entry to `<text>` (replacing that week's entry, newest first)
- **FR:cos.gaps.@function** (P1): Interface: `priGaps(pris: Pri[], linked: Map<string, number>, now: Date): PriGap[]`. `PriGap` is `{ id, rank, title, gaps, lastStatus?, days?, linked }`
- **FR:cos.gaps.kinds** (P1): For each `active` or `blocked` priority, `gaps` MUST list `no-status` when it has no `statusAt` and no `weekly` entry, `stale` when the last status is more than 7 days old, and `no-tasks` when no open task links to it (an open task is a leaf that is not parked and not a `💬` message). The last status is the newer of `statusAt` and the Monday of the newest `weekly` week. Priorities with no gap are left out
- **FR:cos.gaps.cli** (P1): `stack pris gaps` MUST print one line per gap priority, in priority order (`<rank>. <id> <title>: <gaps> [last <n>d] -> <next command>`), or `no gaps`. The next command is `stack pris note <id> "..."` for a status gap, else `stack pris link <id> --keywords "..."`. It needs the content repo to count links. `--json` prints the list

### FR:bakeoff: Prove it on the owner ground truth

- **FR:bakeoff.fixture** (P1): Fixtures MUST hold the ground-truth tasks, the owner's 12 ordered priorities of 2026-11-11 with link terms, and the owner picks
- **FR:bakeoff.ground-truth** (P1): With priorities built from the ground-truth table (ranks 1-6, in order) on the `auto-priority` fixture tasks at 2026-11-05, the `pris` engine MUST keep the ground-truth order 1-6 (`checkMisses` returns none)
- **FR:bakeoff.picks** (P1): With the fixture priorities, the `pris` top 10 MUST hit at least 8 owner picks and more than the `autopri` top 10 (`pickMatch`), and `docs/scoring-bakeoff-pris.md` MUST show both top-10 lists next to the picks

## Data Model

- **FR:$pri-link** (P1): **`PriLink`** — `id`, `rank`, `title`, `via` (`ref`, `keyword` or `project`), `term`, `boost`.
- **FR:$pri-gap** (P1): **`PriGap`** — `id`, `rank`, `title`, `gaps` (`no-status`, `stale`, `no-tasks`), `lastStatus` (ISO), `days`, `linked` (count).

## Architecture Constraints

- Links and status live in `~/.stack/pris.json`, never in git. No task file changes.
- Link, boost and gap logic are pure functions. File I/O stays in the CLI and `PriStore`.
- No LLM call.
