---
id: web-shell
title: Web shell
author: flanakin
description: "The frame around every view: full-window layout, one consistent nav (Home, My day, Projects, Full stack, Needs you), command palette with jump-to-project, honest connection and permission states."
dependencies: [web-app, ask-queue, pwa]
---

<!-- markdownlint-disable single-title -->

# Feature: Web shell

## Purpose

First use must feel like a native app: it fills the window, the same four places are always one key away, and every state tells the truth (what is wrong, what to do). Source: Michael's first-use feedback, Oct 28 2026.

## Scope

- In: layout, rail and tab bar, hash routes, command palette, connection and permission states, the capture error path.
- Non-goals: the Home view's content (web-app `FR:home.*`), schedule and calendar, agents, email, deploy.

## Scenarios

### FR:layout: Fills the window

- **FR:layout.fill** (P1): On a desktop window the shell is `rail + main` and `main` fills the rest of the window width; content has a readable measure (`--measure`, 960px; 1200px on My day) aligned to the rail, never a centered column with equal gutters. No horizontal scroll at any width
- **FR:layout.breakpoint** (P1): The rail shows at 720px and wider; the bottom tab bar shows below 720px. A desktop window that is narrower than a phone is the only way to get the phone layout; a reload never changes the layout for the same window
- **FR:layout.standalone** (P2): Installed (standalone) windows get the same layout, with safe areas respected (pwa `FR:install.standalone`)

### FR:nav: One nav

- **FR:nav.views** (P1): Views are `home` (`#/`, `#/home`; old `#/now`, `#/next`, `#/focus` still open it), `today` (My day, `#/today`), `projects` (`#/projects`; old `#/capacity`), `list` (Full stack, `#/list`; old `#/all`, `#/stack`), and `asks` (Needs you, `#/asks`). An unknown hash opens Home. Home is the starting screen
- **FR:nav.rail** (P1): The desktop rail lists, in order: New task, Home, My day, Needs you (with the open count as a badge, hidden at 0), Projects, Full stack. Commands and Shortcuts sit at the bottom. Labels are these words exactly
- **FR:nav.tabbar** (P1): The phone tab bar has five equal slots: Home, My day, New task (the raised circle, in the middle), Needs you (count badge), More (opens the palette). The `+` glyph is optically centered in its circle (its box center within 1px of the circle's center). Projects and Full stack are reached through More / the palette
- **FR:nav.keys** (P1): `g h` Home, `g d` or `g t` My day, `g k` Needs you, `g p` Projects, `g a` Full stack. The rail shows the chord on hover and on the active item

### FR:palette: Command palette

- **FR:palette.jump** (P1): `⌘K` / `Ctrl+K` and `:` open the palette. It lists `Go to …` for each view and `Project: <title>` for every project, which opens Full stack filtered to that project. Typing a project name alone (`alpha`) ranks its `Project:` command first
- **FR:palette.scope** (P1): Row actions (`Mark done`, `Set …`) appear only on views with rows; ask actions only on Needs you

### FR:state: Honest states

- **FR:state.unreachable** (P1): When the api cannot be reached (fetch rejects), the error reads `Can't reach Stack at <host>. Is stack web still running?` (never `Network error`), on the load screen, in capture, and in toasts
- **FR:state.live** (P1): The live badge is silent while connecting and while live. It shows `Checks every 15 s` on the polling fallback. When the stream drops it shows `Reconnecting…`; when the api is unreachable it shows `Can't reach Stack` with **Retry**. Retry reopens the stream and reloads; if the load succeeds the badge clears, else it stays with the error as a toast
- **FR:state.needs** (P1): Needs you merges agent asks (`/asks`) with open 🙋 rows in active work (web-app `FR:today.needs`), so it is never empty while a decision is open. A 🙋 row shows as an ask from the project's agent: `Go with it` (when a recommendation exists) sends the decision to the inbox, `Reply` sends a reply, `Details` opens focus mode. The empty state says what was checked: `Nothing needs you. No open asks, decisions, or replies · last agent update <time>`
- **FR:state.notify** (P1): When notification permission is denied the control stays enabled, reads `Notifications blocked`, and a click explains how to unblock (`Allow notifications for this site in the browser's site settings (the lock icon in the address bar)`). A permission request that comes back denied shows the same message at once, never a bare `Blocked`
- **FR:state.capture** (P1): A capture that fails keeps the text and shows the reason inline (`FR:state.unreachable` wording when unreachable) with **Retry**
