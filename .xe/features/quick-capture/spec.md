---
id: quick-capture
title: Quick Capture
author: flanakin
description: "Natural-language and speech add: a deterministic parser turns phrases like 'call dentist tomorrow 30m' into a task and adds it through the lifecycle. Core module, POST /capture, and `stack capture`."
dependencies: [api, task-lifecycle, recurring-rows]
---

<!-- markdownlint-disable single-title -->

# Feature: Quick Capture

## Purpose

Add a task with one phrase, typed or dictated. No LLM, no network: same input and clock always give the same task.

## Scope

- In: deterministic parser, speech-transcript tolerance, mapping to `addTask`, `POST /capture`, `stack capture`.
- Non-goals: AI triage, time-of-day, multi-weekday recurrence (rejected), changing existing core, api auth, or lifecycle behavior.

## Scenarios

### FR:parse: Parser

- **FR:parse.@function** (P1): `parseCapture(text, { now }) => CaptureSpec` where `CaptureSpec = { title, due?, effort?, project?, recurrence? }`. `now` is an injected clock (`() => Date`, default system); the parser is pure. Throws `CaptureError` when no title remains
- **FR:parse.due** (P1): Recognizes `today`, `tonight`, `tomorrow`, `day after tomorrow`, `in N days|weeks`, `next week` (next Monday), `[this|next|on] <weekday>` (next occurrence after today; `today` stays today), `end of month`, `<Mon> <d>`, `<d> <Mon>`, ISO `yyyy-mm-dd`. A leading `by|due|on` is consumed. Result is an ISO date in the clock's local calendar day (UTC date of `now`)
- **FR:parse.effort** (P1): Recognizes `30m`, `30 min`, `2h`, `1.5 hours`, `1h30m`, `half an hour`, `an hour`, `an hour and a half`, `N and a half hours`. Result `{ minutes, emoji }` with emoji 🔹 (<=12m), 🟢 (<=30m), 🟡 (<=60m), 🟠 (<=120m), 🔴 (<=240m), else ⚫️. A leading `for|takes|about` is consumed
- **FR:parse.project** (P1): `#name`, `@name`, or `in|for project <name>` sets the project hint (not part of the title)
- **FR:parse.recurrence** (P1): `daily|every day`, `weekly|every week`, `every <weekday>`, `monthly|every month`, `quarterly|every quarter`, `yearly|annually|every year` set `recurrence` (`weekdays` for a single weekday). A weekday recurrence's due is its next occurrence on or after today; others default to today unless a date is given. `every <weekday> and <weekday>` and `weekdays` are rejected with `CaptureError`
- **FR:parse.title** (P1): The title is the remainder with whitespace collapsed, dangling connectors (`to`, `by`, `on`, `at`, `for`, `in`, `due`) trimmed, first letter capitalized. Words inside the title that are not phrases stay (`call about the 3rd floor` keeps its text)

### FR:speech: Speech tolerance

- **FR:speech.fillers** (P1): Removes `um`, `uh`, `er`, `erm`, `hmm`, `you know`, `i mean`, and leading `please`, `hey`, `okay`, `so`, `remind me to`, `add (a) task (to)`, `new task`
- **FR:speech.numbers** (P1): Spoken numbers zero to ninety-nine (also hyphenated, `a hundred`) become digits before phrase matching, so `thirty minutes` and `in two days` parse like `30m` and `in 2 days`
- **FR:speech.case** (P1): Matching ignores case and trailing punctuation from transcripts

### FR:map: Mapping

- **FR:map.row** (P1): `toTaskText(spec, now)` renders the row text: `[📅 <date>: ][🔄 <Cadence>: ]<title>[ <effort emoji>]`; weekday recurrences use the weekday name as the date (`📅 Monday: 🔄 Weekly: ...`); a year is shown only when it differs from `now`'s
- **FR:map.add** (P1): `captureTask(ctx, text, { project?, section? })` parses with `ctx.now`, picks project (text hint, else option; neither is `LifecycleError`), calls `addTask`, and returns `{ result, spec }`. `dryRun` parses and renders without writing

### FR:api: API

- **FR:api.route** (P1): `POST /capture` `{text, project?, section?, dryRun?}` returns 201 `{changed, ref, after, spec}` (200 and no write on `dryRun`); validated like `POST /tasks` (unknown fields, single-line project/section, `text` up to 2000); parse errors are `422 invalid` with `details`; documented in `docs/api/openapi.yaml`

### FR:cli: CLI

- **FR:cli.cmd** (P1): `stack capture <text...> [--project name] [--section name] [--dry-run]` prints like `add`; `--json` includes `spec`; empty or unparseable text is a usage error (exit 2). Additive: no existing command changes

## Dependencies

- api, task-lifecycle (`addTask`), recurring-rows (row format)
