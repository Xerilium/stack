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

## Requirements

**FR-1**: Row format is `- [ ] 📅 {Mon D}: 🔄 {Cadence}: {title} {emoji...}`; date may carry a year (`Mon D, YYYY`).

**FR-2**: Supported cadences: Daily, Weekly, Monthly, Quarterly, Yearly (case-insensitive).

**FR-3**: Rolling advances the date by one cadence step from the row's current date, clamps to month end (Jan 31 + Monthly = Feb 28/29), then shifts Sat/Sun to Monday.

**FR-4**: Rolled rows stay unchecked; all other text (title, effort, subtasks) is preserved. Subtasks reset to `[ ]`.

**FR-5**: Non-recurring rows are never rolled (caller falls back to normal completion).

## Open decisions

- WA quarterly "last day of following month" rule: needs a cadence token (e.g. `Quarterly-EOM+1`). Deferred.
- Weekend shift can drift a day-of-month (15th→Mon 17th rolls from 17th). Fix needs a stored nominal day.

## Out of scope

Wiring into the `complete` command (depends on the CLI/complete-task feature).
