---
id: schedule
title: Schedule Profile and ICS Calendars
author: flanakin
description: "Your typical day (wake, bed, focus and personal blocks per weekday) from the time blocks in stack.json, plus read-only calendar feeds (Outlook and Google published ICS links), so the day plan knows how much time you really have."
dependencies: [config, day-inputs, api]
---

<!-- markdownlint-disable single-title -->

# Feature: Schedule Profile and ICS Calendars

## Purpose

A plan that ends the day at 6 pm is wrong for someone who goes to bed at 2 am. Stack already stores the owner's typical week as time blocks (`.xe/config/stack.json`); this feature reads them as a schedule: when the waking day starts and ends, which hours are for focused work, which are personal, and when the owner sleeps. Calendar feeds then take meetings out of that time.

## Scope

- In: `kind` on time blocks; `daySchedule` (pure, `src/core/schedule.ts`); `GET /schedule`; an ICS calendar provider (`src/calendar/ics.ts`) for published calendar links; wiring in `stack web` and the Azure host.
- Out: writing to calendars, sign-in (Graph device code is `graph-signin`), per-date overrides (vacation days), learning the schedule from activity.

## Decisions

- **Calendar connection = published ICS links first.** Outlook (Microsoft 365 and Outlook.com: Settings → Calendar → Shared calendars → Publish, ICS link) and Google (Settings → calendar → Secret address in iCal format) both give a private read-only URL. No app registration, no consent screen, no token store, no extra server: the existing api host fetches the feed (browsers cannot, feeds send no CORS headers). Busy-only publishing is enough for capacity; titles and Teams links show when the feed includes details. Graph stays for the richer path once sign-in exists. Trade-off: feeds refresh slowly (Outlook about every 20-30 minutes) and a tenant admin can disable publishing.
- **The schedule lives in the time blocks.** No second structure: a block's `kind` says what the time is for. Per-weekday differences come from each block's `days`.

## Scenarios

### FR:profile: Schedule profile

- **FR:profile.kind** (P1): A time block has an optional `kind`: `focus` (time for tasks), `personal` (family or partner time: only tasks tagged with that block's emoji are planned there), or `sleep`. With no `kind`, a block whose name or label contains "sleep" (any case) or whose emoji is 😴 is `sleep`; any other block is `focus`. `parseConfig` rejects any other value (`ConfigError` naming the path)
- **FR:profile.day** (P1): `daySchedule(config, at)` returns the waking day that contains the instant `at`, in the configured timezone: `{date, wake, bed, asleep, blocks}`. `date` is the local date the day started on (`YYYY-MM-DD`); `wake` and `bed` are instants (ISO, UTC); `blocks` are the block occurrences inside `[wake, bed)` as `{name, label?, emoji, kind, start, end}` (instants, clipped to the day, sorted by start; sleep blocks left out)
- **FR:profile.wake** (P1): `wake` is the end of the main sleep that ends on `date`; `bed` is the start of the next main sleep after `wake` when it starts within 24 hours of `wake` (else `wake` plus 16 hours). Sleep blocks that touch or overlap are one sleep time; sleep shorter than 3 hours is a nap, which neither ends nor starts a day and is returned as a `personal` block. A sleep block that crosses midnight belongs to the day it starts on, as in `getTimeBlock`
- **FR:profile.contain** (P1): The day for `at` is the one whose `[wake, bed)` contains `at`; at 23:12 on a day with bed at 02:00 the day runs to 02:00, and at 01:00 it is still the previous date's day. When `at` falls in sleep time, the result is the next waking day with `asleep: true`
- **FR:profile.nosleep** (P2): With no sleep ending on a date, `wake` is `startOfDay` and `bed` is 16 hours later, or the start of the next sleep when that comes sooner
- **FR:profile.dst** (P2): Wall-clock times are converted with the configured timezone, so on a DST change day a 02:00 bed and an 08:00 wake keep their local clock times. A time that occurs twice is its first occurrence; a time that does not exist (spring forward) moves forward by the gap (02:00 becomes 03:00)

### FR:ics: ICS calendars

- **FR:ics.parse** (P1): `parseIcs(text, from, to)` returns the `CalendarEvent`s (`FR:day-inputs/cal.model`) of a VCALENDAR that overlap `[from, to)`, sorted by start: recurring events expanded (`RRULE`, `RDATE`, minus `EXDATE`), with `RECURRENCE-ID` overrides replacing their occurrence, times resolved with the feed's `VTIMEZONE` definitions (including Windows zone names that Outlook uses), and `DATE` values read as all-day. At most 2000 occurrences per feed per call. Text that is not a calendar throws
- **FR:ics.status** (P1): `showAs` comes from `X-MICROSOFT-CDO-BUSYSTATUS` (`FREE`, `TENTATIVE`, `BUSY`, `OOF`, `WORKINGELSEWHERE`), else `TRANSP:TRANSPARENT` is `free`, `STATUS:TENTATIVE` is `tentative`, anything else `busy`. `STATUS:CANCELLED` (or a summary starting `Canceled:`/`Cancelled:`) sets `cancelled`. `subject` is `SUMMARY`, or `Busy` when the feed hides it. `id` is `UID` plus the occurrence start
- **FR:ics.join** (P2): `joinUrl` is the first `https` link to Teams (`teams.microsoft.com`, `teams.live.com`), Zoom (`*.zoom.us`), Google Meet (`meet.google.com`), or Webex (`*.webex.com`) found in `X-MICROSOFT-SKYPETEAMSMEETINGURL`, `X-GOOGLE-CONFERENCE`, `URL`, `LOCATION`, then `DESCRIPTION`; `online` is true when there is one. Other links are ignored
- **FR:ics.provider** (P1): `createIcsCalendar({urls, fetch?, ttlMs?, now?})` is a `CalendarProvider` over one or more feed URLs (`https:`; `webcal:` is read as `https:`; anything else is refused at creation). It sends no credentials or cookies, times out after 10 s, refuses bodies over 5 MB and redirects to non-https URLs or to loopback, private, or link-local hosts, and caches each feed's text for `ttlMs` (default 5 min). A failed fetch is also remembered for `ttlMs` (no new attempt until then), and a feed that fails after a success keeps serving its last good copy. Events from all feeds are merged and sorted. A feed that fails is skipped; when every feed fails the call throws. Errors never include the URL (it is a secret)
- **FR:ics.wire** (P1): `stack web` and the Azure host read `STACK_CALENDAR_ICS` (feed URLs separated by whitespace or commas) and use `createIcsCalendar`; The calendar source order is `STACK_CALENDAR_FIXTURE`, then a Graph sign-in with `Calendars.Read` (`FR:graph-signin/web.calendar`), then these feeds. The URLs are never logged or returned by the api

### FR:api: Route

- **FR:api.schedule** (P1): `GET /schedule?at=` (route `schedule.get`, scope `tasks:read`) returns `daySchedule(config, at)` plus `timezone`; `at` is an ISO instant and defaults to now; an `at` that is not a real date-time (bad format, month 13, Feb 30) is `422`. Only the owner session may call it (tokens get `403`): sleep times and personal blocks are personal data

## Dependencies

- config (time blocks, timezone), day-inputs (`CalendarEvent`, `CalendarProvider`, `GET /calendar`), api (handler, scopes)
