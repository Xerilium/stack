---
id: query-tasks
title: Query Tasks
author: flanakin
description: "Expands 🔎 query trigger tasks into script-owned lists of 🌐 subtasks from GitHub, and never destroys the existing list when a query fails."
dependencies: [task-lifecycle]
---

<!-- markdownlint-disable single-title -->

# Feature: Query Tasks

## Purpose

Let a task say "list what GitHub has for this search" and keep that list current, so reviews and follow-ups show up in the stack without hand entry. Ports the legacy `Update-StackQueryTasks` behavior.

## Scope

- In: `🔎` trigger parsing, GitHub source (issues, PRs, discussions) behind an injectable client, `🌐` subtask block replacement, failure isolation, a storage-level refresh.
- Non-goals: other sources; scheduling the refresh (callers/CLI decide when); scoring changes.

## Scenarios

### FR:trigger: Trigger syntax

- **FR:trigger.@function** (P1): Interface: `findQueryTriggers(content): QueryTrigger[]`
- **FR:trigger.pattern** (P1): A checkbox line (`- [ ]` or `- [x]`, any indent) containing `🔎 @{source}/{identifier}[:{type}] ({params})` is a trigger. `source` is `[A-Za-z0-9_-]+`, `identifier` is non-space, `params` is everything up to the first `)` and is passed through unmodified
- **FR:trigger.type** (P1): `:issues`, `:prs`, or no suffix mean issues plus PRs; `:discussions` means discussions; any other suffix makes the trigger invalid (skipped with a warning)

### FR:expand: Expansion

- **FR:expand.@function** (P1): Interface: `expandQueryTasks(content, client, opts): Promise<ExpandResult>` where `opts = { now: Date; timeZone?: string }` and `ExpandResult = { content, processed, skipped, failures }`
- **FR:expand.block** (P1): The managed block is the run of lines right after the trigger that are indented deeper than it; it MUST be replaced in full by one `- [ ] 🌐 {title} — {url}` line per result, indented two spaces deeper than the trigger. A blank line ends the block
- **FR:expand.kind** (P2): A `[Issue]`, `[PullRequest]`, or `[Discussion]` prefix is added after `🌐` only when results mix kinds
- **FR:expand.none** (P1): With zero results the block is the single line `> None as of {MMM d} @ {H:mm}` (wall clock in `timeZone`, default UTC)
- **FR:expand.query** (P1): The client receives `repo`, `kind` (`issues` | `discussions`) and `qualifiers` (the raw params). It is the client's job to scope the search to the repo
- **FR:expand.order** (P1): Multiple triggers MUST be handled independently and a replacement MUST NOT shift another trigger's block
- **FR:expand.gate** (P1): A trigger line carrying `💤`, `⛔`, `🅿️`, or `⏳` MUST be skipped untouched (counted in `skipped`)
- **FR:expand.eol** (P1): Every byte outside replaced blocks MUST be preserved, including BOM and each line's own ending; inserted lines use the trigger line's ending
- **FR:expand.title** (P2): Result titles MUST be collapsed to one line (whitespace runs become one space) so a title cannot break the list

### FR:fail: Failure isolation

- **FR:fail.untouched** (P1): If the client throws, returns a non-array, or returns an item without a string title and url, or the source is not `GitHub` (case-insensitive), or the type suffix is invalid, that trigger's block MUST stay byte-identical and the failure MUST be recorded in `failures` as `{ line, source, identifier, message }`. `expandQueryTasks` MUST NOT throw because of a failing trigger
- **FR:fail.independent** (P1): One failing trigger MUST NOT stop or change the other triggers
- **FR:fail.nodata-loss** (P1): No input exists on which a failure changes the content

### FR:refresh: Storage refresh

- **FR:refresh.@function** (P1): Interface: `refreshQueryTasks(storage, client, opts): Promise<RefreshResult>` with `RefreshResult = { files: string[]; processed; skipped; failures }` (failures carry `path`)
- **FR:refresh.write** (P1): For every task file whose expanded content differs, write it with `expectedVersion` set to the version read. Unchanged files MUST NOT be written
- **FR:refresh.conflict** (P1): A `ConflictError` on one file MUST be recorded as a failure for that file and MUST NOT stop other files

### FR:github: GitHub client

- **FR:github.@function** (P1): Interface: `QueryClient { search(req: QueryRequest): Promise<QueryItem[]> }`; `createGhClient(exec?): QueryClient` implements it with the `gh` CLI
- **FR:github.graphql** (P1): The real client MUST call `gh api graphql` with the query and variables passed as separate arguments (never interpolated into the query document) and no shell. The search string is `repo:{repo} {qualifiers}` trimmed; type is `ISSUE` or `DISCUSSION`; first 25 results
- **FR:github.parse** (P1): A non-zero exit, unparsable JSON, or a response without `data.search.nodes` MUST throw. Nodes lacking a title or url are dropped only if null (GraphQL returns `{}` for unsupported types); anything else malformed throws
- **FR:github.inject** (P1): The executor is injectable; tests MUST NOT touch the network or spawn `gh`
