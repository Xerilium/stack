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
- **FR:one.messages** (P1): Now shows no ask cards. The priorities tables take that place (`FR:priorities-tables/web.place`); the owner answers asks in Notifications
- **FR:one.focus** (P1): The task, its reason, and the three actions stay the only content above the first section head. Section heads are eyebrows (`caption` size, muted). Nothing in the sections is red unless overdue
- **FR:one.clamp** (P1): The task title clamps at 4 lines on touch and 3 on desktop; the full text is in the heading's `title`. Reason and actions never leave the first screen at 375x812
- **FR:one.layout** (P1): At 375 px: one column, no horizontal scroll, 44 px targets on every button, link, field, and `Join`. At 1100 px and wider: the two columns of `FR:now-screen/now.layout`, with `Next` in the side column and the priorities tables under both (`FR:priorities-tables/web.place`)

### FR:cal: The calendar source is honest

- **FR:cal.status** (P1): `GET /calendar` adds `source` to its reply: `{kind: 'calendar', via, account?, state, lastSyncAt?, reason?}`, compatible with the inbox source status (`{kind, account, state, lastSyncAt}`). `via` is `graph`, `ics`, `fixture`, or `none`. `state` is `not-connected` (no provider), `error` (the read failed, or left out a configured feed or account that has no usable copy), `stale` (the newest good copy is older than 60 min), or `ok`. `reason` (Graph only) says why: `signin`, `down` or `error` (`FR:connect-accounts/cal.info`). `account` names the account without secrets: the Graph sign-in address, or the feed host names (`outlook.office365.com`); never a feed path or token. `lastSyncAt` is when the data shown was last read from the source (ISO). A feed that fails after a success keeps serving its last good copy (`FR:schedule/ics.provider`), so that copy's age decides `stale`
- **FR:cal.fresh** (P1): The client treats the source as fresh only when `state` is `ok` and `lastSyncAt` is under 60 min old. A host without `source` counts as `ok` and synced at the reply time when `configured` is true and there is no `error`, else `not-connected` or `error`
- **FR:cal.ui** (P1): When the source is not fresh, `Next` says why in one quiet line that links to Settings > Accounts (`FR:connect-accounts/web.now`). Weekly-schedule meetings still show under the line. It never says `No meetings left today.` in these states. Now has no Connect, Fix or Check connection control and no accounts panel
- **FR:cal.connect** (P1): Settings > Accounts > `Other ways to connect` (`FR:connect-accounts/web.manual`) has a labelled field `Published calendar link (ICS)` with the steps for Outlook (Settings > Calendar > Shared calendars > Publish a calendar > ICS link) and Google (Settings > the calendar > Secret address in iCal format), a `Connect` button, and `Check connection`. No command is shown. A link that is not `https:` or `webcal:` is refused in the page and by the host. On a host without the local setup routes (the Azure host), it shows the steps and says to connect from Stack on your Mac; it has no field
- **FR:cal.save** (P1): `POST /setup` with `{connect: 'calendar', ics}` (local host only) validates the link and saves it as `ics` in the user config (`~/.config/stack/config.json`, mode `0600`, `FR:first-run-onboarding/state.store`); it leaves `onboarding` as it is. A changed link restarts the host (`restart: true`); the page waits for the host and then checks the connection. When `STACK_CALENDAR_ICS` or `STACK_CALENDAR_FIXTURE` is set it wins, and the reply is an error that says so. The link is never written to git, a log line, an error, or an API reply
- **FR:cal.check** (P1): `Check connection` (in `Other ways to connect`) reads `GET /calendar` again and shows the result there (`Connected · synced just now`, `Not connected`, `Calendar unavailable`, `Microsoft is not responding. Stack retries on its own.`), announced politely. When the source is fresh, Now shows the next 2 meetings (`FR:one.meetings`). The page reads the calendar again on its minute timer once the last read is 5 min old (`FR:connect-accounts/cal.page`), so a working calendar never goes stale on an open page

### FR:nav: One nav

- **FR:nav.rail** (P1): The desktop rail lists, in order: New task, Now, My day, Notifications (count badge), Pull requests, Inbox, Agents, Projects, Full stack (`FR:notifications/nav.rail`). No `Experimental` tag
- **FR:nav.tabbar** (P1): The phone tab bar: Now, My day, New task (centre), Notifications (count badge), More (`FR:notifications/nav.tabbar`)
- **FR:nav.brief** (P1): The Brief view is gone: no rail entry, no tab, no `g b`, no palette entry. `#/brief` opens Now. The web AI summary section is gone with it; the server route `GET /brief/summary` is unchanged
- **FR:nav.home** (P1): Home stays at `#/home` and `g h`, named `Top asks` in the palette (`Go to Top asks`). It is not in the rail or the tab bar
- **FR:nav.keys** (P1): Chords: `g n` Now, `g h` Top asks, `g d` or `g t` My day, `g k` Notifications, `g i` Inbox, `g s` Agents, `g p` Projects, `g a` Full stack, `g ,` Settings (`FR:settings/view.entry`)

### FR:design: One design language

- **FR:design.rules** (P1): Every view follows the global rules in `docs/design-system.md` (`FR:task-detail-design/rules.*`). Views move to the Fluent 2 look one at a time from `task-detail-design/audit.md`; My day, the task detail, and the composer go first

## Dependencies

now-screen (`nowOf`, `NowScreen`), cos-view (`briefOf`, meetings layers), ask-queue (answers), web-shell (rail, tab bar, palette).
