---
id: home
title: Home and My Day
author: flanakin
description: "The day plan follows the owner's real schedule (wake to bed, focus and personal time, meetings), so the time on offer is the time he actually has."
dependencies: [schedule, day-inputs, web-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Home and My Day

## Purpose

The owner's first real use: at 11:12 PM the plan said the day ended at 11:15 PM; he goes to bed at 2 AM. The day plan must use his schedule, not a fixed 9-to-6 work day, and must take meetings out of it.

## Scenarios

### FR:day: Schedule-aware day plan

- **FR:day.frame** (P1): The web app reads `GET /schedule` (`FR:schedule/api.schedule`) and plans on the waking day it returns: minutes are wall-clock minutes after local midnight of the day's `date`, so a 2:00 AM bed is minute 1560 and 1:00 AM on the next calendar date still belongs to the day. The plan starts at now (rounded up to 15 min), never before wake, and ends at bed. When the route fails, the plan falls back to 9:00-18:00 on the current date
- **FR:day.personal** (P1): Personal blocks are not task time: a task is planned inside a personal block only when its row carries that block's emoji (`🏠 Mow the lawn` can go in Family time). Sleep is never planned. Personal blocks show on the day bar like meetings, in their own muted style
- **FR:day.available** (P1): The default Available is the focus time left: from the plan start to bed, minus personal blocks and busy meetings (overlaps counted once). `−`/`+` and `[`/`]` still adjust it for today
- **FR:day.calendar** (P1): Today asks `GET /calendar` for the waking day (`wake` to `bed`), so meetings after midnight are on the plan, and meetings outside the day are not
- **FR:day.asleep** (P2): When the schedule says the owner is asleep, the plan shows the next waking day from wake, and the header says `Tomorrow from 8:00a`
- **FR:day.refresh** (P2): The schedule is fetched again when the current time passes bed, so a tab left open overnight moves to the new day

## Dependencies

- schedule (`GET /schedule`), day-inputs (meetings), web-app (Today)
