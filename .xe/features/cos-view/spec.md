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
