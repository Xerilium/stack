---
id: now-screen
title: Now screen and design tokens
author: flanakin
description: "One focal task, its reason, Done / Defer with Undo, a message composer to its agent, and an empty state."
dependencies: [home, web-app, stack-app]
---

<!-- markdownlint-disable single-title -->

# Feature: Now screen and design tokens

## Purpose

Show the owner the single highest-value task and nothing else. Evidence: `.xe/features/stack-app/design-principles.md` (P1 one thing, P3 do then Undo, P4 every pick has a reason, P5 calm, P8 accessible) and `research-ux.md`.

## Scenarios

### FR:tokens: Design tokens

- **FR:tokens.contrast** (P1): Every text token reaches 4.5:1 on `--bg` and `--panel`, light and dark. Light `--muted` is `#6e6e76` (was `#8a8a92`, 3.3:1). The focus ring and `--accent` reach 3:1
- **FR:tokens.scale** (P1): `styles.css` defines the space scale (4, 8, 12, 16, 24, 32, 48), the radius scale (6, 10, 16), and the type scale (title 28, screen 22, body 17, secondary 15, caption 13 on touch; 28, 20, 13, 12, 11 on desktop)
- **FR:tokens.motion** (P1): Motion tokens `--t-feedback` 120 ms, `--t-enter` 200 ms, `--t-sheet` 280 ms use `--ease`. With `prefers-reduced-motion` all three become 0 ms and Now swaps with no slide
- **FR:tokens.theme** (P1): Light and dark values follow the design principles table; dark follows the system setting

### FR:now: The Now screen

- **FR:now.one** (P1): `#/now` (`g n`) shows one task: its title, large, and nothing competing with it. Which task is the one the server ranked first for Home (`FR:web-app/home.one`, `FR:home/home.window`): when it does not fit the time left, the task Home offers instead. No lists, counts, or chips
- **FR:now.why** (P1): One line under the title says why now: the two strongest factors, then fit. At most 60 characters. Factors in order: late or due (`2d late`, `due today`), priority (`high priority`), in progress, agent has it. Fit: `fits your 45m` / `needs 2h, 45m left`. With none: `Top of your stack`
- **FR:now.actions** (P1): Two actions: `Done` (primary, `d`) and `Defer` (`n`, back in 2 hours). No Delegate button: the owner messages the agent instead (`FR:now.compose`). `Shift+A` still delegates (🪄 only). Buttons and composer controls are 44 px high on touch. Each action shows its key on desktop only
- **FR:now.undo** (P1): Each action acts at once, then shows a toast with `Undo` for 8 s. Undo restores the row (Done: reopen; Defer: resume; a message: remove the 🪄 it added and mark the entry handled and withdrawn with the note `Withdrawn by the owner`; `FR:agent-inbox/inbox.withdraw`). If an agent handled the message first, it stays and the toast says `Restored; the agent already picked it up`. No confirmation dialog
- **FR:now.compose** (P1): Under the task is a message composer addressed to the task's agent: the most specific agent whose scope covers the task (`FR:agent-team/web.chip` order without the roll-up), else the roll-up (CoS), else `the agent`. A header line above the field names who it talks to: that agent's avatar (`FR:agent-team/web.avatar`, 28 px) and name in body weight 600 (`Allyte CoS`); the field has the placeholder `Message <Name>…` and the label `Message <Name>`. `Enter` sends; `Shift+Enter` adds a line; `m` focuses it; `Esc` leaves it. Send writes the text to the inbox (`POST /inbox`, kind `instruction`, `FR:agent-inbox/inbox.kinds`) and adds 🪄 in one step, with one toast and Undo. The 🪄 edit goes first, so the entry stores `to: agent`; if the inbox write fails, the edit is reverted. A row with 🤖 or 🪄 keeps its mark; only the text is sent. Line breaks fold to ` / ` (inbox text is one line, at most 1000 characters). Empty text does not send. When the task has a live agent session (any state but `stale`), an `Open live chat` link opens it; the inbox thread stays the v1 channel. The composer passes axe with no violations at 375 px and 1280 px
- **FR:now.thread** (P1): Above the composer, the task's messages and agent replies show as chat bubbles, oldest first (`GET /tasks/{ref}/thread`, owner and agent items only; a withdrawn message never shows): yours on the right, headed `You to <Name>` (the task's agent); the agent's on the left with its avatar and name; each with the time (`5m ago`). When the last item is yours, a muted line under it, aligned with it, says `<Name> replies here`. With none, no list shows. It reloads after a send and after an Undo
- **FR:now.next** (P1): After an action the next ranked task takes the place of the old one with the `enter` motion (200 ms slide-up and fade; instant with reduced motion)
- **FR:now.empty** (P1): With no task, the screen says `Nothing now` and `You are clear.` in a calm win state: no button, no red
- **FR:now.layout** (P1): At 375 px width one column: the task, reason, and actions fit without scroll and without horizontal overflow, then the message box, then `Next` and `Waiting on you`. From 768 px to 1099 px one centered column with a 640 px measure. At 1100 px and wider, two columns: the focus column (task, reason, actions, message box; at most 640 px) on the left and the side column (`Next`, `Waiting on you`; 320 to 400 px) on the right, top-aligned, 48 px apart; the two actions stay in one left-aligned row. The focus column always comes first in the DOM and in reading order (P1: one thing)
- **FR:now.a11y** (P1): The task is the `h1`; the reason is its description; changes are announced (`aria-live=polite`); focus stays visible; text size holds at 200% zoom

## Dependencies

- home (`homeOf`, `topAsksOf`), web-app (actions, toasts, rank)
