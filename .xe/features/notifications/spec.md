---
id: notifications
title: Notifications
author: flanakin
description: "Needs you becomes Notifications: a bell nav item with a count and one page of only the things that need action. Priorities lives in Settings; Sessions moves to More."
dependencies:
  [product-reset, ux-consolidation, ask-queue, pris-sessions-ui, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Notifications

## Purpose

Needs you mixes three things: Priorities, the asks, and the Claude session inventory (issue [152](https://github.com/Xerilium/stack/issues/152), section B). The owner wants one list of things that ask him to act, with a count he sees from anywhere. Priorities stays, as a section of Settings (`FR:settings/priorities.place`). Sessions stays, behind More.

This feature ships the nav and page split of `FR:product-reset/ia.nav` and `FR:product-reset/ia.notifications` on the current ask list. Stage 9 of `product-reset` later adds the `AskCard` brief and the mail, needs-context, and stale items. Where this spec and `pris-sessions-ui`, `ux-consolidation`, or `web-shell` disagree on placement, this spec wins. Behavior inside the moved blocks does not change.

## Scenarios

### FR:list: The Notifications page

- **FR:list.route** (P1): `#/notifications` opens the page, heading `Notifications`. Old `#/asks` and `#/needs` open it, and the address becomes `#/notifications` (`FR:product-reset/ia.removed`). `g k` opens it. The palette says `Go to Notifications`
- **FR:list.what** (P1): The page shows only things that need the owner to act, as one ranked list: agent asks, Chief of Staff escalations, and 🙋 decision rows (`FR:web-shell/state.needs`). An expired sign-in (`FR:web-shell/state.live`, state `signin`) shows first as the notification `Sign-in expired` with `Sign in`
- **FR:list.not** (P1): The page has no Priorities block and no Sessions or Archive candidates lists
- **FR:list.actions** (P1): Each notification keeps its direct actions, keys, defer, reply, and Undo (`FR:ask-queue/web.actions`)
- **FR:list.context** (P1): Every notification, selected or not, shows who sent it and what it asks
  - **FR:list.context.why** (P1): A row that is not selected shows why it is here: the ask's reason; with none, what the sender recommends (`Recommends: {recommendation}`); with neither, `No reason given`
  - **FR:list.context.card** (P1): The selected notification shows its reason when it has one
  - **FR:list.context.pick** (P1): A click on a row's who and why line selects the row
  - **FR:list.context.read** (P1): A screen reader reads a row's who and why line with the row
  - **FR:list.context.session** (P1): An ask from a session (`from` is `session:<title>`) shows the session title as who, with no `session:` prefix
  - **FR:list.context.phone** (P1): At phone width, a row shows who and its source link on one line, and the why under them. The source link keeps a 44 px touch target
- **FR:list.source** (P1): A notification with a link shows it as a source link (`FR:ui-kit/source`)
  - **FR:list.source.task** (P1): A notification about a task (a 🙋 row, or an ask with a task row) shows `Task`, which opens the task in the app
  - **FR:list.source.row** (P1): A 🙋 row shows no source link
  - **FR:list.source.session** (P1): A permission ask from a session (`perm-<session8>-<request>`, `FR:acp-driver/perm.flow`) shows `Session`, which opens that session in the app (`FR:agent-sessions/web.drawer`)
    - **FR:list.source.session.match** (P1): `Session` opens the session whose id starts with `<session8>`
    - **FR:list.source.session.none** (P1): When no session matches, a toast tells the owner that the session is not found
    - **FR:list.source.session.host** (P1): A host that runs no sessions shows no `Session` link
- **FR:list.rowactions** (P1): Every row that is not selected has an actions menu (`FR:ui-kit/menu`) named `Actions for {ask}`
  - **FR:list.rowactions.items** (P1): The menu lists the actions of the notification's kind (`FR:ask-queue/web.actions`: for example Approve, Reject, Open), then Reply (`Answer` for an `answer` ask), then Defer
  - **FR:list.rowactions.context** (P1): An ask with no reason, no link and no detail also has `Ask for context`
    - **FR:list.rowactions.context.fill** (P1): `Ask for context` MUST select the notification and open its reply box with a question as the text
    - **FR:list.rowactions.context.nosend** (P1): `Ask for context` MUST NOT send; the owner can change the text, then sends it (`FR:ui-kit/send.box.fill`)
  - **FR:list.rowactions.nocontext** (P1): A 🙋 row and an `answer` ask never have `Ask for context`
  - **FR:list.rowactions.select** (P1): Reply and Defer select their row, then open the reply box or the defer choices
  - **FR:list.rowactions.keep** (P1): An action that answers the notification (for example Approve, Reject, or Done) keeps the selected notification and does not scroll the page. The row leaves the list
  - **FR:list.rowactions.focus** (P1): After a menu action, keyboard focus moves to the selected notification
  - **FR:list.rowactions.card** (P1): The selected notification shows the same actions as buttons: the kind's actions with their keys, Defer, Reply, and `Ask for context` when the ask has it
- **FR:list.drop** (P1): A notification with no possible action is not shown: an open ask that is not an `answer` ask and whose kind gives no action (for example a `decide` ask with no options)
  - **FR:list.drop.count** (P1): The page count and the Notifications count badge leave out a notification with no possible action
- **FR:list.empty** (P1): With nothing open: `You're all caught up.` and one muted line that says what was checked. No red
- **FR:list.words** (P1): Owner-facing text that named Needs you names Notifications (`{n} more in Notifications`, `Open in Notifications`)

### FR:bell: The Notifications nav item

- **FR:bell.item** (P1): Notifications is a nav item in the desktop rail and the phone tab bar (`FR:nav.rail`, `FR:nav.tabbar`). It shows a bell icon and the label `Notifications`
- **FR:bell.count** (P1): The item shows a count badge with the number of open notifications (`FR:list.what`), the expired sign-in included. The badge is absent at 0. The accessible name includes the count (`Notifications, 3 open`)

### FR:pris: Priorities in Settings

- **FR:pris.route** (P1): There is no Priorities page. The old address `#/priorities` opens `#/settings/priorities` and the address changes to match. The palette says `Go to Priorities` and opens the same section. Choice: the owner sets the list once; as a page it had no clear purpose

- **FR:pris.states** (P1): While its data loads, the Sessions page says `Loading sessions…`. A failed read says `Cannot load sessions.` and that it tries again by itself. A host without the store says `Sessions are not on this host.` The Priorities states are `FR:settings/priorities.states`

### FR:sessions: Sessions in More

- **FR:sessions.route** (P1): `#/inventory` opens the Sessions page, heading `Sessions`, with the Sessions and Archive candidates lists of `FR:pris-sessions-ui/sessions.*`. Their behavior does not change. The Agents view keeps `#/agents`, and its old address `#/sessions` still opens Agents
- **FR:sessions.more** (P1): Sessions is not a rail item or a tab. It is in More: the palette (`Go to Sessions`), which the phone `More` tab and the rail `Commands` item open

### FR:nav: Nav order

- **FR:nav.rail** (P1): The desktop rail: New task, Now, My day, Notifications, Pull requests, Inbox, Agents, Projects, Full stack. Settings, Commands, and Shortcuts stay at the bottom. `product-reset` Stage 6 replaces Inbox, Projects, and Full stack
- **FR:nav.tabbar** (P1): The phone tab bar: Now, My day, New task (centre), Notifications, More (`FR:product-reset/ia.nav`). More holds Pull requests, Inbox, Agents, Projects, Full stack, Sessions, and Priorities (in Settings)

## Non-functional

- **NFR:a11y.axe** (P1): Notifications, Sessions, and Settings with Priorities have no axe violations (WCAG 2.2 AA) at 375 px and 1280 px
- **NFR:calm** (P1): The count badge uses the accent color, never red

## Dependencies

product-reset (IA target), ux-consolidation (nav), ask-queue (answers), pris-sessions-ui (Priorities and Sessions blocks), web-shell (rail, tab bar, palette, live status).
