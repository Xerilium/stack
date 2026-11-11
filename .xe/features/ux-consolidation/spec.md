---
id: ux-consolidation
title: UX consolidation: one place
author: flanakin
description: "Now is the one place: one task, then the next meetings and the top messages. Brief folds into it; Home leaves the nav; My day stays the plan."
dependencies: [now-screen, cos-view, home, web-shell, stack-app]
---

<!-- markdownlint-disable single-title -->

# Feature: UX consolidation

## Purpose

Four views show the same task (Now, Home, Brief, My day). The owner wants one place that gives one task at a time, plus meetings and top messages. Evidence and decision: `.xe/features/stack-app/ux-review.md`. Principles: `design-principles.md` P1 (one thing), P5 (calm), P6 (same brain, two bodies).

Where this spec and `web-shell` or `cos-view` disagree on the nav, this spec wins.

## Scenarios

### FR:one: Now is the one place

- **FR:one.start** (P1): An empty or unknown hash opens Now (`#/now`). `#/` opens Now. Old `#/next` and `#/focus` still open Home
- **FR:one.meetings** (P1): Under the actions, `Next` lists up to 2 meetings that have not ended (`FR:cos-view/brief.meetings`): start time, title, `in 25m` or `now`, owner and topic when known, and `Join` when a link exists and the meeting is on or starts within 10 min. With none: `No meetings left today.` The layer (`Live calendar` or `Weekly schedule`) is shown as in `FR:cos-view/meet.layers`
- **FR:one.messages** (P1): `Waiting on you` lists up to 3 open asks, one line each: the ask, who it is from, and one primary button (the ask's primary action, `FR:cos-view/brief.messages`). Messages (`email-triage`) rank first by score, then other asks, so the list is the top 3 of the merged set. `{n} more in Needs you` opens Needs you when more exist. With none: `Nothing waiting.`
- **FR:one.answer** (P1): The primary button answers the ask the same way Needs you does (`FR:ask-queue/api.answer`), with the same toast and Undo. The line leaves the list
- **FR:one.focus** (P1): The task, its reason, and the three actions stay the only content above the first section head. Section heads are eyebrows (`caption` size, muted). Nothing in the sections is red unless overdue
- **FR:one.clamp** (P1): The task title clamps at 4 lines on touch and 3 on desktop; the full text is in the heading's `title`. Reason and actions never leave the first screen at 375x812
- **FR:one.layout** (P1): At 375 px: one column, no horizontal scroll, 44 px targets on every button and `Join`. At 1280 px: the 560 px measure of `FR:now-screen/now.layout`

### FR:nav: One nav

- **FR:nav.rail** (P1): The desktop rail lists, in order: New task, Now, My day, Needs you (count badge), Inbox, Agents, Projects, Full stack. No `Experimental` tag
- **FR:nav.tabbar** (P1): The phone tab bar: Now, My day, New task (centre), Needs you (count badge), More
- **FR:nav.brief** (P1): The Brief view is gone: no rail entry, no tab, no `g b`, no palette entry. `#/brief` opens Now. The web AI summary section is gone with it; the server route `GET /brief/summary` is unchanged
- **FR:nav.home** (P1): Home stays at `#/home` and `g h`, named `Top asks` in the palette (`Go to Top asks`). It is not in the rail or the tab bar
- **FR:nav.keys** (P1): Chords: `g n` Now, `g h` Top asks, `g d` or `g t` My day, `g k` Needs you, `g i` Inbox, `g s` Agents, `g p` Projects, `g a` Full stack

## Dependencies

now-screen (`nowOf`, `NowScreen`), cos-view (`briefOf`, meetings layers), ask-queue (answers), web-shell (rail, tab bar, palette).
