---
id: my-day-grid
title: My Day Grid
author: flanakin
description: "My day as a calendar day grid of equal 30-minute slots: meetings and planned tasks sized by their real duration, empty slots you can tap to place a task, details beside the grid when there is room. The agenda list stays as an option."
dependencies: [home, schedule, day-inputs, task-detail-design]
---

<!-- markdownlint-disable single-title -->

# Feature: My Day Grid

## Purpose

The owner: "My day is overwhelming; too much on screen. It is like Agenda view in Outlook/GCal, which I hate." He wants real 30-minute slots, all the same size, so the day is a clean picture. It can scroll. Details open to the right when there is room, else full page with Back.

## Scope

- In: a Grid view of My day (default), a `Grid | Agenda` switch kept per device, day navigation, placing a task in a free slot (tap or drag), the block detail as a side panel or full page.
- Out: writing to calendars, editing meeting times, a multi-day week grid, resizing a task by drag.

## Decisions

- **Placements live in browser storage, per date.** A placement is a pin for one day, not a task property: it must not edit the markdown row or sync across devices. Key `stack.placed`; dates before today are dropped on save.
- **The planner books placed tasks first.** `buildPlan` takes `fixed` (`ref` to start minute). A placed task is booked at its time (it counts against Available, even over it: placing is explicit), then the rest plan around it. One planner, so Grid and Agenda never disagree.
- **Each meeting is its own block.** The planner merges overlapping meetings into busy spans; the grid draws each calendar event at its own start and end, side by side when they overlap.
- **The Agenda view is the existing timeline** (`FR:home/myday.timeline`), unchanged.

## Scenarios

### FR:view: Views

- **FR:view.default** (P1): My day opens in Grid. The header has a `Grid | Agenda` segmented control (`radiogroup`). The choice is kept per device in browser storage (`stack.myday.view`); a blocked storage falls back to Grid
- **FR:view.header** (P1): Grid shows one quiet header and the grid, nothing else: the date (`Tomorrow · ` on tomorrow), the waking hours, all-day events in one caption line, `Previous day`, `Today`, `Next day`, and the view switch. No day bar, no needs or agent panels, no shortcut-key badges
- **FR:view.nav** (P1): `Previous day` and `Next day` show the waking day before or after the shown one (schedule and calendar for that day); `Today` returns and is disabled on today. A future day is planned from its wake; a past day shows its meetings only

### FR:grid: The grid

- **FR:grid.slots** (P1): The grid is a column of 30-minute slots from wake (rounded down to :00 or :30) to bed (rounded up). Every slot has the same height (48 px). Full hours carry a time label (`9a`, `12p`); personal schedule blocks are shaded and labelled with their name
- **FR:grid.now** (P1): On today, a now line marks the current minute with its time. On open the grid scrolls so the now line sits near the top third of the view. On another day, or asleep, there is no now line and the grid scrolls to the first block
- **FR:grid.meetings** (P1): Each busy, tentative, or out-of-office calendar event (not cancelled, not all-day; Graph or ICS) is a block from its start to its end, at least one slot tall to read. Overlapping blocks share the width side by side. A block shows its title and time; tentative is dashed. A meeting with a join link shows `Join` (opens in a new tab)
- **FR:grid.tasks** (P1): Each planned task from the planner (`FR:home/day.*`) is a block at its planned start with its estimated duration; the email block is drawn the same way. A placed task shows a pin mark
- **FR:grid.free** (P1): A free slot (no block in it, inside the waking day, not past) is visibly empty. It is a button `Place a task at 2:30p`. Activating it opens a `Place here` list: tasks that do not fit first, then planned tasks; picking one places it there. Esc or `Cancel` closes the list
- **FR:grid.drag** (P2): On a pointer device a task block can be dragged onto a free slot; dropping places it there
- **FR:grid.place** (P1): A placement is saved for that date (`stack.placed`); the planner books it at that start before the other tasks (`fixed`). A placement in the past or for another date is ignored. A toast confirms `Placed at 2:30p` with Undo

### FR:detail: Detail

- **FR:detail.open** (P1): Click, tap, or Enter on a block opens its detail. A task opens the task detail (`FR:task-detail-design/detail.*`); a meeting opens a meeting detail: title, time, organizer, status, `Join` when there is a link, `Open in calendar` when there is a web link
- **FR:detail.side** (P1): At 1100 px wide or more, the detail is a right-hand panel; the grid stays visible and usable, and the selected block is highlighted. Below 1100 px it takes the full page with a `Close` button. Esc closes it in both

### FR:look: Look

- **FR:look.fluent** (P1): Fluent 2 tokens (`docs/design-system.md`). Blocks look clickable: pointer cursor, hover background change, focus ring. 44 px targets on touch. No horizontal page scroll at 375 px; axe clean in light and dark at 375 and 1280 px

## Dependencies

- home (the planner, the Agenda timeline), schedule (`GET /schedule`), day-inputs (`GET /calendar`), task-detail-design (task detail)
