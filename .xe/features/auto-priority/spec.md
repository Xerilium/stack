---
id: auto-priority
title: Auto-priority
author: flanakin
description: "Owner rules and task tags drive the ranking; picks and logged misses prove the top 10 matches the owner."
dependencies: [scoring-engine, scoring-bakeoff]
---

<!-- markdownlint-disable single-title -->

# Feature: Auto-priority

## Purpose

The owner should not edit scores. Override rules (`.stack/priorities.json`) and task tags set the order. Picks and logged misses prove the top 10 matches the owner.

## Scope

- In: rule fixtures from the real file, untagged-task report, owner-pick match metric, miss parsing and regression check.
- Non-goals: new rule effects or a new formula (scoring-engine, scoring-bakeoff); file I/O; changing the default engine.
- Rules already apply through `applyOverrides` (@req FR:scoring-engine/overrides). This feature adds the proof and the feedback loop.

## Scenarios

### FR:rules: Real rules rank as the owner wants

- **FR:rules.fixture** (P1): The real `priorities.json` rules (match, effect, why, until, by) MUST parse with no rule skipped
- **FR:rules.effects** (P1): With those rules, `hide` rows MUST be absent, `down` rows last, and `top` rows first while their `until` date has not passed
- **FR:rules.expired** (P1): A rule MUST NOT apply on or after its `until` date

### FR:tags: Task tags feed the score

Every task needs value or impact tags so it scores. A task without them ranks by position only.

- **FR:tags.@function** (P1): Interface: `untaggedTasks(scored: ScoredTask[]): ScoredTask[]`
- **FR:tags.untagged** (P1): `untaggedTasks` MUST return each leaf whose breakdown has no Value, Impact, or Priority contribution, in input order
- **FR:tags.parked** (P2): `untaggedTasks` MUST skip parked leaves

### FR:picks: Top 10 matches the owner

- **FR:picks.@function** (P1): Interface: `pickMatch(ranked: { text: string; context?: string }[], picks: string[], n?: number): PickMatch`
- **FR:picks.match** (P1): A pick is hit when a whole word or phrase of it is in the text or context of one of the first `n` rows (default 10), case-insensitive. `PickMatch` is `{ hits: string[]; misses: string[]; n: number }`

### FR:misses: Logged misses become regression checks

- **FR:misses.@function** (P1): Interface: `parseMisses(text: string): Miss[]` and `checkMisses(ranked, misses): Miss[]`
- **FR:misses.parse** (P1): `parseMisses` MUST read lines `- YYYY-MM-DD: "<above>" over "<below>"` under the `## Auto-pri misses` heading and skip other lines
- **FR:misses.check** (P1): `checkMisses` MUST return each miss still wrong: the `above` row is absent or ranks after the first `below` row. A missing `below` row is correct

## Data Model

- **FR:$miss** (P1): **`Miss`** — `date` (string), `above` (string), `below` (string).

## Architecture Constraints

- Pure functions; no file or network access.

### FR:engine: The `autopri` engine ranks the owner's ground truth

Formula: `(unblock + urgency + value) / sqrt(effort)`. Unblocker beats nearest hard date, which beats value. Registered next to `stack`; never the default.

- **FR:engine.@function** (P1): Interface: `autopriEngine: ScoringEngine` and `registerAutopriEngine(): void` (idempotent)
- **FR:engine.unblock** (P1): A leaf with the `🔓` marker (or a parent with it) MUST rank above every leaf without it, due or not
- **FR:engine.blockers** (P1): A task that blocks another (`-- after <title>`) MUST score at least as high as the most urgent task it blocks, transitively
- **FR:engine.urgency** (P1): A dated leaf MUST score `2000` when due today or overdue (up to 30 days), else `2000 / (1 + days) ^ 2`; undated leaves score `0`. A date far out MUST NOT lift a task above an undated task with Priority and Impact tags and equal value
- **FR:engine.project-value** (P1): Value MUST include half the project's own value score (`**Project value:**` emojis), so a task in a high-value project beats a similar one in a low-value project
- **FR:engine.horizon** (P2): A dated leaf past `NOW_HORIZON_DAYS` MUST stay ranked (not dropped), so it can reach the top 10
- **FR:engine.rows** (P1): Parked leaves and `💬` messages MUST be absent
- **FR:engine.ground-truth** (P1): On the fixture tasks at 2026-11-05, the order MUST be Catalyst sweeps, FH 0.10, FTK v15 blog, FTK v16 PRs, Christmas After Dark, FOCUS v1.6 (`checkMisses` returns none)

### FR:autopri-tagging: Tag tasks and explain the ranking

CoS owns the todo `tasks/` files. Stack gives it a command to set the tags the `autopri` engine reads, and a report that shows why each task scores as it does.

- **FR:tag.@function** (P1): Interface: `applyTags(line: string, tags: { unblocker?: boolean; due?: string | null }): string` (pure) and `tagTask(ctx, ref, tags): Promise<LifecycleResult>`
- **FR:tag.unblocker** (P1): `unblocker: true` MUST add `🔓` once; `false` MUST remove it. Adding twice MUST change nothing
- **FR:tag.due** (P1): `due: 'MMM d'` MUST set one `📅 MMM d:` marker, replacing any old one. `due: null` MUST remove it. Any other format MUST throw
- **FR:tag.cli** (P1): `stack tag <ref> [--unblocker yes|no] [--due "MMM d"|none]` MUST edit the row and commit. It MUST need at least one flag. `--unblocker` MUST accept only `yes` or `no`
- **FR:explain.parts** (P1): `autopriParts(...)` MUST return `{ unblock, urgency, value }` per task id; the engine score MUST be their sum before blockers lift
- **FR:explain.cli** (P1): `stack rank --engine autopri --explain` MUST print, per ranked task, rank, ref, score, and `unblock`, `urgency`, `value` parts. `--top n` limits rows. `--engine` accepts `autopri` or `stack`. `--explain` needs `--engine autopri`
- **FR:truth.parse** (P1): `parseTruth(text)` MUST read the ground-truth table rows (`| Rank | Project | Work | Hard date | Why |`) with a numeric or `-` rank
- **FR:truth.match** (P1): A ground-truth item matches a task when the project name or alias matches (when one resolves) and every anchor is in the task text or context. Anchors are the version tokens of the work (`0.3.4`, `v16`, `v1.6`), else its first three words
- **FR:truth.report** (P1): With `--truth <file>`, the report MUST list each item as ranked (with its actual rank), untagged (matched; needs `🔓` because its Why says unblock/enabler/speeds; names the `stack tag` command), or missing (no task; names the `stack add` command, and the date when the Hard date is `MMM d`)
