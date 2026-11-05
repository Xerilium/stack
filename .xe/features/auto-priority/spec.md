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
