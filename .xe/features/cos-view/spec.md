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

### FR:brief.ai: AI daily brief (Experimental)

Builds on `FR:brief`. Model calls use the owner's Claude login as in `email-runner` (`FR:email-runner/model.cli`).

- **FR:brief.ai.route** (P1): `GET /brief/summary` (route `brief.summary`, scope `tasks:read`, owner session only, `403` for tokens) returns `{configured, date, headline?, lines?, cached?, error?}`. `lines` is `[{key, text, action?}]`. Without a model (`deps.brief` absent) it returns `{configured: false}`. It is in `docs/api/openapi.yaml`
- **FR:brief.ai.model** (P1): The server sends the top 12 open asks by score (key, from, kind, ask, why, recommend; each clipped to 300 characters, fenced as untrusted data) to `claude-sonnet-5-5` through the injected `ClaudeJson`. The model returns `{headline, lines: [{key, text, action}]}`: at most 5 lines, each on one ask. Tests use a fake; no test starts a process or uses the network
- **FR:brief.ai.actions** (P1): `action` is one of `go`, `no`, `done`, `none`. The server drops a line whose key is not an open ask, and sets `action` to `none` unless the ask allows it: `go` and `no` for `approve`, `done` for `go-do`. The model can never pick an action the ask does not allow. The one tap calls `POST /asks/{key}/answer` with that answer (`FR:ask-queue/api.answer`); the server summary route never answers
- **FR:brief.ai.cache** (P1): One result per local day. Later calls that day return it with `cached: true` and start no model call; calls in flight at the same time share one model call. A failed model call is not cached: the reply is `{configured: true, error: 'Summary unavailable'}` (no model text or path). `?refresh=1` forces a new call. A new day starts a new result
- **FR:brief.ai.empty** (P1): With no open asks the server makes no model call and returns the headline `Nothing needs you.` with no lines
- **FR:brief.ai.web** (P1): The Brief page shows an `AI summary` section first: the headline and one row per line, with a one-tap button when the action is not `none` (`Approve`, `Reject`, `Done`). A tap answers the ask the same way as a card (with Undo). A line whose ask is no longer open is hidden. When the summary is not configured or fails, the section is hidden and the rest of the page is unchanged. At 375 px: no horizontal scroll, 44 px tap targets
