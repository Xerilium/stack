---
id: home
title: Home and My Day
author: flanakin
description: "The day plan and Home follow the owner's real schedule (wake to bed, focus and personal time, meetings): Home's fit uses the time until the next commitment, and My day is the schedule from wake to bed, every row one tap to act on."
dependencies: [schedule, day-inputs, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Home and My Day

## Purpose

The owner's first real use: at 11:12 PM the plan said the day ended at 11:15 PM; he goes to bed at 2 AM. The day plan must use his schedule, not a fixed 9-to-6 work day, and must take meetings out of it. Home must answer "what now, and does it fit" at a glance, and say what fits when the top task does not; My day is a schedule, and what does not fit stays out of the way.

## Scenarios

### FR:day: Schedule-aware day plan

- **FR:day.frame** (P1): The web app reads `GET /schedule` (`FR:schedule/api.schedule`) and plans on the waking day it returns: minutes are wall-clock minutes after local midnight of the day's `date`, so a 2:00 AM bed is minute 1560 and 1:00 AM on the next calendar date still belongs to the day. The plan starts at now (rounded up to 15 min), never before wake, and ends at bed. When the route fails, the plan falls back to 9:00-18:00 on the current date
- **FR:day.personal** (P1): Personal blocks are not task time: a task is planned inside a personal block only when its row carries that block's emoji (`🏠 Mow the lawn` can go in Family time). Such a task goes in its own block first, where it does not count against Available; when that block has no room it can use focus time like any task. Sleep is never planned. Personal blocks show on the day bar like meetings, in their own muted style
- **FR:day.available** (P1): The default Available is the focus time left: from the plan start to bed, minus personal blocks and busy meetings (overlaps counted once). `−`/`+` and `[`/`]` still adjust it for today
- **FR:day.calendar** (P1): Today asks `GET /calendar` for the waking day (`wake` to `bed`), so meetings after midnight are on the plan, and meetings outside the day are not
- **FR:day.asleep** (P2): When the schedule says the owner is asleep, the plan shows the next waking day from wake, and the header says `Tomorrow from 8:00a` (`Today from 8:00a` after midnight, when that day is today's date)
- **FR:day.refresh** (P2): The schedule is fetched again when the current time passes bed, or passes wake after an asleep answer, so a tab left open overnight moves to the new day

### FR:home: Home on the schedule

Home itself (the one thing, fit, up next, projects, countdowns) is `FR:web-app/home.*`. This feature feeds it the time you really have.

- **FR:home.window** (P1): The time left for Home's fit check is the window: minutes from now until the next of a busy meeting, the start of a personal block, or bed (`end of day` without a schedule). A line above the task says `{span} until {Allyte sync | Family | bed}`. Inside a meeting, sleep, or past bed the window is 0 and the line says so (`In Allyte sync until 4:30p`, `Past bed · back at 8:00a`: the next wake). Inside a personal block the window is the rest of the block, up to the next meeting, for rows tagged with its emoji only (`Family until 8:00p: only 🏠 tasks now`). The no-fit line reads `No time for this now: needs 2h, 45m until Allyte sync`
- **FR:home.have** (P1): "I have" picks 15m, 30m, 1h, 2h (`h` then `1`-`4`; `0` or Reset clears). A pick replaces the window from now until it runs out, then the window returns; it overrides personal time and bed. `]`/`[` and More time add or remove 30 min from what you have. Memory only
- **FR:home.delegate** (P1): Delegate (`Shift+A`, on Home and on every My day row; `a` talks to the task's agent) adds 🪄 to the front of the row (`POST /tasks/edit` with `expect`), so an agent takes it and it leaves your plan; the toast offers Undo. Not now (`n`) defers 2 hours in one tap; `z` keeps the full defer menu

### FR:myday: My day (the schedule)

- **FR:myday.timeline** (P1): My day (`g t`) is the waking day as a timeline: schedule blocks as band headers (`{label} · {start}–{end}`; personal bands muted), meetings, planned tasks, the email block, free gaps of 15 minutes or more (`{span} free`), and a now line. Time before the current band folds into one `Earlier` row
- **FR:myday.overflow** (P1): What does not fit is one collapsed line at the end (`{n} don't fit`, plus `· {k} due soon` in the warning color when any are at risk); expanded it lists at-risk tasks first (12 at most) then `{n} later`
- **FR:myday.actions** (P1): Every task row has one-tap Done, Start, Not now, and Delegate (icon buttons with labels; 44 px targets on touch). Keys work on the cursor row: `s`, `d`, `n`, `z`, `a`
- **FR:myday.quiet** (P2): Needs-you cards and AI team leave the top of the view: they sit below the timeline behind one summary line (`2 to decide · 1 CI failing`) until the Asks view carries them

## Dependencies

- schedule (`GET /schedule`), day-inputs (meetings), web-app (Today)
