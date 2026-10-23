---
id: web-app
title: Web App
author: flanakin
description: "Keyboard-first desktop and touch mobile UI on Azure Static Web Apps: next task, full list with filters, capacity, command palette, inline editor, reorder, bulk edit, quick capture."
dependencies: [api, auth-security, quick-capture]
---

<!-- markdownlint-disable single-title -->

# Feature: Web App

## Purpose

Answer "what do I do next" in one glance and make every task edit a keystroke or a tap, on a laptop or a phone. Edits are direct commits through the api and land in seconds.

## Scope

- In: static single-page app in `web/`, SWA config, two additive api routes (`tasks.edit`, `tasks.move`), unit tests, browser e2e against a mocked api.
- Non-goals: offline mode, multi-user, token admin UI, new core or auth behavior, chat or AI features.

## Scenarios

### FR:host: Hosting and security

- **FR:host.static** (P1): `web/` builds with Vite to `web/dist` (static files only). The bundle holds no task data and no secrets; the build env is never inlined. Data is fetched from `/api` after the page loads, which SWA serves only to authenticated users
- **FR:host.swa** (P1): `web/public/staticwebapp.config.json` ships in `dist` and has the same `routes` and `responseOverrides` as `docs/security/staticwebapp.config.json` (GitHub only login, `/*` requires `authenticated`, 401 redirects to GitHub login). It adds `globalHeaders` with a CSP of `default-src 'self'` (no inline script, no third-party origin, `frame-ancestors 'none'`) plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`
- **FR:host.auth** (P1): The app reads `/.auth/me` to show who is signed in and offers sign out at `/.auth/logout`. A 401 from `/api` sends the browser to `/.auth/login/github` with `post_login_redirect_uri` set to the current path; a 403 shows a "not on the allow-list" screen with sign out and no task data
- **FR:host.nosecrets** (P1): The client sends only the session cookie and `Content-Type: application/json`. It never stores tokens, and renders text from the api as text (never as HTML)

### FR:api: Api client

- **FR:api.client** (P1): A typed client wraps `fetch` for `next`, `tasks`, `projects`, `capture`, and the task actions. Errors become `ApiFailure { status, code, message }` from the api error body. Lists page through `limit=200` until `total` is reached
- **FR:api.edit** (P1): `POST /tasks/edit` `{ref, text, expect?}` replaces the row text after the checkbox of one task row, keeps indent, checkbox, and line ending, and commits with the version read. `text` is required, single line, up to 2000 characters. Empty text is `422 invalid`; a missing row is `404`; a stale write is `409`. When `expect` (the row text the client last saw) is sent and the row at `ref` differs, the call is `409 conflict` and nothing is written. Scope `tasks:write`
- **FR:api.move** (P1): `POST /tasks/move` `{ref, target, position, expect?, expectTarget?}` with `position` `before` or `after` moves the task block (the row plus following blank-free deeper-indented rows) next to the target row in the same project file, so a move across sections works. A target inside the moved block, or in another file, is `422 invalid`. `expect` and `expectTarget` guard `ref` and `target` the same way as edit (`409` on mismatch). Dropping a deep row beside a shallow one keeps the moved block's own indent, so it can change parent by position; that is intended. Returns `{changed, ref}` where `ref` is the new location. Scope `tasks:write`. Both routes are in `docs/api/openapi.yaml`

### FR:row: Row reading

- **FR:row.parse** (P1): `parseRow(text)` extracts status, priority, effort, impact, due date text, recurrence, suspend marker, and a clean title (emoji markers and date prefixes removed). The emoji set matches the api `set` enums; unknown text stays in the title
- **FR:row.effort** (P2): Effort emoji map to minutes (🔹 12, 🟢 30, 🟡 60, 🟠 120, 🔴 240, ⚫️ 480) for the capacity view

### FR:now: Now view (home)

Design: `docs/design/web-ux.md`. Journeys J1-J5.

- **FR:now.focus** (P1): Home is **Now**. A focus block shows the top task from `GET /next` (title, project, chips, due) with Start (`s`), Done (`d`), Defer (`z`), Skip (`Shift+S`) and key hints. Nothing active shows an empty state that points at capture (`c`)
- **FR:now.active** (P1): Below the focus block, every open top-level task in an Active section is listed one line each, grouped by project, with subtask progress (`2/5`). The cursor (`j`/`k`) starts on the focus task and moves through the same rows; the same row keys work as in the list
- **FR:now.undo** (P1): Done shows an undo toast for 8 seconds (`set` checkbox Incomplete). Writes update the screen at once and reload after
- **FR:now.defer** (P1): `z` opens a defer menu: 2 hours, tomorrow, next week (number keys 1-3) calling `suspend` with `hours` or `days`
- **FR:now.focusmode** (P1): `Enter` on any row opens focus mode: one task large with its subtasks as a checklist and its notes rendered; `s`, `d`, `z` work; `Esc` returns

### FR:projects: Projects overview

- **FR:projects.glance** (P1): One row per project shows the title, its top open task (first open top-level task in Active, else in Up next, else first open), open count, and a load bar against weekly capacity (over capacity uses the warning color; no capacity shows load only). `Enter` or click opens that project's list

### FR:list: Full list

- **FR:list.view** (P1): The list shows tasks as single-line rows (about 32px) grouped by project then section. Section headers collapse; Active and Up next start open, others closed. Subtasks and notes are hidden until the row is expanded (`→` / `←`, or the `▸ n/m` control). Done rows are muted
- **FR:list.filters** (P1): Filters: text (`/`), project, state (open, done, all), status, priority, effort. Filters combine with AND, appear as removable chips, and are kept in the URL hash so a reload or share keeps the view
- **FR:list.nav** (P1): `j`/`k` or arrow keys move the cursor, `Enter` opens focus mode, `e` or double click edits, `x` toggles selection, `Esc` clears cursor and selection. The cursor row stays in view

### FR:pick: Pickers and chips

- **FR:pick.chips** (P1): Priority, status, effort, and impact show as chips on every row. Clicking or tapping a chip opens a picker listing every value plus None; choosing one calls `POST /tasks/set`. With the cursor on a row, `p`, `t`, `f`, `i` open the same pickers and number keys choose
- **FR:pick.touch** (P1): On narrow screens a picker is a bottom sheet with 44px minimum targets

### FR:edit: Inline markdown editor

- **FR:edit.open** (P1): `e`, or double click/tap on a row title turns it into a text editor holding the full row text. `Enter` saves through `tasks.edit`, `Shift+Enter` is not a newline (rows are one line), `Esc` cancels. Saving unchanged text makes no call
- **FR:edit.preview** (P1): A live preview under the editor renders the markdown subset `**bold**`, `*italic*`, `` `code` ``, and `[text](https://…)` links. Output is built as elements (never `innerHTML`), so text is always escaped; only `http` and `https` links are allowed, and links open with `rel="noopener noreferrer"`
- **FR:edit.notes** (P2): Row notes (extra lines under a task) show in a muted block under the title, rendered by the same markdown subset

### FR:reorder: Reorder

- **FR:reorder.drag** (P1): Each row has a drag handle. Dragging a row (mouse or touch, pointer events) onto the upper or lower half of another row in the same project calls `tasks.move` with `before` or `after`. Dropping elsewhere does nothing
- **FR:reorder.keys** (P1): `Shift+J` / `Shift+K` move the cursor row down or up one visible row in the same project, and handle buttons provide the same for touch and screen readers
- **FR:reorder.plan** (P1): `moveTarget(rows, from, to)` is pure and returns the `{target, position}` or `null` (same row, different project, or inside own subtree)

### FR:bulk: Bulk edit

- **FR:bulk.bar** (P1): With one or more selected rows a bar shows the count, `Set…` (all four pickers; per-group buttons on desktop), Done, Skip, and Clear. An action runs one api call per selected row, in order, and reports `n done, m failed`. Selection survives a partial failure for the failed rows only

### FR:capture: Quick capture

- **FR:capture.box** (P1): `c` (or the Add button) opens a capture overlay with one input. `Enter` posts to `/capture` and closes it; `Esc` closes. While typing (debounced 250 ms) a `dryRun` call previews the parsed title, due date, effort, and project. A `422` shows the message inline and keeps the text. Success shows the new row text in a toast and refreshes
- **FR:capture.project** (P2): The last project used is sent as the default `project`, so a phrase with no `#project` still lands somewhere

### FR:palette: Command palette

- **FR:palette.open** (P1): `Ctrl/Cmd+K` or `:` opens a palette with a fuzzy-filtered command list: go to views, capture, filters, actions on the cursor row or selection, sign out. `Enter` runs, `Esc` closes, arrows move
- **FR:palette.match** (P1): `fuzzyScore(query, label)` is pure: subsequence match, higher for prefix and word-start hits, `null` for no match. Empty query keeps registry order

### FR:keys: Keyboard

- **FR:keys.global** (P1): `g n` (now), `g p` (projects), `g a` (all tasks); `?` shows the shortcut sheet. Single-key shortcuts are ignored while typing in an input, textarea, or select, and with Ctrl/Cmd/Alt held (except the palette)

### FR:ux: Responsive and feedback

- **FR:ux.responsive** (P1): Desktop (>= 800px) uses a slim left rail; below that a bottom tab bar, full-width rows, and no horizontal scroll at 375px. All controls are >= 44px high on touch widths
- **FR:ux.motion** (P2): Transitions are 120-200 ms and are disabled under `prefers-reduced-motion`
- **FR:ux.feedback** (P1): Every write shows a toast with the api message; failures show the error text. A `409` reloads data and asks the user to retry. Buttons disable while a call runs
- **FR:ux.a11y** (P2): Rows and controls are real buttons or inputs with labels, the palette and pickers are dialogs with focus returned on close, color is never the only signal, and the page works in light and dark

## Architecture constraints

- **FR:arch.deps** (P2): Runtime dependency is `preact` only. Dev: `vite`, `vitest`, `jsdom`, `@playwright/test`, `typescript`. All versions exact, pnpm only
- **FR:arch.tsconfig** (P2): `web/tsconfig.json` is separate from the root configs and does not import `src/` (the client talks to the api over HTTP, with its own types)
- **FR:arch.ci** (P2): CI runs web unit tests, lint, and build in the existing job; e2e runs in a separate job that installs Chromium

## Dependencies

- api (routes), auth-security (session cookie, SWA config), quick-capture (`/capture`)
