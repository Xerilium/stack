---
id: top-asks
title: Top Asks Home
author: flanakin
description: "Home shows the one top task overall and one row per other project, in server rank order, and updates by itself when tasks or asks change."
dependencies: [web-app, home, ask-queue, task-lifecycle]
---

<!-- markdownlint-disable single-title -->

# Feature: Top Asks Home

## Purpose

The owner runs many projects and wants one answer to "what is next, in each project". Home shows the top task overall, then exactly one row per other project. Nothing else competes for attention. The page updates by itself, so it replaces the `/next` skill's table.

## Scope

- In: the Home layout under the NOW card, the live behavior of that list, docs for `/next`.
- Out: ranking (`FR:task-lifecycle/rank.*`, `docs/ranking.md`), the Needs you list (`FR:ask-queue/web.*`), the fit check and window (`FR:home/home.*`).

## Scenarios

### FR:top: Top asks

- **FR:top.one** (P1): The NOW card shows the first task of `GET /rank` that is not in Needs you (`FR:web-app/home.one`, `FR:web-app/home.fit` for the one that fits)
- **FR:top.rows** (P1): Under NOW, **Top asks** lists exactly one row for each other project with open work, in the order of each project's top ranked row. The project of the NOW task is not repeated. Home has no Up next list, no `Only have 5 min?` list, and no fold: every project is visible
- **FR:top.row** (P1): A row shows the project name (opens that project's Full stack), the task title, the expected time (`30m`, `~` when assumed), and a countdown (`today`, `2d late`; the warning color when late or due within a day). A click opens the row in place (`FR:web-app/home2.expand`); `j`/`k` move one cursor from NOW through the rows
- **FR:top.live** (P1): Top asks follows live changes (`FR:ask-queue/live.sse`, polling fallback `FR:ask-queue/live.fallback`). A change from elsewhere updates the rows in place: a project whose top task changed fades in for 1 s, a project with no open work leaves, the cursor stays on the same task when it still exists, and no toast or focus move happens. Motion is removed with `prefers-reduced-motion`
- **FR:top.status** (P1): The Top asks heading shows the project count and a quiet dot: green with `Live` (screen readers only) while the stream is connected, accent with `Synced` and the tooltip `Checks for changes every 15 s` on the polling fallback. A polite live region announces `n projects` only when the count changes from elsewhere
- **FR:top.empty** (P2): With no other project the section is absent; with nothing active Home shows `Nothing active`
- **FR:top.next** (P2): `docs/ranking.md` says the web Home replaces the `/next` skill's table: the NOW card is `stack next`, the rows are the top of each project. `GET /next`, `GET /rank` and `stack next` stay as they are

## Dependencies

- web-app (Home, rows, keys), home (window, fit), ask-queue (live stream), task-lifecycle (rank)

## Architecture Constraints

None

## External Dependencies

None
