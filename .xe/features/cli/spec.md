---
id: cli
title: CLI
description: "The `stack` command line: init, add-project, add, next, start, complete, skip, resume, suspend, set, remove-completed, and update over the core, committing straight to git."
dependencies: [task-lifecycle, summaries, storage-git, config]
---

<!-- markdownlint-disable single-title -->

# Feature: CLI

## Purpose

Let a person or an agent run the whole stack from a terminal with short commands and short output. It replaces the legacy `npm run start|complete|...` scripts (same command meanings) and is the first surface over the core.

## Scope

- In: command parsing, repo setup, one command per core operation, summary regeneration, exit codes, plain and JSON output, a parity check against a copy of the legacy tasks.
- Non-goals: any logic that belongs in the core (all task edits go through `task-lifecycle`); interactive prompts; due-date escalation; GitHub query expansion.

## Scenarios

### FR:run: Running

- **FR:run.bin** (P1): `package.json` MUST declare `bin: { stack: "dist/cli/index.js" }`; the built file starts with a node shebang
- **FR:run.@function** (P1): Interface: `run(argv: string[], io?: { out(s): void; err(s): void }): Promise<number>` returns the exit code and never calls `process.exit`
- **FR:run.dir** (P1): `--dir <path>` sets the repo root (optional override). Without it the repo is found by walking up from the current directory to a folder with `.xe/config/stack.json` or `tasks/*.md`, then `$STACK_DIR`, then `dir` in `~/.config/stack/config.json`, else the current directory. Task files are `<dir>/tasks/*.md`; config is `<dir>/.xe/config/stack.json` (defaults when missing)
- **FR:run.discover** (P1): Repo discovery as described in `run.dir`: walk up from cwd, then `$STACK_DIR`, then user config `dir`
- **FR:web.serve** (P1): `stack web [--repo path-or-git-url] [--port n]` serves the web app and `/api` on `127.0.0.1` (default 4173). The content repo comes from `--repo`, else discovery (cwd walk, `$STACK_REPO`, `$STACK_DIR`, user config `repo`); a git url is cloned once into `~/.config/stack/clones`. Local sign-in stub (`/.auth/me`), no Azure; only loopback Host names are served; same-origin writes only; the single local user is the owner. Stack never holds content: tasks live in a separate content repo
- **FR:web.demo** (P1): Default mode. Copies the content repo's `tasks/` (and `.xe/config/stack.json`) into `~/.config/stack/demo` as a fresh repo with no history or remote, and serves that copy. The real repo is never touched; `--reset` re-copies. The UI shows the mode as a quiet pill (`Demo copy · <branch>` in the rail footer on desktop, `Demo copy` in the phone header), with the repo path only in its tooltip (web-shell `FR:nav.rail`)
- **FR:web.live** (P1): `--live` (or user config `mode: live`) serves the real repo on a dedicated branch (`--branch`, default `stack-web`) through a git worktree under `~/.config/stack/live`, so the repo checkout and `main` are untouched until merged. Edits are direct commits to that branch
- **FR:run.git** (P1): Every write MUST be a direct commit through `GitStorage`. A `--dir` that is not a git work tree MUST fail with exit 1 and a hint to run `stack init`
- **FR:run.nocommit** (P2): `--no-commit` writes files without git (for copies of a task folder)
- **FR:run.remote** (P2): `--remote <name>` (and optional `--branch <name>`) makes writes sync before and push after
- **FR:run.now** (P3): `--now <ISO instant>` overrides the clock (tests, parity)
- **FR:run.help** (P2): `--help`/no command prints the command list and exits 0; `--version` prints the package version

### FR:ref: Task references

- **FR:ref.format** (P1): A task is addressed as `tasks/<file>.md:<line>` with a 1-based line number. `next` and every result print refs in this form; JSON refs are `{ path, line }` with the same 1-based line
- **FR:ref.default** (P1): `start`, `complete`, `skip`, `suspend`, and `resume` take an optional ref; when omitted they act on the top task (`resume`: first parked task), as in legacy
- **FR:ref.expect** (P1): Commands that take a ref accept `--expect <text>`; if the task text on that line differs the command fails with exit 3 and changes nothing
- **FR:ref.invalid** (P1): A malformed ref is a usage error (exit 2)

### FR:cmd: Commands

- **FR:cmd.init** (P1): `stack init` MUST create the directory if needed, `git init` when it is not a repo, create `tasks/.gitkeep` and `.xe/config/stack.json` (`{}`) when missing, and commit them. Running it again changes nothing (exit 0)
- **FR:cmd.add-project** (P1): `stack add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=hours,...] [--weekly-capacity n] [--file name] [--force]` calls `addProject` and prints the new path
- **FR:cmd.add** (P1): `stack add <project> <text...> [--section name] [--parent ref]` calls `addTask` and prints the new task ref
- **FR:cmd.next** (P1): `stack next` prints `ref score project text` for the top task, or nothing and exit 4 when there is none
- **FR:cmd.start** (P1): `stack start [ref]` calls `startTask`
- **FR:cmd.complete** (P1): `stack complete [ref] [--summary t] [--remove]` calls `completeTask`; a rolled recurring row prints `rolled`
- **FR:cmd.skip** (P1): `stack skip [ref]` calls `skipTask` (alias `park`)
- **FR:cmd.resume** (P1): `stack resume [ref]` calls `resumeTask`
- **FR:cmd.suspend** (P1): `stack suspend [ref] [--days n | --hours n]` calls `suspendTask`
- **FR:cmd.set** (P1): `stack set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis]` calls `setProperties`; an emoji flag takes an emoji or `none`
- **FR:cmd.remove-completed** (P1): `stack remove-completed [--project name]` calls `removeCompleted` and prints the removed count
- **FR:cmd.update** (P1): `stack update [--sweep]` regenerates README.md, stack.md, projects.md, and my-day.md with `generateSummaries` (previous README/projects passed in), writes only files whose text changed, and makes ONE commit for all changed summary files. `--sweep` first runs the start-date, suspend, and due-date sweeps (one commit for the task files). `--queries` first refreshes `🔎` query tasks through the `gh` CLI (off by default: it uses the network; files change and commit one by one; failures are reported, not fatal). my-day.md is untouched when the generator returns none

### FR:out: Output and exit codes

- **FR:out.text** (P1): Default output is one short line per result (verb, ref, task text), nothing else. A no-op prints `no change: <reason>`
- **FR:out.json** (P1): `--json` prints one JSON object on stdout: the result (`ok`, `changed`, `ref`, `before`, `after`, `message`, `rolled`, or command fields). Errors print `{ ok: false, error, code }` on stdout
- **FR:out.quiet** (P2): Errors in text mode go to stderr as `error: <message>`; stdout stays empty
- **FR:out.codes** (P1): Exit codes: 0 ok (including no-op), 1 runtime failure (git, storage, config), 2 usage or invalid input (`LifecycleError`, bad flags), 3 conflict (`ConflictError`), 4 nothing to act on (no task qualifies)

### FR:parity: Legacy parity

- **FR:parity.script** (P2): `pnpm run parity` runs `tests/parity/cli-parity.test.ts`, which with `STACK_LEGACY_DIR` set copies that legacy folder's `tasks/` and config to a temp directory, runs `stack update --no-commit` and `stack next`, and compares the four summary files and the top task with the legacy files in the folder. It is skipped when the variable is unset. The legacy folder is never written

## Architecture constraints

- **FR:arch.thin** (P1): CLI code holds no task-editing rules; it parses flags, builds the context, calls the core, and formats output
- **FR:arch.storage** (P1): Summary files are written through the same `Storage` (paths `README.md`, `stack.md`, `projects.md`, `my-day.md` are allowed beside `tasks/*.md`; `list` still returns only task files)

## Dependencies

task-lifecycle, summaries, storage-git, config.
