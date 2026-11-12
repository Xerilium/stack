---
id: ux-consolidation
title: UX consolidation: one place
author: flanakin
description: "Now is the one place: one task, then the next meetings (from an honest calendar source) and the top asks as expandable cards. Brief folds into it; Home leaves the nav; My day stays the plan."
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
- **FR:one.meetings** (P1): Under the actions, `Next` lists up to 2 meetings that have not ended (`FR:cos-view/brief.meetings`): start time, title, `in 25m` or `now`, owner and topic when known, and `Join` when a link exists and the meeting is on or starts within 10 min. The layer (`Live calendar` or `Weekly schedule`) is shown as in `FR:cos-view/meet.layers`. `No meetings left today.` shows only when the calendar source is `ok` and fresh (`FR:cal.fresh`); otherwise the section never claims there are no meetings (`FR:cal.ui`)
- **FR:one.messages** (P1): `Waiting on you` lists up to 3 open asks as cards: messages (`email-triage`) rank first by score, then other asks, so the list is the top 3 of the merged set. Each card has 16 px padding, a 12 px gap to the next, and shows the ask (up to 2 lines), the source agent's avatar and name, the deadline when set, and the ask's primary action (`FR:cos-view/brief.messages`). `{n} more in Needs you` (an accent link with an arrow, 44 px on touch) opens Needs you when more exist. With none: `Nothing waiting.`
- **FR:one.expand** (P1): Tapping or clicking the card body (everything but its buttons) expands the card in place; it never navigates. The body is a button with `aria-expanded` and `aria-controls`; `Enter` and `Space` toggle it. One card is open at a time. Expanded, the card shows the ask's context: `why`, the recommendation, the options, the silent default (`If silent: …` or `No default: waits for you`, `FR:ask-queue/web.card`), the deadline with its distance, the source agent (avatar and name), and the link. It offers every response the ask supports, inline: each action of `actionsFor` (approve or go with it, reject, each option, looks good, done), `Open` for the link (new tab) or `Details` for a task row, `Reply` with a text field and `Send` (`Enter`; ends with `?` = a question), `Defer` with the Needs you choices (`FR:ask-queue/web.actions`), and `Open in Needs you`. An `answer` ask opens with the text field
- **FR:one.answer** (P1): Every response answers the ask the same way Needs you does (`FR:ask-queue/api.answer`, `useAsks` `answer`, `reply`, `defer`), with the same toast and Undo. The card leaves the list
- **FR:one.focus** (P1): The task, its reason, and the three actions stay the only content above the first section head. Section heads are eyebrows (`caption` size, muted). Nothing in the sections is red unless overdue
- **FR:one.clamp** (P1): The task title clamps at 4 lines on touch and 3 on desktop; the full text is in the heading's `title`. Reason and actions never leave the first screen at 375x812
- **FR:one.layout** (P1): At 375 px: one column, no horizontal scroll, 44 px targets on every button, link, field, and `Join`. At 1100 px and wider: the two columns of `FR:now-screen/now.layout`, with `Next` and `Waiting on you` in the side column

### FR:cal: The calendar source is honest

- **FR:cal.status** (P1): `GET /calendar` adds `source` to its reply: `{kind: 'calendar', via, account?, state, lastSyncAt?}`, compatible with the inbox source status (`{kind, account, state, lastSyncAt}`). `via` is `graph`, `ics`, `fixture`, or `none`. `state` is `not-connected` (no provider), `error` (the read failed, or left out a configured feed that has no usable copy), `stale` (the newest good copy is older than 60 min), or `ok`. `account` names the account without secrets: the Graph sign-in address, or the feed host names (`outlook.office365.com`); never a feed path or token. `lastSyncAt` is when the data shown was last read from the source (ISO). A feed that fails after a success keeps serving its last good copy (`FR:schedule/ics.provider`), so that copy's age decides `stale`
- **FR:cal.fresh** (P1): The client treats the source as fresh only when `state` is `ok` and `lastSyncAt` is under 60 min old. A host without `source` counts as `ok` and synced at the reply time when `configured` is true and there is no `error`, else `not-connected` or `error`
- **FR:cal.ui** (P1): When the source is not fresh, `Next` says why in one line and offers the fix: `Calendar not connected` with `Connect`; `Calendar unavailable` with `Check connection` and `Fix`; `Calendar last synced 2 h ago` with `Fix` and `Check connection` (a revoked link keeps serving its last copy). Weekly-schedule meetings still show under the line. It never says `No meetings left today.` in these states
- **FR:cal.connect** (P1): `Connect` (and `Fix`) expands a panel in place and becomes `Close`: a labelled field `Published calendar link (ICS)` with the steps for Outlook (Settings > Calendar > Shared calendars > Publish a calendar > ICS link) and Google (Settings > the calendar > Secret address in iCal format), a `Connect` button, the alternative Graph sign-in command `stack graph login --client-id <app id> --with calendar` with `Copy`, and `Check connection`. A link that is not `https:` or `webcal:` is refused in the page and by the host. On a host without the local setup routes (the Azure host), the panel shows the steps and says to connect from `stack web` or set `STACK_CALENDAR_ICS`; it has no field
- **FR:cal.save** (P1): `POST /setup` with `{connect: 'calendar', ics}` (local host only) validates the link and saves it as `ics` in the user config (`~/.config/stack/config.json`, mode `0600`, `FR:first-run-onboarding/state.store`); it leaves `onboarding` as it is. A changed link restarts the host (`restart: true`); the page waits for the host and then checks the connection. When `STACK_CALENDAR_ICS` or `STACK_CALENDAR_FIXTURE` is set it wins, and the reply is an error that says so. When the failing source is a Graph sign-in (`via: graph`), which wins over a saved link, the panel has no field: it shows the Graph sign-in command first. The link is never written to git, a log line, an error, or an API reply
- **FR:cal.check** (P1): `Check connection` reads `GET /calendar` again and shows the result in the panel or the line (`Connected · synced just now`, `Not connected`, `Calendar unavailable`), announced politely. When the source is fresh the section shows the next 2 meetings (`FR:one.meetings`). The page reads the calendar again on its minute timer once the last read is 15 min old, so a working calendar never goes stale on an open page

### FR:nav: One nav

- **FR:nav.rail** (P1): The desktop rail lists, in order: New task, Chief of Staff (`FR:cos-base-of-ops/route.nav`), Now, My day, Needs you (count badge), Inbox, Agents, Projects, Full stack. No `Experimental` tag
- **FR:nav.tabbar** (P1): The phone tab bar: Now, My day, New task (centre), Needs you (count badge), More
- **FR:nav.brief** (P1): The Brief view is gone: no rail entry, no tab, no `g b`, no palette entry. `#/brief` opens Now. The web AI summary section is gone with it; the server route `GET /brief/summary` is unchanged
- **FR:nav.home** (P1): Home stays at `#/home` and `g h`, named `Top asks` in the palette (`Go to Top asks`). It is not in the rail or the tab bar
- **FR:nav.keys** (P1): Chords: `g c` Chief of Staff, `g n` Now, `g h` Top asks, `g d` or `g t` My day, `g k` Needs you, `g i` Inbox, `g s` Agents, `g p` Projects, `g a` Full stack

### FR:design: One design language

- **FR:design.rules** (P1): Every view follows the global rules in `docs/design-system.md` (`FR:task-detail-design/rules.*`). Views move to the Fluent 2 look one at a time from `task-detail-design/audit.md`; My day, the task detail, and the composer go first

## Dependencies

now-screen (`nowOf`, `NowScreen`), cos-view (`briefOf`, meetings layers), ask-queue (answers), web-shell (rail, tab bar, palette).
