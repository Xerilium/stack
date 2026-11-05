---
id: web-shell
title: Web shell
author: flanakin
description: "The frame around every view: full-window layout, one nav, command palette, and honest connection and save states"
dependencies: [web-app, ask-queue, pwa, agent-sessions, live-deploy]
---

<!-- markdownlint-disable single-title -->

# Feature: Web shell

## Purpose

First use must feel like a native app: it fills the window, the same places are always one key away, and every state tells the truth (what is wrong, what to do). The shell frames the views; their content (Home, My day, agents, email, deploy) belongs to other features. Source: Michael's first-use feedback, Oct 28 2026.

## Scenarios

### FR:layout: Fills the window

Owner needs the app to use the whole window like a native app so that nothing looks like a web page in a column.

- **FR:layout.fill** (P1): On a desktop window the shell MUST be `rail + main` with `main` filling the rest of the window width
  - **FR:layout.fill.measure** (P1): Content MUST keep a readable measure (`--measure`, 960px; 1200px on My day) aligned to the rail, never a centered column with equal gutters
  - **FR:layout.fill.scroll** (P1): The shell MUST show no horizontal scroll at any width
- **FR:layout.breakpoint** (P1): The rail MUST show at 720px and wider; the bottom tab bar shows below 720px
  - A desktop window that is narrower than a phone is the only way to get the phone layout; a reload never changes the layout for the same window
- **FR:layout.app** (P1): The app MUST be a fixed shell: the document never scrolls (`html, body` are the viewport, `100dvh`, `overflow: hidden`); the rail and the phone tab bar stay put
  - **FR:layout.app.main** (P1): Only the content region (`main`) MUST scroll, as its own scroll container with `overscroll-behavior: contain` (no rubber-band of the page on phones, safe-area insets kept)
  - **FR:layout.app.inner** (P1): Focus mode, drawers and dialogs MUST scroll inside themselves the same way
  - A view's title and filters scroll with its content
- **FR:layout.sticky** (P1): Inside a scrolling list the project and section headers MUST be sticky at the top of the content region, so the row you read always has its section in view
- **FR:layout.standalone** (P2): Installed (standalone) windows MUST get the same layout, with safe areas respected
  > - @req FR:pwa/install.standalone

### FR:nav: One nav

Owner needs the same few places reachable the same way on every screen so that moving around is muscle memory.

- **FR:nav.views** (P1): Views MUST be `home` (`#/`, `#/home`; old `#/next`, `#/focus` still open it), `now` (`#/now`, see `FR:now-screen/now.one`), `today` (My day, `#/today`), `projects` (`#/projects`; old `#/capacity`), `list` (Full stack, `#/list`; old `#/all`, `#/stack`), `sessions` (`#/sessions`; old `#/agents`), and `asks` (Needs you, `#/asks`)
  > - @req FR:agent-sessions/web.view
  - **FR:nav.views.default** (P1): An unknown hash MUST open Home; Home is the starting screen
    > - @req FR:web-app/home.one
- **FR:nav.rail** (P1): The desktop rail MUST list, in order: New task, Home, My day, Needs you (with the open count as a badge, hidden at 0), Sessions, Projects, Full stack, with Commands and Shortcuts at the bottom; labels are these words exactly
  - **FR:nav.rail.brand** (P1): The brand at the top MUST be the mark plus `Stack` (`Stack [DEMO]` for a demo copy)
    > - @req FR:web-app/home2.demo
- **FR:nav.tabbar** (P1): The phone tab bar MUST have five equal slots: Home, My day, New task (the raised circle, in the middle), Needs you (count badge), More (opens the palette)
  - **FR:nav.tabbar.glyph** (P2): The `+` glyph MUST be optically centered in its circle (its box center within 1px of the circle's center)
  - Projects and Full stack are reached through More / the palette
- **FR:nav.keys** (P1): Chords MUST be `g h` Home, `g d` or `g t` My day, `g k` Needs you, `g s` Sessions, `g p` Projects, `g a` Full stack
  - **FR:nav.keys.hint** (P2): The rail MUST show the chord on hover and on the active item

### FR:palette: Command palette

Owner needs one keyboard entry point to any view, project, or action so that nothing takes more than a few keystrokes.

- **FR:palette.jump** (P1): `⌘K` / `Ctrl+K` and `:` MUST open the palette
  - **FR:palette.jump.groups** (P1): With no query the palette MUST be grouped: **Actions** first, then **Go to** (one per view), then **Projects** (every project by its title, which opens Full stack filtered to it)
  - **FR:palette.jump.filter** (P1): Typing MUST filter to a flat list; a project name alone (`alpha`) ranks that project first
  - **FR:palette.jump.scroll** (P2): The list MUST scroll and keep the selected command in view
- **FR:palette.scope** (P1): Row actions (`Mark done`, `Set …`) MUST appear only on views with rows; ask actions only on Needs you

### FR:state: Honest states

Owner needs every connection, permission, and save state to say what is wrong and what to do so that no screen is a dead end.

- **FR:state.unreachable** (P1): When the api cannot be reached (fetch rejects), the error MUST read `Can't reach Stack at <host>. Is stack web still running?` (never `Network error`), on the load screen, in capture, and in toasts
- **FR:state.live** (P1): The live badge MUST be silent while connecting and while live
  > - @req FR:ask-queue/web.live
  - **FR:state.live.poll** (P1): It MUST show `Checks every 15 s` on the polling fallback
    > - @req FR:ask-queue/live.fallback
  - **FR:state.live.drop** (P1): When the stream drops it MUST show `Reconnecting…`; when the api is unreachable, `Can't reach Stack` with **Retry**
  - **FR:state.live.retry** (P1): Retry MUST reopen the stream and reload; if the load succeeds the badge clears, else it stays with the error as a toast
- **FR:state.needs** (P1): Needs you MUST merge agent asks (`/asks`) with open 🙋 rows in active work, so it is never empty while a decision is open
  > - @req FR:web-app/today.needs
  - **FR:state.needs.row** (P1): A 🙋 row MUST show as an ask from the project's agent: `Go with it` (when a recommendation exists) sends the decision to the inbox, `Reply` sends a reply, `Details` opens focus mode
  - **FR:state.needs.empty** (P1): The empty state MUST say what was checked: `Nothing needs you. No open asks, decisions, or replies · last agent update <time>`
- **FR:state.notify** (P1): When notification permission is denied the control MUST stay enabled, read `Notifications blocked`, and on click explain how to unblock (`Allow notifications for this site in the browser's site settings (the lock icon in the address bar)`)
  > - @req FR:pwa/notify.optin
  - **FR:state.notify.denied** (P1): A permission request that comes back denied MUST show the same message at once, never a bare `Blocked`
- **FR:state.unsaved** (P1): The shell MUST place the `Unsaved · n` chip in the rail footer on desktop and in the phone header on phones
  > - @req FR:live-deploy/web.unsaved
  - **FR:state.unsaved.pill** (P2): In live mode the rail footer pill MUST read `Live · <branch>` and the brand `Stack` (no `[DEMO]`)
- **FR:state.capture** (P1): A capture that fails MUST keep the text and show the reason inline (`FR:state.unreachable` wording when unreachable) with **Retry**

## Data Model

None

## Architecture Constraints

- Shell code lives in `web/src/App.tsx`, `nav.ts`, `styles.css`, and the state hooks (`useAsks.ts`, `live.ts`, `needs.ts`, `api.ts`); views own their content.

## External Dependencies

None
