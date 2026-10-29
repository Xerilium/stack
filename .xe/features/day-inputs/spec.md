---
id: day-inputs
title: Day Inputs (Calendar and Mail Adapters)
author: flanakin
description: "Calendar events and email asks feed the day plan: meetings take time off the budget and sit on the timeline; email asks reserve a triage block. Graph adapters for calendar and mail behind read-only guards; fixtures for tests and demo."
dependencies: [email-triage, ask-queue, web-app, api]
---

<!-- markdownlint-disable single-title -->

# Feature: Day Inputs

## Purpose

A day plan that ignores meetings and mail is fiction. Meetings take hours the owner does not have for tasks; mail creates asks that take minutes each. This feature brings both into Today without ever writing to a calendar or sending mail.

## Scope

- In: `src/calendar/` (event model, `CalendarProvider`, fixture provider, Graph calendar guard and adapter); a Graph `MailProvider` adapter in `src/email/graph-mail.ts` over the existing guard; a shared Graph transport; `GET /calendar`; `stack web` fixture wiring; Today meetings and email block (`FR:web-app/today.meetings`, `FR:web-app/today.mail`).
- Out: owner sign-in (device code) and token storage, IMAP (Graph covers the owner's Microsoft 365 mailbox; IMAP needs app passwords and a client library), writing events, recurring-series expansion beyond what `calendarView` returns, model calls.

## Scenarios

### FR:cal: Calendar module

- **FR:cal.model** (P1): `CalendarEvent` is `{id, subject, start, end, allDay, showAs, cancelled, online, organizer?, webLink?, joinUrl?}` (`joinUrl` is the online meeting's join link) with `start`/`end` ISO date-times (UTC, `Z`) and `showAs` one of `free`, `tentative`, `busy`, `oof`, `workingElsewhere`, `unknown`. `CalendarProvider.events(from, to)` returns events that overlap `[from, to)`, sorted by start
- **FR:cal.fixture** (P1): `fixtureCalendar(events)` is a provider over a fixed list (tests and demo); it returns copies, filtered to the range and sorted
- **FR:cal.guard** (P1): `createCalendarGuard()` allows only `GET https://graph.microsoft.com/v1.0/me/calendarView` (or `/me/calendars/{id}/calendarView`) with query keys `startDateTime`, `endDateTime`, `$select`, `$top`, `$orderby`, `$skip` (Outlook calendar paging), `$skiptoken`. Any other method, path, origin, or key throws `GraphDenied` before the network. The calendar scope is `Calendars.Read` only
- **FR:cal.graph** (P1): `createGraphCalendar({transport, guard?})` reads `calendarView` for the range (UTC, `$top=100`, ordered by start), follows `@odata.nextLink` through the guard up to 10 pages, and maps Graph events to `CalendarEvent` (`isAllDay`, `isCancelled`, `isOnlineMeeting`, `onlineMeeting.joinUrl`, `showAs`, `organizer.emailAddress.name`, `webLink`; times read as UTC; links kept only when `https`). A page that is not an object with a `value` array is an error

### FR:mail: Graph mail adapter

- **FR:mail.graph** (P1): `createGraphMail({transport, folder?, guard?})` implements `MailProvider`: `delta(cursor)` calls `GET /me/mailFolders/{folder}/messages/delta` (default `inbox`, with `$select` of the fields triage needs) or the saved delta link, follows `@odata.nextLink`, and returns the `@odata.deltaLink` as the next cursor (or, when it stops at the 50-page cap, the last next link, so the next run resumes); messages map to `Message` (`from.emailAddress`, `receivedDateTime`, `bodyPreview`, `webLink`, `conversationId`, `@odata.type`). Removed items (`@removed`) are skipped. Every request goes through the email guard
- **FR:mail.draft** (P1): `createDraft(id, text)` is the guarded `createReply` request from `createReplyRequest` (marked text as the comment only) and returns the new draft's `{id, webLink}`. The adapter has no other write; it cannot send
- **FR:mail.cursor** (P1): A saved cursor must be a Graph mail-folder delta link (`https://graph.microsoft.com/v1.0/me/mailfolders/<folder or id>/messages/delta`, any case, with only `$deltatoken` or `$skiptoken`); anything else is refused before a request

### FR:graph: Transport

- **FR:graph.transport** (P1): `graphTransport({token, fetch?})` sends `Authorization: Bearer <token>` and JSON, only to `https://graph.microsoft.com/`, never following redirects, and returns the parsed body. A non-2xx response throws `GraphHttpError` with the status and Graph error code only (no body text, no token). `token` may be a function (refreshed per request)

### FR:api: Route

- **FR:api.calendar** (P1): `GET /calendar?from=&to=` (route `calendar.list`, scope `tasks:read`) returns `{configured, items}` for an ISO range of at most 7 days (`422` otherwise). Only the owner session may call it (tokens get `403`): calendars hold personal data. With no provider configured it returns `{configured: false, items: []}`; a provider failure returns `200 {configured: true, items: [], error: "Calendar unavailable"}` so Today still loads
- **FR:api.wire** (P2): `stack web` uses `fixtureCalendar` when `STACK_CALENDAR_FIXTURE` names a JSON file of events (demo and screenshots); the Azure host has no calendar until owner sign-in exists

## Dependencies

- email-triage (guard, `MailProvider`, draft request), ask-queue (email asks in Today), web-app (Today), api (handler, scopes)
