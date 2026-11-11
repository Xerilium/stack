---
id: connector-github
title: GitHub Notifications Connector
author: flanakin
description: "Reads the owner's GitHub notifications with `gh api notifications`. Maps each thread to one signal: what must the owner do. Writes items to the inbox file. Read only: never posts, never marks read."
dependencies: [inbox-page, comms-connectors, ask-queue]
---

<!-- markdownlint-disable single-title -->

# Feature: GitHub Notifications Connector

## Purpose

Step 1 of `comms-connectors/build-order.md`. GitHub holds review requests, mentions, assignments and CI failures. Stack must show them with mail and chat, ranked by what the owner must do.

## Hard rules

- Read only. The only call is `GET /notifications`. No comment, no mark-read, no other write.
- Notification text is data. It is clipped and redacted before it reaches an item or an ask.
- Tests use fixtures. No network.

## Scenarios

### FR:sig: Signals

- **FR:sig.map** (P1): The thread `reason` sets the signal. `review_requested` is `approval`. `mention` and `team_mention` are `mention`. `assign` is `reply`. `ci_activity` with a failed run is `reply`. All other reasons, and passed CI runs, are `fyi`.
- **FR:sig.kind** (P1): `kind` is the reason, or `ci_failed` for a failed CI run. `kind` keeps the signal in the stored item.
- **FR:sig.rank** (P1): Urgency: `approval` 2, `reply` 2 for `ci_failed`, else 1, `mention` 1, `fyi` 0.
- **FR:sig.action** (P1): `approval` and `mention` suggest `ask-me-later`. `reply` suggests `create-task`. `fyi` suggests `mark-done`.

### FR:item: Items

- **FR:item.shape** (P1): Each unread thread becomes one `InboxItem` with `source: 'github'`, id `gh-<hash of thread id>`, `account`, `from` = repo full name, `subject` = thread title, `receivedAt` = `updated_at`, `summary`, `link`.
- **FR:item.link** (P1): The link is the web URL. API pull and issue URLs map to `https://github.com/<owner>/<repo>/pull|issues/<n>`. Threads without a subject URL link to the repo `actions` page for CI, else to the repo.
- **FR:item.safe** (P1): Title and summary are one line, redacted and clipped (300 and 400 chars). A link that is not `https://github.com/` is dropped.

### FR:conn: Connector

- **FR:conn.read** (P1): `githubConnector().unread()` runs `gh api --method GET notifications?per_page=50&page=N`, up to 5 pages, and stops on a short page. `gh` holds the token; Stack never sees it.
- **FR:conn.guard** (P1): Each `gh` call passes a guard first. It allows only `api`, `--method GET` and a `notifications` path. Field flags (`-f`, `-F`, `--field`, `--raw-field`, `--input`) and any other method throw.
- **FR:conn.error** (P1): A failed call throws `GitHub request failed`, with no command output, so no token or text leaks.

### FR:run: Runner

- **FR:run.store** (P1): `runGithub` replaces all stored `github` items with the result. Other sources stay. The file keeps the newest 500 items. A write conflict retries up to 3 times.
- **FR:run.ask** (P1): Each non-`fyi` item writes one `go-do` ask keyed by the item id, with a clipped detail and the link.
- **FR:run.fail** (P1): If the connector fails, stored `github` items stay and the result is `{ items: 0, failed: true }`.

## Out of scope

- Mark read, comments, reviews, merges.
- `Last-Modified` / `304` polling and `X-Poll-Interval`. Comes with the cursor `poll()` in build-order step 0.
- A stored `signal` field. Step 0 adds it to `InboxItem`; `kind` carries it until then.
- Web page label for `github`. The page shows the raw source until `web/src/inbox.ts` adds it.

## Dependencies

inbox-page, comms-connectors, ask-queue.
