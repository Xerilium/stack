---
id: cos-view
title: Chief of Staff view
author: flanakin
description: "One experimental place for the owner: next meetings, top messages to answer, top actions, one task, and the next 90 minutes."
dependencies: [web-app, home, ask-queue, top-asks, day-inputs]
---

# Feature: Chief of Staff view

## Purpose

The owner wants one place: next meeting(s), top messages, top actions, one task. Research: `research.md`. Audit and decision: `audit.md`.

## Scenarios

### FR:brief: Brief (Experimental)

- **FR:brief.nav** (P1): Nav has a `Brief` entry (chord `g b`) tagged `Experimental` in the rail and in More. Hash `#/brief`. Existing views are unchanged
- **FR:brief.meetings** (P1): Up to 2 busy meetings that have not ended: title, start time, `in 25m` or `now`, and `Join` when a join link exists and the meeting starts within 10 min or is on
- **FR:brief.messages** (P1): Up to 3 open asks from `email-triage`, best score first. Each shows ask, why, the draft or recommendation, and one primary button (the ask's primary action). `{n} more` links to Needs you
- **FR:brief.actions** (P1): Up to 3 open asks that are not messages, best score first, same card. `{n} more` links to Needs you
- **FR:brief.one** (P1): The one task is Home's task (server rank): title, project, Start, Done, Delegate. When none: `Nothing active`
- **FR:brief.ninety** (P2): `Next 90 minutes`: a strip of meetings and free gaps of 15 min or more from now, clipped to 90 min and to bed. The one task shows in the first gap long enough for its effort. A suggestion only; nothing is moved
- **FR:brief.empty** (P2): With no meetings, messages, or actions, each empty section says so in one short line; the page never shows a blank
- **FR:brief.phone** (P1): At 375 px: one column, no horizontal scroll, 44 px tap targets

## Dependencies

web-app (rows, Start/Done/Delegate), ask-queue (asks, answers), home (rank, window), day-inputs (calendar).

### FR:meet: Meetings source (Brief)

The Brief needs meetings even when no calendar is signed in. Two layers; the first that works wins.

- **FR:meet.layers** (P1): Layer 1 is the live calendar (`GET /calendar`, Graph sign-in or feeds) when it is `configured` with no `error`. Layer 2 is the weekly schedule (`FR:meet.config`), used when layer 1 is not configured or failed. The Brief shows which layer it uses (`Live calendar` or `Weekly schedule`)
- **FR:meet.config** (P1): `.stack/meetings.md` lists weekly meetings, one bullet each: `- {days} {start}-{end}[ (biweekly)]: {title}[; topic: {text}][; owner: {agent}][; join: {https url}]`. Days: `Mon`, `Mon/Wed`, `Mon-Fri`, `Sun/Mon/Wed`. Times: `9-10`, `8:30-9`, `12-1p`, `11p-1a`, or 24 h `13:00-14:30`. With no `a` or `p`: hours 7 to 11 are am; 12 and 1 to 6 are pm; the end is the first time after the start. An end before the start crosses midnight. Owner is the agent in backticks or plain text. Other lines and bad bullets are skipped
- **FR:meet.api** (P1): `GET /meetings` (route `meetings.list`, scope `tasks:read`, owner only; tokens get `403`) returns `{items}` of parsed rules `{title, days, start, end, biweekly?, topic?, owner?, join?}` (`days` 0 = Sun). No file: `{items: []}`
- **FR:meet.expand** (P1): `expandWeekly(rules, day)` returns calendar events (busy, `FR:day-inputs/cal.model`, plus `owner` and `topic`) for the local day and the spill of the day before. A `biweekly` rule runs on every second ISO week (even weeks). Local clock times; DST safe
- **FR:meet.enrich** (P2): A live event whose title matches a rule title (case-insensitive, either contains the other) gets that rule's `owner`, `topic`, and `join` (when the event has none)
- **FR:brief.meetings.detail** (P1): Each Brief meeting shows start time, `in 25m` or `now`, title, owner agent, topic, and `Join` when a link exists and the meeting is on or starts within 10 min
- **FR:brief.free** (P1): `Free until`: when no meeting is on, `Free until {time} ({n}m)` to the next meeting (or bed); when one is on, `In a meeting until {time}`. It heads the `Next 90 minutes` strip, and the strip's first free gap starts at now
