---
id: status-ingest
title: Status Ingest
author: flanakin
description: "Agents send a structured status report (top 3, asks on the owner, blockers, progress) by CLI or API. Stack validates it and keeps the latest per agent and project in a local live store under ~/.stack (never git). Its asks show in Needs you. No LLM call."
dependencies: [ask-queue, api, auth-security, cli, desktop-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Status Ingest

## Purpose

Chief of Staff (CoS) agents report status today in chat, which costs tokens and reaches the owner as noise. This feature gives every agent one programmatic way to send a structured report. Stack validates it with a fixed schema and keeps only the latest report per agent and project. Each ask on the owner shows in **Needs you**. Stack makes no LLM call: ingest is token-free.

Reports are live state. Live state lives in a local store owned by the desktop host, never in the content repo. Git holds durable task docs only.

Agent contract: `docs/report.md`.

## Scope

- In: report schema and validation, the local report store (`~/.stack/reports.json`), `host.json` discovery, CLI `stack report`, API route `reports.put` (`POST /reports`), report asks in `GET /needs-you` and their answers.
- Out: a reports page or badge (chunk 2), the CoS task that sends reports (chunk 3), reading reports over the API, any git write, any LLM call.

## Scenarios

### FR:schema: Report schema

An agent needs a strict schema so that a bad report is rejected before anything is written.

- **FR:schema.body** (P1): A report body is a JSON object with only the keys `agent`, `project`, `top`, `asks`, `blockers`, `progress` (lists optional, default empty). Any other key is rejected (@req FR:$report)
- **FR:schema.items** (P1): `top` has at most 3 items; `blockers` and `progress` have at most 10. Each item is `{text, link?}`: `text` is one line of 1-200 characters; `link` is an `https` url of at most 2000 characters. Any other key is rejected
- **FR:schema.asks** (P1): `asks` has at most 10 items. Each is `{id, ask, link, by, kind?, recommend?, why?, default?, priority?}`. `id` matches `[a-z0-9][a-z0-9-]{0,23}` and is unique in the report. `ask` is one line of 1-200 characters. `link` (`https` url) and `by` (ISO date or date-time on a real calendar date) are required. `kind` is `approve`, `review`, `go-do` or `answer` (default `answer`). `recommend` and `default` are one line of at most 200 characters, `why` at most 500. `priority` is `crit`, `high`, `normal` or `low`. Any other key is rejected
- **FR:schema.names** (P1): `agent` and `project` match `[a-z0-9][a-z0-9-]{0,23}`
- **FR:schema.text** (P1): A text field with a control character, a line break, or an invisible format character is rejected, not cleaned
- **FR:schema.errors** (P1): `parseReport` MUST check the whole body and throw one `ReportInvalid` that lists every issue as `{field, message}` (for example `asks[0].link`). Nothing is written when the body is invalid

### FR:store: Local live store

The owner needs only the latest status from each agent, kept off git, so that old reports never pile up and the repo holds only durable docs.

- **FR:store.path** (P1): Reports live in `<home>/reports.json`, where `<home>` is `STACK_HOME` or `~/.stack`, as `{ "reports": { "<agent>/<project>": Report } }`. Each stored report adds `agent`, `project`, `at` (ISO time Stack wrote it) and, for a token caller, `writer`, and each ask its `key`. Nothing is written to the content repo
- **FR:store.atomic** (P1): Every write goes to a temp file in the same folder, then is renamed over `reports.json`, so a reader never sees a partial file
- **FR:store.lock** (P1): One writer at a time holds `<home>/reports.lock` (created exclusively, holding the writer's pid). Another writer waits up to 5 s, then fails `busy` (API `409`). A lock whose pid is not running (a crashed writer) is taken over at once; a lock with no pid yet only after 30 s; a live writer's lock is never taken
- **FR:store.live** (P1): A write through the host store sends a `change` event (`kinds: ["tasks"]`) to open pages on `/events`, so Needs you reloads without a repo change
- **FR:store.broken** (P2): A write that finds `reports.json` broken moves it aside as `reports.json.broken-<ms>` before writing, so nothing is lost silently
- **FR:store.replace** (P1): A new report for the same agent and project replaces the prior one completely. Reports for other pairs stay as written
- **FR:store.read** (P1): `ReportStore.list()` MUST return every stored report, newest `at` first, and none for a missing or broken file

### FR:asks: Asks on the owner

- **FR:asks.key** (P1): Each ask has key `rp.<agent>.<project>.<id>`. The `id` names one item: sending the same `id` again updates that ask; a new item needs a new `id`
- **FR:asks.answer.keep** (P1): The owner's answer on an ask is kept when the next report lists the same `id`. An ask the next report drops is removed with its answer
- **FR:asks.result** (P1): The result is `{agent, project, created, asks: {put, dropped, answers}}`; `created` is true for the first report of that pair; `dropped` lists keys of the prior report that the new one does not list; `answers` maps each kept ask key to the owner's answer, so the agent reads answers from its next report

### FR:needs: Needs you

The owner needs report asks in **Needs you** so that there is one list, read from the live store, not git.

- **FR:needs.list** (P1): `GET /needs-you` returns the CoS items (`FR:ask-queue/needs.read`) then one item per report ask (newest report first): `id` = ask key, `title` = `ask`, `recommendation` = `recommend` or `Open the link and decide`, `link`, `project`, `by`, `default` and `answer` when set (@req FR:ask-queue/$need)
- **FR:needs.answer** (P1): `POST /needs-you/{id}/answer` with a report ask key records the owner's answer (`go`, `defer` with `until`, `reply` with `text`, stamped; same shape as CoS answers) on that ask in the live store, and `undo` clears it. An unknown key is `404`

### FR:auth: Who may write

- **FR:auth.writer** (P1): Only a token caller claims a pair: the first token (`token:<name>`) to write it is stored as `writer`, and another token gets `403 forbidden`. The owner, loopback callers (the desktop host and `stack web` treat every caller as the owner) and direct CLI writes never claim a pair and may write any pair

### FR:host: Host discovery

- **FR:host.file** (P1): The desktop host serves the live store and, on start, writes `<home>/host.json` as `{url, pid}` (atomic; `url` is `http://127.0.0.1:<port>`, the port is random). On close it removes the file if it still names this host. A host that cannot write the file still serves. `readHostFile` accepts only a loopback url
- **FR:host.demo** (P1): A demo host (desktop or `stack web`) never touches live state: its store is `~/.config/stack/demo-state` and it writes no `host.json`

### FR:cli: CLI

- **FR:cli.report** (P1): `stack report --agent <name> --project <p> [--file <path>] [--json]` reads the report JSON from `--file`, or from stdin when no file is given (an open pipe that sends nothing for 5 s counts as no input). It needs no content repo. It prints `report <agent>/<project>: <n> asks, <m> dropped (host|store)` (or the result plus `via` with `--json`)
- **FR:cli.host** (P1): When `host.json` names a running process (its `pid`) whose url answers as a Stack host, the CLI posts the report to `<url>/api/reports` and does not write the store itself. A host `400` is exit 2 with the host's issues; another Stack error (not `404`) fails
- **FR:cli.direct** (P1): When there is no `host.json`, its pid is not running, nothing answers, the host has no store (`404`), or the answer is not from Stack, the CLI writes the store directly under the single-writer lock
- **FR:cli.errors** (P1): Missing `--agent` or `--project`, no input (stdin is a terminal and no `--file`), a file that cannot be read, input that is not JSON, a body whose `agent` or `project` differs from the flags, or a body that fails the schema exits with code 2 and names every issue

### FR:api: API

- **FR:api.put** (P1): `POST /reports` (route `reports.put`, scope `tasks:write`) takes `{agent, project, top?, asks?, blockers?, progress?}`, writes the host's live store, and returns `200` with the result of `FR:status-ingest/asks.result`. A host with no store returns `404`. The route is in `docs/api/openapi.yaml`
- **FR:api.invalid** (P1): A body that fails the schema returns `400 bad_request` with `details` listing every issue

## Data Model

- **FR:$report** (P1): **`Report`** — One agent's latest status for one project.
  - `agent` (string) — agent slug
  - `project` (string) — project slug
  - `at` (string) — ISO time Stack stored it
  - `writer` (string?) — `token:<name>` of the token that claimed the pair
  - `top` (Item[]) — at most 3, most important first
  - `asks` (ReportAsk[]) — at most 10; each with its `key` and the owner's `answer` when set
  - `blockers` (Item[]) — at most 10
  - `progress` (Item[]) — at most 10
  - `Item` — `{ text, link? }`

## Dependencies

- ask-queue (Needs you item shape and answer rules), api (routes, errors), auth-security (scope table), cli (exit codes), desktop-shell (host start and stop)
