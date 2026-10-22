---
id: config
title: Stack Configuration
description: Load, default, and validate Stack settings and resolve the active time block
dependencies: []
---

<!-- markdownlint-disable single-title -->

# Feature: Stack Configuration

## Purpose

Provide one validated source of Stack settings (timezone, time blocks, scoring weights) with safe defaults, so every other feature reads configuration the same way.

## Scenarios

### FR:load: Load configuration

Stack needs to turn a user's `stack.json` into a complete, validated configuration so that every feature behaves predictably even when the file is partial or missing.

- **FR:load.@function** (P1): Interface: `parseConfig(input?: unknown): StackConfig`
- **FR:load.input** (P1): Parsed JSON from `.xe/config/stack.json` (object) — may be undefined or partial
- **FR:load.defaults** (P1): `parseConfig` MUST return legacy default values for every setting the input omits
- **FR:load.merge** (P1): `parseConfig` MUST override defaults with input values per key, merging weight maps per category
- **FR:load.timeblocks-replace** (P2): `parseConfig` MUST replace the default time blocks entirely when the input defines `timeBlocks`
- **FR:load.validate** (P1): `parseConfig` MUST throw `ConfigError` naming the invalid path when a value has the wrong type
  - **FR:load.validate.time** (P1): `parseConfig` MUST reject time values not in `HH:mm` format
  - **FR:load.validate.days** (P2): `parseConfig` MUST reject day names outside Sun-Sat
  - **FR:load.validate.timezone** (P2): `parseConfig` MUST reject timezones unknown to the runtime
- **FR:load.output** (P1): StackConfig (@req FR:$stack-config)

### FR:time-block: Resolve active time block

Stack needs to know which time block a moment falls in so that tasks can be filtered by time of day.

- **FR:time-block.@function** (P1): Interface: `getTimeBlock(config: StackConfig, at: Date): TimeBlock | undefined`
- **FR:time-block.input** (P1): Config (@req FR:$stack-config), instant (Date)
- **FR:time-block.resolve** (P1): `getTimeBlock` MUST return the block whose day and time range contains the instant in the configured timezone
- **FR:time-block.overnight** (P1): `getTimeBlock` MUST treat a range whose end is before its start as crossing midnight, attributing early-morning hours to the previous day's block
- **FR:time-block.none** (P2): `getTimeBlock` MUST return undefined when no block contains the instant
- **FR:time-block.output** (P1): TimeBlock or undefined

## Data Model

- **FR:$stack-config** (P1): **`StackConfig`** — Complete configuration.
  - `timezone` (string) — IANA id. Default: America/Los_Angeles.
  - `startOfDay` (string) — `HH:mm`. Default: 08:00.
  - `timeBlocks` (TimeBlock[]) — Default: legacy Work, Family evening, Family weekend, Shichael, Project, Sleep.
  - `taskScoring` (object) — `emojiWeights` (category → emoji → number) and `effortHours` (emoji → number); defaults from legacy.
- **FR:$time-block** (P1): **`TimeBlock`**
  - `name` (string), `label` (string?), `days` (string[]), `startTime` (string), `endTime` (string), `emoji` (string)

## Architecture Constraints

- Pure functions; no file or network access (storage is a separate feature).

## External Dependencies

None
