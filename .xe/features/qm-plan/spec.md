---
id: qm-plan
title: QM Plan
author: flanakin
description: "A weekly quota-maxxing (QM) plan: per project, the lead agent, its top 5 autonomous tasks, token and human-time estimates, in one sortable table."
dependencies: [api, cli, web-shell, status-ingest]
---

<!-- markdownlint-disable single-title -->

# Feature: QM Plan

## Purpose

QM (quota-maxxing) spends spare weekly agent quota on autonomous work. The owner needs one table to see the plan per project. Agents write the plan; the owner reads it.

## Scope

- In: the store, `GET /qm`, `stack qm`, `stack qm put`, the `#/qm` page.
- Non-goals: editing in the page, md views, a new rail item, plan history, quota tracking.

## Scenarios

### FR:store: Store

An agent needs one local file with a fixed schema so that the page and CLI read the same plan.

- **FR:store.path** (P1): `<STACK_HOME or ~/.stack>/qm-plan.json`. Live state, never git. Folder 0700
- **FR:store.schema** (P1): The body matches the Data Model. Unknown fields, a bad type, or more than 5 tasks fail with every issue listed (`field`, `message`)
- **FR:store.put** (P1): A put replaces the whole plan with an atomic write (temp file and rename)
- **FR:store.read** (P1): A missing file reads as no plan (`null`). A broken file reads as no plan with `broken: true`

### FR:api: API

The page needs one read route so that the web app and desktop app show the same plan.

- **FR:api.get** (P1): `GET /qm` returns 200 `{plan, broken?}`. Owner only (403 otherwise); 404 when the host has no store. Documented in `docs/api/openapi.yaml`

### FR:cli: CLI

An agent needs a CLI with no server so that it can read and write the plan.

- **FR:cli.get** (P1): `stack qm [--json]` prints the plan; no repo needed
- **FR:cli.put** (P1): `stack qm put --file f.json [--json]` validates and writes the plan. Bad input exits 2 and lists the issues

### FR:ui: Page

The owner needs one table so that the weekly plan is clear at a glance.

- **FR:ui.route** (P1): `#/qm` shows the plan in place of the shell. The command palette (More on phone) has `Go to QM plan`. No rail item
- **FR:ui.table** (P1): Plain table: Project | Agent | Top 5 | Weekly tokens | Pre-ack min | Post-review min. Top 5 shows the count; a disclosure expands the linked titles. Agent links to `agent.url` when set and shows the session id. `null` shows `Pending`
- **FR:ui.sort** (P1): Every column header is a button that sorts by that column; a second click reverses. `aria-sort` marks the sorted column. Pending sorts last
- **FR:ui.stamp** (P1): The header shows `As of <time>` from `asOf`
- **FR:ui.style** (P1): Fluent 2 tokens (`docs/design-system.md`), light and dark. On a phone the table scrolls sideways in its own box; the page never does

## Data Model

```jsonc
{
  "version": 1,
  "asOf": "2026-11-18T19:00:00Z",          // ISO date-time
  "projects": [{                            // at most 50
    "project": "Stack",                     // 1-80 chars
    "agent": { "name": "stack-architect", "sessionId": "local_…", "url": "https://…" }, // sessionId, url optional
    "tasks": [{ "title": "…", "url": "https://…" }], // 0-5, priority order; url optional
    "weeklyTokens": 2000000,                // non-negative integer or null (pending)
    "preAckMin": 10,                        // non-negative integer or null
    "postReviewMin": 30                     // non-negative integer or null
  }]
}
```
