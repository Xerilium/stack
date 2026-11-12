---
id: notifications
title: Notifications
author: flanakin
description: "Needs you becomes Notifications: a bell with a count in the app chrome, a flyout on desktop, and a full page. Only things that need action. Priorities gets its own page; Sessions moves to More. Cards change background on hover; no shortcut badges anywhere."
dependencies: [ux-consolidation, ask-queue, pris-sessions-ui, web-shell, task-detail-design]
---

<!-- markdownlint-disable single-title -->

# Feature: Notifications

## Purpose

Needs you mixes three things: Priorities, the asks, and the Claude session inventory (issue 152, section B). The owner wants one list of things that ask him to act, available from anywhere. Priorities stays, on its own page. Sessions stays, in an overflow menu.

Where this spec and `pris-sessions-ui`, `ux-consolidation`, or `web-shell` disagree on placement, this spec wins. Behavior inside the moved blocks does not change.

## Scenarios

### FR:bell: A bell in the app chrome

- **FR:bell.place** (P1): A bell button sits at the top of the desktop rail (beside the brand) and in the phone top bar. Its accessible name is `Notifications` plus the count (`Notifications, 3`)
- **FR:bell.count** (P1): The bell shows a count badge with the number of open notifications (`FR:list.what`). The badge is absent at 0
- **FR:bell.flyout** (P1): On desktop (wider than 719 px, with hover), the bell toggles a flyout (`role="dialog"`, name `Notifications`, `aria-expanded` on the bell). The flyout shows the top 5 notifications as Now's ask cards (`FR:ux-consolidation/one.expand`, same direct actions and answers) and `See all` that opens the page. `Escape`, a click outside, or the bell closes it; focus returns to the bell. With none it shows the calm empty state
- **FR:bell.phone** (P1): On a phone (719 px or narrower, or no hover), the bell opens the Notifications page

### FR:list: The Notifications page

- **FR:list.route** (P1): `#/notifications` opens the page, heading `Notifications`. Old `#/asks` and `#/needs` open it and the address becomes `#/notifications`. `g k` opens it. The palette says `Go to Notifications`
- **FR:list.what** (P1): The page shows only things that need the owner to act, as one ranked list: agent asks, Chief of Staff escalations (PR escalations and PR priority decisions), and 🙋 decision rows (`FR:web-shell/state.needs`). An expired sign-in (`FR:web-shell/state.live`, state `signin`) shows first as a notification `Sign-in expired` with `Sign in`
- **FR:list.not** (P1): The page has no Priorities block and no Sessions or Archive candidates lists
- **FR:list.actions** (P1): Each notification keeps its direct actions, keys, defer, reply, and Undo (`FR:ask-queue/web.actions`)
- **FR:list.empty** (P1): With nothing open: `You're all caught up.` and one muted line that says what was checked. No red, no art beyond the existing check
- **FR:list.words** (P1): Text that named Needs you now names Notifications (`{n} more in Notifications`, `Open in Notifications`)

### FR:pris: Priorities page

- **FR:pris.route** (P1): `#/priorities` opens the page, heading `Priorities`, with the Priorities block of `FR:pris-sessions-ui/pris.block` unchanged in behavior (expand, inline edit, save, conflict, live re-read). `g o` opens it

### FR:sessions: Sessions in More

- **FR:sessions.route** (P1): `#/sessions` opens the Sessions page, heading `Sessions`, with the Sessions and Archive candidates lists of `FR:pris-sessions-ui/sessions.*` unchanged in behavior. The Agents view keeps `#/agents`
- **FR:sessions.more** (P1): Sessions is reachable from the `More` menu (rail and phone tab bar). It is not a rail item

### FR:nav: Nav order

- **FR:nav.rail** (P1): The desktop rail: New task, then Now, My day, Priorities, Inbox, Agents, Projects, Full stack, More. More opens a menu (`role="menu"`) with Sessions and Commands
- **FR:nav.tabbar** (P1): The phone tab bar: Now, My day, New task (centre), Priorities, More. More opens a menu with Inbox, Agents, Projects, Full stack, Sessions, and Commands. `Escape` or a click outside closes a More menu; arrow keys move between its items

### FR:cards: Cards respond to hover

- **FR:cards.hover** (P1): Every card (ask cards and rows, Now ask cards, priority rows, session rows, agent cards, tiles, `.fl-card`) uses `--card-bg` and, on hover, `--card-bg-hover`. In dark mode the default is slightly darker than the panel and the hover is clearly lighter
- **FR:cards.focus** (P1): A focusable card, or the control inside it, shows a 2 px focus-visible ring

### FR:keys: No shortcut badges

- **FR:keys.none** (P1): No button, link, or menu item renders a `kbd` element, in any view, including the rail (`New task c`, `g n`), Now (`Done d`, `Defer n`), Needs you actions, and pickers. This supersedes the rail exception in `FR:task-detail-design/rules.nokeys`
- **FR:keys.tip** (P1): A control with a key shows it only in its tooltip (`title`), as `Done (D)`. The `?` help and the command palette still list every key

## Non-functional

- **NFR:a11y.axe** (P1): Notifications (page and flyout), Priorities, Sessions, and an open More menu have no axe violations (WCAG 2.2 AA) at 375 px and 1280 px
- **NFR:a11y.targets** (P1): The bell and More are 44 px targets on touch
- **NFR:calm** (P1): The badge uses the accent color, never red

## Dependencies

ux-consolidation (nav, Now ask cards), ask-queue (answers), pris-sessions-ui (Priorities and Sessions blocks), web-shell (rail, tab bar, palette, live status), task-detail-design (global rules).
