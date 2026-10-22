---
id: recurring-rows
title: Recurring Rows Plan
---

# Plan: Recurring Rows

## Approach

One tokenizing parser over the first line locates the checkbox, date, cadence, and marker spans (both forms). Rolling edits only those spans in place, so every other byte survives (CRLF included). Date math uses UTC.

## Contracts

- `isRecurring(line, today?)`, `rollRecurring(block, today?, options?)` (stable; options added)
- `parseRecurringRow(line, today?) -> RecurringRow | null` maps to task-model `Recurrence`
- `RollOptions { shiftWeekends?: boolean }` (default true)

## Decisions

- Marker `<!--nominal:YYYY-MM-DD[ day:N]-->` at end of first line: hidden in markdown, one place for both weekend and clamp state
- `Quarterly-EOM+1`: mapped to `anchor: end-of-month` + new model field `offsetMonths: 1` (not `offsetDays`: unit differs)
- Weekday-name rows keep their text; no date to advance
- `shiftWeekends` lives in config; task-lifecycle passes `config.shiftWeekends` to `rollRecurring`
- Tests: `tests/core/recurring.test.ts`
