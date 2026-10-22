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
- Weekend due dates move to the next business day without drifting

## Scenarios

### FR:format: Row format

- **FR:format.row** (P1): Canonical form `- [ ] 📅 {date}: 🔄 {Cadence}: {title} {emoji...}`; `{date}` is `Mon D` or `Mon D, YYYY` (month case-insensitive)
- **FR:format.legacy** (P1): Legacy form `- [ ] 🔄 {Cadence}: 📅 {date}: {title}` MUST parse and roll identically; the form is preserved on output
- **FR:format.cadence** (P1): Cadences: Daily, Weekly, Monthly, Quarterly, Yearly (case-insensitive; written case preserved) and the token `Quarterly-EOM+1`
- **FR:format.weekday** (P1): `{date}` MAY be a weekday name (`Mon`, `Monday`, `Mondays`, case-insensitive) on Weekly rows in either form. The name is the recurrence: rolling unchecks the row and resets subtasks but leaves the text unchanged
- **FR:format.eom** (P1): `Quarterly-EOM+1` rows are due on the last day of the month following a quarter end. Rolling moves the nominal date to the last day of the month 3 months later (Jan 31 -> Apr 30 -> Jul 31)
- **FR:format.crlf** (P2): `rollRecurring` and `isRecurring` MUST accept CRLF blocks; line endings are preserved on output

### FR:detect: Detection

- **FR:detect.@function** (P1): Interface: `isRecurring(line: string, today?: Date): boolean`
- **FR:detect.parse** (P2): Interface: `parseRecurringRow(line: string, today?: Date): RecurringRow | null` returns `form`, `recurrence` (task-model `Recurrence`: `cadence`, `weekdays`, `anchor: 'end-of-month'` for EOM), `dueDate` / `nominalDay` (ISO) for dated rows. `offsetDays` is NOT mapped (the `+1` in `Quarterly-EOM+1` is months, not days; lossless mapping is not possible)
- **FR:detect.non-recurring** (P1): Non-recurring rows MUST NOT roll (`rollRecurring` returns null; caller falls back to normal completion)
- **FR:detect.valid** (P1): Invalid dates (Feb 31, day 0, unknown month, Feb 29 in a non-leap year) MUST yield null from `rollRecurring`, and `isRecurring` MUST agree

### FR:roll: Rolling

- **FR:roll.@function** (P1): Interface: `rollRecurring(block: string, today?: Date, options?: RollOptions): string | null`; `today` supplies the year when the row has none. Existing two-argument calls keep working
- **FR:roll.step** (P1): Rolling advances the nominal date by one cadence step
- **FR:roll.clamp** (P1): Month-based steps clamp to month end (Jan 31 + Monthly = Feb 28/29). The intended day is retained so the clamp does not drift (Jan 31 -> Feb 28 -> Mar 31)
- **FR:roll.weekend** (P1): `options.shiftWeekends` (default true; caller passes the config value) shifts Sat/Sun due dates to Monday. Daily rows have no nominal day: they advance from the shown date
- **FR:roll.nominal** (P1): When the shown date differs from the nominal date (weekend shift or clamp), the row ends with a hidden marker `<!--nominal:YYYY-MM-DD-->`, or `<!--nominal:YYYY-MM-DD day:N-->` when a clamp hides intended day N. The marker is the roll base when present, and removed when no longer needed (Aug 15 Sat -> shown Aug 17 -> next Sep 15). It is ignored when `shiftWeekends` is false except for clamp state

### FR:preserve: Preservation

- **FR:preserve.unchecked** (P1): Rolled rows are unchecked (`[ ]`) whether the input was `[ ]`, `[x]`, or `[X]`
- **FR:preserve.text** (P1): All other text (title, effort, emoji, spacing, other lines) is preserved byte-for-byte; only the checkbox, date, and nominal marker of the first line change
- **FR:preserve.subtasks** (P1): Checked subtask checkboxes at any indent reset to `[ ]`; non-checkbox continuation lines are untouched

## Out of scope

Wiring into the `complete` command (depends on the CLI/complete-task feature).
