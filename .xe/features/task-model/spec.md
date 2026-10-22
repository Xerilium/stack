---
id: task-model
title: Task Model
description: Format-neutral Task, Project, Section, and Recurrence types with validation
dependencies: []
---

<!-- markdownlint-disable single-title -->

# Feature: Task Model

## Purpose

Defines the format-neutral data model every other Stack feature builds on, and the rules that decide whether model data is valid. Parsing, serialization, scoring, and IO are out of scope.

## Scenarios

### FR:model: Describe tasks and projects

Stack needs to represent projects, sections, tasks, subtasks, and recurrence in one format-neutral shape so that every formatter, engine, and surface shares the same data.

- **FR:model.@function** (P1): Interface: `src/core/model.ts` exports `createTask`, `createSection`, `createProject`
- **FR:model.defaults** (P2): `createTask` MUST default `status` to `todo`, `autonomy` to `none`, and `notes` and `subtasks` to empty lists
- **FR:model.dates** (P1): Model MUST hold dates as ISO `YYYY-MM-DD` strings
- **FR:model.output** (P2): Fresh, independent objects; `createTask`, `createSection`, and `createProject` MUST copy caller-supplied arrays (`notes`, `subtasks`, `tasks`, `aliases`, `sections`) so no array is shared with the caller or between calls. Copies are shallow: nested task objects are not cloned.

### FR:validate: Validate model data

Stack needs to validate model data so that bad values are rejected before they reach scoring or storage.

- **FR:validate.@function** (P1): Interface: `src/core/model.ts` exports `validateTask`, `validateSection`, `validateProject`, `validateRecurrence`, `isIsoDate`, `assertValid`
- **FR:validate.input** (P1): Model object (@req FR:$task, FR:$section, FR:$project, FR:$recurrence)
- **FR:validate.output** (P1): List of issues, each with a `path`, a `code`, and a `message`; empty when valid
- **FR:validate.collect** (P1): Validator MUST report all issues, not only the first
- **FR:validate.title** (P1): Validator MUST reject empty or whitespace-only task titles, project names, and section names
- **FR:validate.required** (P1): Validator MUST reject empty or whitespace-only task ids, project ids, and project aliases
- **FR:validate.enums** (P1): Validator MUST reject `status`, `autonomy`, and `cadence` values outside the allowed sets
- **FR:validate.numbers** (P1): Validator MUST reject non-finite numbers and values outside the allowed ranges for priority, impact, effort, value, projectValue, and capacity
- **FR:validate.dates** (P1): Validator MUST reject dates that are not real calendar dates in `YYYY-MM-DD` form
  - **FR:validate.dates.order** (P2): Validator MUST reject a `startDate` later than `dueDate`
- **FR:validate.recurrence** (P1): Validator MUST reject a recurring task without a `dueDate`
  - **FR:validate.recurrence.weekdays** (P2): Validator MUST reject `weekdays` unless cadence is `weekly`
  - **FR:validate.recurrence.weekdays.unique** (P2): Validator MUST reject a repeated weekday in `weekdays`
  - **FR:validate.recurrence.offset** (P2): Validator MUST reject a non-integer `offsetDays`
  - **FR:validate.recurrence.lenient** (P3): Validator MUST accept an empty `weekdays` list, and `anchor` or `offsetDays` on any cadence; `nominalDay` is checked as a date only and is not tied to `dueDate` or cadence (semantics belong to the recurrence feature)
- **FR:validate.subtasks** (P2): Validator MUST validate subtasks recursively and report paths such as `subtasks[0].title`
- **FR:validate.unique** (P2): Validator MUST reject duplicate task ids and duplicate section names within a project. One rule for all uniqueness checks: values are compared trimmed and case-insensitive (`" T1 "` equals `t1`)
  - **FR:validate.unique.aliases** (P2): Validator MUST reject a project alias that repeats another alias or the project name, using the same trimmed, case-insensitive comparison
- **FR:validate.assert** (P2): `assertValid` MUST throw a `ModelValidationError` carrying the issues when any exist

## Data Model

- **FR:$task** (P1): **`Task`** — One unit of work.
  - `id` (string) — Non-empty, unique within its project
  - `title` (string) — Non-empty
  - `status` (`TaskStatus`) — Allowed: todo, active, done, skipped, parked, suspended. Default: todo.
  - `priority` (number?) — Integer 1-5 (1 is highest)
  - `impact` (number?) — Integer 1-5
  - `effort` (number?) — Minutes, greater than 0
  - `value` (number?) — Zero or greater
  - `startDate` (string?) — ISO date
  - `dueDate` (string?) — ISO date
  - `recurrence` (`Recurrence`?)
  - `autonomy` (`Autonomy`) — Allowed: none, triage, assist, full. Default: none.
  - `notes` (string[]) — Free-text lines
  - `subtasks` (`Task`[])
- **FR:$section** (P1): **`Section`** — Named group of tasks.
  - `name` (string) — Non-empty
  - `tasks` (`Task`[])
- **FR:$project** (P1): **`Project`** — A list of work with its own value and capacity.
  - `id` (string) — Non-empty
  - `name` (string) — Non-empty
  - `aliases` (string[])
  - `projectValue` (number?) — Zero or greater
  - `capacity` (number?) — Minutes per week, zero or greater
  - `sections` (`Section`[])
- **FR:$recurrence** (P1): **`Recurrence`** — How a task repeats.
  - `cadence` (`Cadence`) — Allowed: daily, weekly, monthly, quarterly, yearly
  - `weekdays` (`Weekday`[]?) — Allowed: mon..sun; weekly only
  - `anchor` (string?) — Allowed: end-of-month
  - `offsetDays` (number?) — Integer; shifts from the anchor (for example `Quarterly-EOM+1`)
  - `nominalDay` (string?) — ISO date retained so rolls do not drift off weekends

## Architecture Constraints

- Model code MUST NOT import parsing, IO, or formatting code
- Model code MUST NOT depend on any runtime library

## External Dependencies

None
