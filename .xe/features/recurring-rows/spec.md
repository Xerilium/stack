---
id: recurring-rows
title: Recurring Rows
author: flanakin
description: "Auto-roll 🔄 recurring task rows to their next due date on completion."
dependencies: []
---

# Feature: Recurring Rows

## Problem

Recurring deadlines (bills, tax filings) need one row per obligation. Hand-editing the 📅 date after each completion is error-prone. Ported from the legacy prototype (`todo` spec `recurring-rows`, PR 72).

## Goals

- One row per recurring obligation; never duplicated, never deleted
- Completing a 🔄 row rolls its 📅 date forward and leaves it `[ ]`
- Weekend due dates move to the next business day

## Scenarios

### FR:format: Row format

- **FR:format.row** (P1): Row format is `- [ ] 📅 {Mon D}: 🔄 {Cadence}: {title} {emoji...}`; date MAY carry a year (`Mon D, YYYY`); month is case-insensitive
- **FR:format.cadence** (P1): Supported cadences: Daily, Weekly, Monthly, Quarterly, Yearly (case-insensitive; written case is preserved)
- **FR:format.crlf** (P2): `rollRecurring` and `isRecurring` MUST accept CRLF blocks; line endings are preserved on output

### FR:detect: Detection

- **FR:detect.@function** (P1): Interface: `isRecurring(line: string, today?: Date): boolean`
- **FR:detect.non-recurring** (P1): Non-recurring rows MUST NOT roll (`rollRecurring` returns null; caller falls back to normal completion)
- **FR:detect.valid** (P1): Invalid dates (Feb 31, day 0, unknown month, Feb 29 in a non-leap year) MUST yield null from `rollRecurring`, and `isRecurring` MUST agree

### FR:roll: Rolling

- **FR:roll.@function** (P1): Interface: `rollRecurring(block: string, today?: Date): string | null`; `today` supplies the year when the row has none
- **FR:roll.step** (P1): Rolling advances the date by one cadence step from the row's current date
- **FR:roll.clamp** (P1): Month-based steps clamp to month end (Jan 31 + Monthly = Feb 28/29). Known drift: the clamped day is carried forward (Jan 31 -> Feb 28 -> Mar 28)
- **FR:roll.weekend** (P1): Sat/Sun results shift to Monday. Known drift: the shifted day is carried forward (15th -> Mon 17th rolls from 17th)

### FR:preserve: Preservation

- **FR:preserve.unchecked** (P1): Rolled rows are unchecked (`[ ]`) whether the input was `[ ]`, `[x]`, or `[X]`
- **FR:preserve.text** (P1): All other text (title, effort, emoji) is preserved
- **FR:preserve.subtasks** (P1): Checked subtask checkboxes at any indent reset to `[ ]`; non-checkbox continuation lines are untouched

## Open decisions

Out of this slice (follow-up slice; see rollout-blueprint):

- Legacy row form `🔄 Weekly: 📅 Mondays:`
- Weekday names as dates
- WA quarterly "last day of following month" token (`Quarterly-EOM+1`)
- Nominal-day anti-drift (stored nominal day to fix weekend shift and month-end clamp drift)

## Out of scope

Wiring into the `complete` command (depends on the CLI/complete-task feature).
