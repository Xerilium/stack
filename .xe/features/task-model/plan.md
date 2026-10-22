---
id: task-model
title: Task Model Plan
---

# Plan: Task Model

## Approach

Plain TypeScript interfaces plus pure functions in `src/core/model.ts`. Validators return issue lists instead of throwing so callers (parser, CLI, API) can show every problem at once; `assertValid` is the throwing wrapper.

## Data Model

See spec `## Data Model`. Types: `Task`, `Section`, `Project`, `Recurrence`, `TaskStatus`, `Autonomy`, `Cadence`, `Weekday`, `IsoDate`, `ValidationIssue`.

## Contracts

- `createTask(init: Partial<Task> & {id, title}): Task`, `createSection(name, tasks?)`, `createProject(init: {id, name} & Partial<Project>)`
- `validateTask|Section|Project|Recurrence(x, path?): ValidationIssue[]`
- `isIsoDate(s): boolean` (strict calendar check)
- `assertValid(issues): void` throws `ModelValidationError`

## Decisions

- Issue codes are stable strings (`required`, `invalid-enum`, `out-of-range`, `invalid-date`, `date-order`, `duplicate`, `recurrence-needs-due`, `invalid-recurrence`) so surfaces can map them
- Dates are strings, not `Date`, to stay timezone-free; time-zone handling lives in config
- Tests live in `tests/core/model.test.ts`
