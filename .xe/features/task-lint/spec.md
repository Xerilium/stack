---
id: task-lint
title: Task Bloat Lint
author: flanakin
description: "A deterministic lint that fails on bloated task rows: long titles, status prose, extra parentheticals, and details that are not nested bullets."
dependencies:
  [
    task-parser,
    task-lifecycle,
    cli,
    product-reset,
    priorities-tables,
    auto-priority,
    query-tasks,
  ]
---

<!-- markdownlint-disable single-title -->

# Feature: Task Bloat Lint

## Purpose

Agents fill task titles with status, dates, and detail. The owner then cannot scan a task file. This lint fails on each bloated row and names the file, the line, and the rule, so the agent that wrote the row fixes it.

## Scope

- In: Four rules on open task rows, a `stack lint` command, the same rules in `stack check`, in `stack update`, and in the CLI commands that write a title (`add`, `capture`, `retitle`), and the same rules in the agent write guidance (`docs/task-rubric.md`).
- Non-goals: A fix mode. A model call. A change to the task grammar or to the parser. A gate on the web app or the HTTP API (the owner writes there).
- The lint reads `parseProject` output and the file lines. It never writes.

## Scenarios

### FR:scope: Rows the lint reads

- **FR:scope.open** (P1): The lint MUST read every open task row (`- [ ]`) in every section of a project file; a checked row MUST give no issue
- **FR:scope.generated** (P1): A script-owned query row (text starts with `🌐`) MUST give no issue, because Stack writes its title from GitHub

### FR:title: The measured title

- **FR:title.@function** (P1): `lintTitle(text: string): LintFinding[]` MUST return one finding (`{ rule, message }`) for each title rule the row text breaks, in rule order `title-length`, `title-status`, `title-parens`, `detail-nesting`
- **FR:title.links** (P1): The rules MUST read a markdown link as its label only, and MUST NOT read a bare URL
- **FR:title.code** (P2): Rules `title-status`, `title-parens`, and `detail-nesting` MUST NOT read a code span (`` `text` ``); rule `title-length` MUST count it
- **FR:title.exempt** (P1): The rules MUST NOT read these marks: An agent tag `(agent: ...)`, a tier marker (`1️⃣`, `2️⃣`, `3️⃣`), a due mark (`📅 Nov 5:`, or `📅 Nov 5` with no colon), a start mark (`⏰ Apr 1:`), a suspend mark (`💤 Nov 5:`), and a query trigger (`🔎 @Source/id (params)`)

### FR:rule: Rules

- **FR:rule.length** (P1): Rule `title-length` MUST fail a measured title of more than 120 characters (code points); the message MUST state the count
- **FR:rule.status** (P1): Rule `title-status` MUST fail a measured title that holds status prose; the message MUST quote the first match
  - **FR:rule.status.words** (P1): Status prose is one of these whole words, in any case: `done`, `waiting`, `blocked`, `merged`, `landed`, `shipped`, `parked`, `on hold`, `as of`
  - **FR:rule.status.dates** (P1): Status prose is also a date: A month name or its 3-letter form with a day (`Nov 18`, `November 18th`, `18 Nov`), or an ISO date (`2026-11-18`); the month starts with a capital letter; a numeric date such as `11/18` is not read, because PR lists look the same
- **FR:rule.parens** (P1): Rule `title-parens` MUST fail a measured title with more than 1 parenthetical; the message MUST state the count
- **FR:rule.nesting** (P1): Rule `detail-nesting` MUST fail a detail that is not a nested bullet
  - **FR:rule.nesting.inline** (P1): A measured title MUST fail when text follows a dash separator (`--`, `—`, `–`)
  - **FR:rule.nesting.prose** (P1): A line nested under an open row MUST fail when it is not a bullet (`- `, `* `, `+ `, or a numbered item such as `1. `); the issue MUST name the line of the prose, not the line of the row
  - **FR:rule.nesting.allowed** (P1): A blank line, a child task row and its block, a blockquote line (`>`; Stack writes `> ✅ **COMPLETED**:` there), and a code fence (` ``` ` or `~~~`) with its lines MUST give no issue; a task row inside a code fence is an example and MUST give no issue

### FR:file: Lint one file

- **FR:file.@function** (P1): `lintProject(path: string, src: string): LintIssue[]` MUST return every issue in the file as `{ path, line, rule, message }`, with a 1-based `line`, in line order
- **FR:file.row** (P1): `lintRow(path, src, line)` MUST return only the issues of the row at 1-based `line`: Its title issues and the prose lines of its own block

### FR:cli: Commands

- **FR:cli.lint** (P1): `stack lint [--project name] [--json]` MUST lint every file in `tasks/`, or only the file of `--project` (project ID)
  - **FR:cli.lint.out** (P1): Text output MUST be one line per issue, `<path>:<line> <rule> <message>`, then `<n> issues in <m> files`; with no issue it MUST print `no issues`
  - **FR:cli.lint.exit** (P1): The exit code MUST be 1 when there is an error issue, else 0. Warning rules (`note-status`, `meta-key`, `meta-emoji`) flag existing content and never fail
  - **FR:cli.lint.json** (P1): `--json` MUST print `{ ok, command: 'lint', issues: [...] }`, where `ok` is false when there is an issue
  - **FR:cli.lint.unknown** (P2): An unknown `--project` MUST fail with exit 2
- **FR:cli.check** (P1): `stack check <ref>` MUST also run the lint on that row: With an issue it MUST exit 1, add ` lint: <rules>` to the text line, and add `lint: [{ line, rule, message }]` to the JSON; with no issue the output MUST NOT change
- **FR:cli.write** (P1): `stack add`, `stack capture` (not `--dry-run`), and `stack retitle` MUST refuse a new title that breaks a title rule: Exit 2, no write, and one `<rule> <message>` per broken rule in the error
- **FR:cli.update** (P1): `stack update` MUST write the summaries first, then lint every file in `tasks/`: With an issue it MUST print each issue line and the count line on stderr and still exit 0, so the daily loop never stops on old content; `--json` MUST add `lint: [...]` (the issues) and keep `ok` true
  - **FR:cli.update.refresh** (P1): The summary refresh that follows a lifecycle command (`start`, `complete`, and the like) MUST NOT run the lint, so old rows never block a status change

### FR:docs: Agent write guidance

- **FR:docs.rubric** (P1): `docs/task-rubric.md` MUST state the four rules with their rule names and MUST tell the agent to run `stack lint`
- **FR:docs.cli** (P2): `docs/cli.md` MUST list `lint` with its output format and exit codes

## Architecture Constraints

- Pure core module `src/core/task-lint.ts`: No IO, no model call, no clock.
- Reuse `parseProject` for rows; reuse the mark grammars of `tiered-tasks` (agent tag, tier markers), `autopri-tags` (due mark), `lifecycle` (suspend mark), and `query-tasks` (trigger).
