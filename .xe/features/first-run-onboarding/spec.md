---
id: first-run-onboarding
title: First-Run Onboarding
author: flanakin
description: "A calm first-run flow in the local web app and the desktop app: pick the content repo, pick demo or live with a plain warning, then optional calendar, email and iPhone steps. One step per screen, at most 5 steps, resumable. Also: phone and desktop polish and empty states that name the next step."
dependencies: [cli, desktop-shell, schedule, graph-signin, iphone-access, web-shell, stack-app]
---

<!-- markdownlint-disable single-title -->

# Feature: First-Run Onboarding

## Purpose

A new owner opens `stack web` or the desktop app with no content repo set. Today the CLI exits with a usage error and the desktop app quits. The owner must edit `~/.config/stack/config.json` by hand. This feature replaces that with a short guided flow in the app itself.

## Hard rules

- Local hosts only (`stack web`, desktop). The hosted app never shows the flow.
- Demo is the default mode. Live is a choice the owner makes after reading what live writes.
- Stack never sends mail. The email step says so and only shows the sign-in command.
- Feed URLs and paths are secrets in logs: never logged, never in a URL query.
- Every step after the mode step is skippable.

## Design

- One step per screen, 5 steps: Repo, Mode, Calendar, Email, iPhone. A quiet `Step N of 5` line, no progress bar animation.
- Calm per `stack-app/design-principles.md`: neutral base, one accent, no red unless an error, plain verbs (`Continue`, `Skip`, `Back`).
- The flow replaces the app shell until done. Done lands on Now.

## Scenarios

### FR:state: Setup state

- **FR:state.store** (P1): Progress lives in the user config (`~/.config/stack/config.json`) as `onboarding: { step, done }`. Writes merge into the file, keep other keys, and use mode `0600`.
- **FR:state.needed** (P1): The flow is needed when `onboarding.done` is not true and one of: no repo is set, the repo has no task rows, or `onboarding` exists (a flow in progress). An owner with a repo full of tasks and no `onboarding` key never sees it.
- **FR:state.resume** (P1): A closed app opens at the saved step. A step is saved before the next screen shows.
- **FR:state.status** (P1): `GET /setup` returns `{ needed, reason, step, steps, repo, mode, calendar, email, signIn, error? }`. `reason` is `no-repo`, `empty`, `resume`, `broken`, or `null`. `repo` is redacted (no credentials). `calendar` and `email` say if a calendar or a Graph sign-in is already set.

### FR:step: Steps

- **FR:step.repo** (P1): The owner types a local path or a git url, or confirms the repo already set. A path must be a folder in a git repo. A git url must start with `https://`, `ssh://`, `file://` or `git@`. A bad value gives one plain error line and stays on the step. The saved url shows redacted; sending it back unchanged keeps the saved url. When `STACK_REPO` or `STACK_DIR` is set, the field is read only and says so.
- **FR:step.mode** (P1): Two choices: `Demo` (default, a copy; the repo is never written) and `Live`. Live shows: "Live edits your repo. Stack writes task files in `tasks/`, commits them, and pushes to your remote." The owner must check "I understand" before Live continues. A mode picked here wins over `stack web --live`.
- **FR:step.mode.tasks** (P2): Live on a repo with no `tasks/` folder creates an empty `tasks/` folder. Demo on such a repo is an error that names Live as the fix.
- **FR:step.calendar** (P2): Optional. The owner pastes a published ICS link (`https:` or `webcal:`). It is saved as `ics` in the user config and used when `STACK_CALENDAR_ICS` is not set. Skip is always there.
- **FR:step.email** (P2): Optional. Shows the sign-in command `stack graph login --client-id <app id> --with calendar,mail,drafts` with a Copy button, and says: "Stack reads mail and writes reply drafts. It never sends mail." It shows `Signed in` when a Graph token cache exists. Skip is always there.
- **FR:step.phone** (P2): Optional. Says Stack pings the phone only when an ask is due within 1 hour, and links to `#/install`. `Finish` marks the flow done.
- **FR:step.max** (P1): The flow has at most 5 steps.

### FR:host: Hosts

- **FR:host.setup** (P1): With no repo, `stack web` and the desktop app start a setup server instead of failing: loopback only, the same guards as `stack web` (`FR:cli/web.serve.loopback`), the built web app, `/.auth/me` (`local: null, setup: true`), and `/setup`. The page carries the setup tag (`FR:web.gate`).
- **FR:host.apply** (P1): `POST /setup` takes `{ step, repo?, mode?, ack?, ics?, skip? }`, validates it, and saves it. A change to the repo, the mode, or the calendar restarts the host on the same port. The reply says `restart: true`; the page waits for the host and reloads.
- **FR:host.broken** (P1): A host that fails to start with the saved repo falls back to the setup server at the Repo step with a plain error line, instead of quitting.
- **FR:host.live** (P1): The live server also answers `/setup`, so an empty repo or a flow in progress continues in the app. While the flow is needed it marks the page (`FR:web.gate`).

### FR:web: Page

- **FR:web.gate** (P1): While the flow is needed, the local host adds `<meta name="stack-setup">` to the page and `setup: true` to `/.auth/me`. A page with the tag reads `/setup` before it draws; a page without it shows the app at once and, on a loopback host, still checks `/.auth/me` (a page from the service worker cache can lack the tag). `needed: true` from `/setup` shows the flow; anything else shows the app. A normal start makes no extra request that can 404.
- **FR:web.a11y** (P1): Each step has one `h1`, labeled inputs, a visible focus ring, and errors in `role="alert"`. axe finds no serious or critical issue at 375 x 812 and 1280 x 800, light and dark.
- **FR:web.phone** (P1): At 375 px nothing scrolls sideways and every control is at least 44 px tall.

### FR:polish: Phone and desktop polish

- **FR:polish.tap** (P1): On touch, every button and link in the rail, tab bar, Inbox, Projects, Stack and My day views is at least 44 px tall (24 px on desktop).
- **FR:polish.overflow** (P1): No view scrolls sideways at 375 px or 1280 px.
- **FR:polish.contrast** (P1): axe `color-contrast` passes on Projects, Stack, My day and Inbox in light and dark.
- **FR:polish.empty** (P1): Empty states use one shared shape: a short line that says what is empty, then the next step (a key or a button). Stack list, My day, Projects and Inbox use it.

## Dependencies

cli (`stack web`), desktop-shell (host), schedule (ICS), graph-signin (sign-in command), iphone-access (`#/install`), web-shell.
