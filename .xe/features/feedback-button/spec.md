---
id: feedback-button
title: Feedback Button
author: flanakin
description: "A feedback icon sends text and an optional screenshot to ~/.stack/feedback.jsonl for an agent to tail."
dependencies: [api, web-shell, desktop-shell, status-ingest]
---

<!-- markdownlint-disable single-title -->

# Feature: Feedback Button

## Purpose

Send feedback on the app from the app. One line lands in a local file. An agent session tails the file and farms out work. Issue 152, section A.

## Scope

- In: icon and panel, `POST /feedback`, the store, `stack feedback`, `docs/feedback.md`.
- Non-goals: a feedback inbox UI, sending to GitHub, a consumer agent, editing or deleting items.

## Scenarios

### FR:ui: Icon and panel

The owner needs to send feedback from any page in two clicks so that a thought is never lost.

- **FR:ui.icon** (P1): A feedback icon button sits in the rail footer (desktop) and in the top bar (phone). Label and tooltip `Send feedback (F)`. No shortcut badge. `Shift+F` opens the panel when no field has focus and no dialog is open (`f` alone is taken by list and Agents keys)
- **FR:ui.panel** (P1): The panel has a multi-line text box, a checkbox `Include a screenshot of this page` (default on), and `Send`. `Send` is off while the text is blank. Escape closes it
- **FR:ui.sent** (P1): On success the panel shows only `Sent` and closes after a short pause. On failure it keeps the text, shows the error, and focuses the text box. Escape does nothing while sending
- **FR:ui.shot** (P1): With the box checked, the panel hides before the capture. In the desktop app the host captures the window (`capture: true`). In a browser it uses the Screen Capture API when present (asked on the click, one frame after the panel hides, then stops); no API or a denied prompt sends without a screenshot
- **FR:ui.a11y** (P1): No axe violations at 375 and 1280 px; focus moves to the text box on open and back to the icon on close. From open to close, also while the panel hides for capture, app and view shortcuts do nothing

### FR:api: API

The page needs one owner-only route so that the web app and the desktop app send feedback the same way.

- **FR:api.route** (P1): `POST /feedback` `{text, route?, viewport?, theme?, capture?, png?}` returns 201 `{id, at, screenshot}`. Owner only (403 otherwise); 404 when the host has no store. `text` 1 to 4000 chars; `route` up to 500; `viewport` `WxH`; `theme` `light|dark`; `png` base64, up to 700 KB decoded, PNG magic checked. Body cap 1 MB. Documented in `docs/api/openapi.yaml`

### FR:store: Store

An agent session needs an append-only local file so that it can tail new feedback and never read a partial or secret line.

- **FR:store.path** (P1): `<STACK_HOME or ~/.stack>/feedback.jsonl`; screenshots at `feedback/<id>.png`. Files 0600, folders 0700. Demo mode writes the live store too: feedback is about the app, and the agent must see it
- **FR:store.line** (P1): One JSON object per line: `{id, at, text, route?, viewport?, theme?, appVersion?, sha?, screenshotPath?}`. Append-only. `id` sorts by time
- **FR:store.atomic** (P1): Each append holds `feedback.lock` and writes the whole line in one `write` (O_APPEND), so a tailing reader never sees a partial line. A short write is an error and cuts the file back to its size before the write. The PNG is written (temp file and rename) before its line and removed when the line fails
- **FR:store.redact** (P1): Token-like strings (Stack `stk_`, GitHub, Anthropic/OpenAI, Slack, AWS, JWT, bearer, `key=value` or `"key":` secrets, also `access_token`, `refresh_token`, `client_secret`) in `text` and every query string in `route` (also inside the hash) are removed before the write. No headers, cookies or tokens are stored
- **FR:store.done** (P1): `done <id>` appends `{id, at}` to `feedback.done.jsonl` under the same lock; a second `done` is a no-op; an unknown id is an error
- **FR:store.capture** (P2): The desktop shell registers a page capture (`webContents.capturePage`, PNG); the store calls it for `capture: true`. A failed or absent capture stores no screenshot and is not an error

### FR:cli: CLI

An agent needs a CLI so that it can add, list, and close feedback with no server.

- **FR:cli.add** (P1): `stack feedback add "<text>" [--route r] [--json]` writes one line; prints the id
- **FR:cli.list** (P1): `stack feedback list [--since id] [--json]` prints items after `id` (all when absent), each with `done`
- **FR:cli.done** (P1): `stack feedback done <id> [--json]`; unknown id exits 4; no repo needed for any subcommand

## Data Model

- Feedback line: see `FR:store.line`. Done line: `{id, at}` in `feedback.done.jsonl`.

## Architecture Constraints

- Local files only: no network, no GitHub, no LLM call.
- One writer at a time through `feedback.lock`; readers need no lock.

## External Dependencies

- None beyond the Screen Capture API in browsers and `webContents.capturePage` in the desktop shell.

## Dependencies

- api (routes, owner gate), web-shell (rail, top bar), desktop-shell (window), status-ingest (`stackHome`, file lock)
