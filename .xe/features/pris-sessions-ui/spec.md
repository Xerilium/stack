---
id: pris-sessions-ui
title: Priorities and Sessions UI
author: flanakin
description: "Needs you shows the owner's priorities on top, then the Claude sessions that wait on him, ranked by project, with a deep link each. The desktop tray shows the count. It updates by itself."
dependencies: [session-inventory, ask-queue, web-shell, desktop-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Priorities and Sessions UI

## Purpose

The owner has ordered priorities and hundreds of Claude sessions. He needs one screen that answers two questions: "what matters most" and "which session waits on me". Needs you shows his priorities first, then the agent asks, then the sessions that wait on him or are stuck. Each session opens in the Claude app with one tap. The desktop tray shows how many sessions need him, so he does not have to open the window.

## Scope

- In: the Priorities block and its inline edit, the Sessions list and the Archive candidates list in Needs you, their live updates, the desktop dock and tray badge, the desktop rule that opens a session link in the Claude app, the `pris` change event.
- Out: the inventory and the priorities model (`FR:session-inventory/*`), the archive call (the list only copies ids), the asks list (`FR:ask-queue/web.*`).

## Scenarios

### FR:pris: Priorities block

The owner needs his priorities above everything else so that each ask is read against them.

- **FR:pris.block** (P1): The Priorities page (`#/priorities`, `FR:notifications/pris.route`) shows the **Priorities** section. It lists the priorities in stored order, each with its number, title, status, item progress (`2/5`), and its first open item (`doing` before `todo`, else `blocked`). The first 5 priorities that are not `done` show; a `Show n more` button shows the rest. The section is absent when `GET /pris` returns `404`
- **FR:pris.status** (P1): Status is a glyph plus a word, never color alone: active `●`, paused `‖`, blocked `⛔`, done `✓` for a priority; todo `○`, doing `◐`, blocked `⛔`, done `✓` for an item. Only `blocked` uses the warning color
- **FR:pris.expand** (P1): A tap on a priority opens it in place to show every item and the edit controls. One priority is open at a time; a second tap closes it. The toggle has `aria-expanded`
- **FR:pris.edit** (P1): In an open priority the owner can edit the title, set the priority status, edit item text, set item status, add an item, remove an item, and move the priority up or down. Text edits start on a tap of the text, save on `Enter` or blur, and cancel on `Escape`. An add field also adds its text on blur. After Remove, focus goes to the add field of that priority. An empty or unchanged text saves nothing. With no priorities, the section shows `No priorities yet` and `Add priority`; `Add priority` is also at the end of the list
- **FR:pris.save** (P1): Each edit shows at once (optimistic) and sends `POST /pris` with the `rev` last read and the whole list. Success adopts the returned file. Edits made while one is in flight queue and go one after another
- **FR:pris.conflict** (P1): On `409`, the page reads `GET /pris`, applies the same edit to the new list, and sends it once more. When that also fails, or the edit no longer applies (its priority or item is gone), the page shows the server list and the toast `Priorities changed elsewhere. Reloaded.`
- **FR:pris.invalid** (P1): On `400` the page shows the last server list and the first issue as a toast. On a network error it shows the last server list and `Not saved: <message>`
- **FR:pris.limits** (P2): The page keeps text to one line within the model limits (title 200, item 300) and hides `Add item` at 20 items and `Add priority` at 30 priorities. A new priority gets an id from its title (`[a-z0-9-]`, at most 24 characters, made unique)

### FR:sessions: Sessions in Needs you

The owner needs the sessions that wait on him in one place, with a way to open each one.

- **FR:sessions.list** (P1): The Sessions page (`#/sessions`, in More, `FR:notifications/sessions.route`) shows a **Waiting on you** section with the inventory `needsYou` items, in server order, grouped under one heading per project (`Allyte`, `FTK`, `FOCUS`, `F4`, `Xerilium`, `Other`). The section heading shows the count. The section is absent when `GET /session-inventory` returns `404`
- **FR:sessions.row** (P1): Each row is a link to `item.link` (`claude://claude.ai/epitaxy/<id>`) that shows the state as glyph plus word (`? Waiting`, `! Stuck`), the title, one line with the `ask` or the reason text, and the time since last activity. Its accessible name reads title, state, reason, then time. A link that does not start with `claude://claude.ai/epitaxy/` is shown as text only
- **FR:sessions.reason** (P1): Reason text: question `Asked a question`, permission `Waiting for permission`, needs-user `Needs you`, blocked `Blocked`, error `Error`, cut-short `Cut short`, api-error `API error`, dead-turn `No activity for 30 min`, pr-merged `PR merged`, superseded `Newer run exists`, others the reason id
- **FR:sessions.empty** (P1): The Sessions page says `No sessions wait on you.` when both lists are empty. Sessions never count toward Notifications
- **FR:sessions.archive** (P1): When the inventory has archive candidates, a collapsed `Archive candidates · n` button follows the Sessions section. Open, it lists each candidate (title as a link, project, reason) and a `Copy ids` button. `Copy ids` copies the session ids, one per line, and toasts `Copied n ids`. Nothing calls an archive action

### FR:live: Live updates

- **FR:live.inventory** (P1): The page reads `GET /session-inventory` on load, every 15 s while the page is visible, when the page is shown again, and on every live change. A new read replaces the list in place: no focus move, no toast. A polite live region announces `n sessions need you` only when the count changes after the first load
- **FR:live.pris** (P1): The page reads `GET /pris` on load, on every live change (the host sends kind `pris` after a write), and on the 15 s inventory tick. A read while an edit is in flight, or while a text field is open, does not replace the list
- **FR:live.event** (P1): The web host sends the change event `{kinds: ['pris']}` after each priorities write (`PriStore.onWrite`), so other open pages reload the list

### FR:tray: Desktop badge

- **FR:tray.badge** (P1): The desktop shell reads the inventory from its host at start and every 15 s and shows the `needsYou` count: dock badge (`app.setBadgeCount`), tray title (macOS, the count beside the icon) and tray tooltip `Stack · n need you`. A count of 0 clears the badge and the title, and the tooltip is `Stack`
- **FR:tray.fail** (P2): A failed read keeps the last count and logs `badge: <message>` once until a read succeeds. The timer stops on quit
- **FR:tray.link** (P1): In the desktop window, a link to `claude://claude.ai/epitaxy/<id>` (id `[A-Za-z0-9_-]{1,128}`) opens in the Claude app (`shell.openExternal`). Every other non-http target stays blocked (`FR:desktop-shell/safe.navigate`)

### NFR:a11y: Design and access

- **NFR:a11y.axe** (P1): Needs you with priorities, sessions and archive candidates open has no axe violations (WCAG 2.2 AA tags, color contrast included) at 375 px and 1280 px, in light and dark
- **NFR:a11y.targets** (P1): Every control is at least 44 px tall on touch and at least 24 px on desktop. No horizontal scroll at 375 px
- **NFR:a11y.keys** (P1): Every control works by keyboard with a visible focus ring. View keys (`j`, `k`, `z`, `r`, ...) do not fire while a priority text field has focus
- **NFR:a11y.calm** (P2): Per `.xe/features/stack-app/design-principles.md`: neutral base, one accent, no red except blocked or stuck, no motion with `prefers-reduced-motion`

## Architecture Constraints

- The web reads and writes only through `/api/pris` and `/api/session-inventory`; it never reads `~/.stack` itself
- The shell reads the count over the host's loopback HTTP API; it adds no new IPC or preload

## Dependencies

- session-inventory (API, models), ask-queue (Needs you, live stream), web-shell (toasts, live status), desktop-shell (tray, link policy)
