---
id: scoring-bakeoff
title: Scoring Bake-off
author: flanakin
description: "Alternative scoring engine plus a harness and report that compare it with the default on real task data."
dependencies: [scoring-engine]
---

<!-- markdownlint-disable single-title -->

# Feature: Scoring Bake-off

## Purpose

Test whether a redesigned formula ranks tasks better than the legacy one, using the owner's real task files, without changing what Stack does today. The default engine stays `legacy`; this feature only adds an alternative and the evidence to judge it.

## Scope

- In: the `balanced` engine, a pure comparison function, a markdown report renderer, a runner that reads a tasks directory and writes the report.
- Non-goals: changing the default engine or any legacy behavior; switching the default (needs owner approval); writing to the tasks directory.

## Scenarios

### FR:engine: Balanced engine

Legacy divides score by raw effort hours, so a 0.2h task outranks a 4h task with 20x less value, and a negative score divided by a larger effort moves toward zero (large bad tasks look better than small bad ones). Balanced fixes both.

- **FR:engine.interface** (P1): `balancedEngine` MUST implement `ScoringEngine` with id `balanced`
- **FR:engine.shape** (P1): `score` MUST return the same tasks, leaf and parked flags, and breakdown parts (emoji, project, placement, base, effort hours) as the legacy engine for the same input; only `score` and `calculatedTotal` differ
- **FR:engine.divisor** (P1): Effective effort MUST be the square root of effort hours, dampening the small-task bias
- **FR:engine.sign** (P1): A non-negative base MUST be divided by the effective effort; a negative base MUST be multiplied by it, so larger negative tasks never outrank smaller ones
- **FR:engine.filter** (P1): `filter` MUST behave exactly like the legacy time-block filter
- **FR:engine.register** (P2): `registerBalancedEngine()` MUST register the engine once and be safe to call repeatedly; it MUST NOT change the default engine
- **FR:engine.default** (P1): `getEngine()` with no id MUST still return the legacy engine

### FR:compare: Compare engines

- **FR:compare.@function** (P1): Interface: `compareEngines(a: ScoringEngine, b: ScoringEngine, projects: ScoringProject[], config: StackConfig, topN?: number): BakeoffResult`
- **FR:compare.population** (P1): Both engines MUST rank the same population: unparked leaf tasks, no time filter
- **FR:compare.agreement** (P1): The result MUST include task count, top-1 agreement, top-N overlap fraction, Spearman rank correlation, and mean and max absolute rank shift
- **FR:compare.effort-mix** (P1): The result MUST include, per engine, the share of the top N by effort class (quick `🔹🟢`, medium `🟡🟠`, large `🔴⚫️`, none)
- **FR:compare.movers** (P1): The result MUST include the largest rank movers as anonymized records: project letter, effort emoji, priority and impact emojis, and both ranks, never task text or project names
- **FR:compare.empty** (P2): Zero ranked tasks MUST yield zero-valued metrics, not an error or NaN
- **FR:compare.pure** (P1): Comparison MUST be deterministic and MUST NOT mutate its inputs

### FR:report: Report

- **FR:report.@function** (P1): Interface: `renderReport(result: BakeoffResult, recommendation: string): string`
- **FR:report.aggregate** (P1): The report MUST contain only aggregate numbers and anonymized movers; it MUST NOT contain task text, project names, or file names
- **FR:report.recommendation** (P1): The report MUST state that the default is unchanged and include the supplied recommendation

### FR:run: Runner

- **FR:run.@function** (P1): Interface: `runBakeoff(tasksDir: string, outFile: string, recommendation: string): BakeoffResult`
- **FR:run.readonly** (P1): The runner MUST only read the tasks directory and write the one output file
- **FR:run.load** (P1): Each `*.md` file MUST load through `parseProject` and `toScoringProject`, named from its file name, in file-name order
