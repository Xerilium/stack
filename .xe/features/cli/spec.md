---
id: cli
title: CLI
description: The `stack` command line over the core, committing straight to git, plus `stack web` for the local app
dependencies: [task-lifecycle, summaries, storage-git, config]
---

<!-- markdownlint-disable single-title -->

# Feature: CLI

## Purpose

Let a person or an agent run the whole stack from a terminal with short commands and short output, and serve the web app over a task repo on the owner's machine. It replaces the legacy `npm run start|complete|...` scripts (same command meanings) and is the first surface over the core. Task-editing rules stay in the core; the CLI parses, calls, and prints.

## Scenarios

### FR:run: Running

Owner needs one `stack` binary that finds the task repo and commits what it changes so that every command works from any folder with no setup.

- **FR:run.bin** (P1): `package.json` MUST declare `bin: { stack: "dist/cli/index.js" }`
  - The built file starts with a node shebang
- **FR:run.@function** (P1): Interface: `run(argv: string[], io?: { out(s): void; err(s): void }): Promise<number>`
  - Returns the exit code and never calls `process.exit`
- **FR:run.dir** (P1): `--dir <path>` MUST set the repo root (optional override)
  - Task files are `<dir>/tasks/*.md`; config is `<dir>/.xe/config/stack.json` (defaults when missing)
    > - @req FR:config/load.@function
- **FR:run.discover** (P1): Without `--dir`, `run` MUST find the repo by walking up from the current directory to a folder with `.xe/config/stack.json` or `tasks/*.md`, then `$STACK_DIR`, then `dir` in `~/.config/stack/config.json`, else the current directory
- **FR:run.git** (P1): Every write MUST be a direct commit through `GitStorage`
  > - @req FR:storage-git/git.commit
  - **FR:run.git.worktree** (P1): A `--dir` that is not a git work tree MUST fail with exit 1 and a hint to run `stack init`
- **FR:run.nocommit** (P2): `--no-commit` MUST write files without git (for copies of a task folder)
- **FR:run.remote** (P2): `--remote <name>` (and optional `--branch <name>`) MUST make writes sync before and push after
  > - @req FR:storage-git/git.remote
- **FR:run.now** (P3): `--now <ISO instant>` MUST override the clock (tests, parity)
- **FR:run.help** (P2): `--help`/no command MUST print the command list and exit 0
  - **FR:run.help.version** (P2): `--version` MUST print the package version

### FR:web: Local web app

Owner needs `stack web` to serve the app over a task repo on their own machine so that they can try it on a copy, or run it for real on the files they already edit by hand.

- **FR:web.@cli** (P1): Interface: `stack web [--repo path-or-git-url] [--live] [--branch name] [--batch minutes] [--port n] [--reset] [--bind loopback|tailnet]` (`--bind`: [tailnet-access](../tailnet-access/spec.md))
- **FR:web.serve** (P1): `stack web` MUST serve the web app and `/api` on `127.0.0.1` (default port 4173), plus the Tailscale addresses with `--bind tailnet` (tailnet-access `FR:bind.tailnet`). With no repo it MUST serve the first-run setup flow instead (`FR:first-run-onboarding/host.setup`)
  - The content repo comes from `--repo`, else discovery (cwd walk, `$STACK_REPO`, `$STACK_DIR`, user config `repo`); a git url is cloned once into `~/.config/stack/clones`
  - **FR:web.serve.local** (P1): The server MUST answer `/.auth/me` with a local sign-in stub (no Azure) whose single user is the owner
  - **FR:web.serve.loopback** (P1): The server MUST serve only loopback Host names and accept writes only from its own origin
  - Stack never holds content: tasks live in a separate content repo
- **FR:web.demo** (P1): By default `stack web` MUST serve a copy: the content repo's `tasks/` (and `.xe/config/stack.json`, and `.claude/agents/` when present) copied into `~/.config/stack/demo` as a fresh repo with no history or remote
  - **FR:web.demo.untouched** (P1): Demo mode MUST never write to the real repo
  - **FR:web.demo.reset** (P2): `--reset` MUST re-copy the demo
  - **FR:web.demo.pill** (P2): The UI MUST show demo mode in the brand (`Stack [DEMO]`, web-shell `FR:nav.rail.brand`), with the repo path only in its tooltip and never as a banner
- **FR:web.live** (P1): `--live` (or user config `mode: live`) MUST serve the owner's real checkout on the branch it has checked out (`main` included), so the files under `<repo>/tasks/` are the single source of truth for the app and the owner's editor
  - **FR:web.live.branch** (P1): `--branch <name>` (or user config `branch`) MUST only assert that branch is checked out; another branch is refused with a clear message
  - **FR:web.live.refuse** (P1): A detached HEAD or a folder that is not a git repo MUST be refused with a clear message before the server starts
  - **FR:web.live.remote** (P1): When the repo has a remote (`origin`, or user config `remote`), every commit MUST be pushed to it so the hosted app and the phone see the change; without one, commits stay local
    > - @req FR:storage-git/batch.flush.remote
  - **FR:web.live.pill** (P2): The brand MUST read `Stack` (no `[DEMO]`) and the pill `Live · <branch>`
- **FR:web.batch** (P1): In live mode, edits MUST land in the files at once and be committed in batches through `BatchedGitStorage`
  > - @req FR:storage-git/batch.write
  > - @req FR:storage-git/batch.idle
  - **FR:web.batch.idle** (P1): The batch MUST commit after `--batch <minutes>` (user config `batch`, default 5) of no edits
  - **FR:web.batch.zero** (P1): `--batch 0` MUST commit every edit on its own
    > - @req FR:storage-git/batch.idle.zero
  - **FR:web.batch.shutdown** (P1): SIGINT and SIGTERM MUST flush what is pending before the process exits
    > - @req FR:storage-git/batch.idle.close
  - **FR:web.batch.startup** (P2): The startup line MUST say where edits go and when they commit: `LIVE MODE: edits land in <repo>/tasks on <branch>; committed after <n> min idle` (`committed on every edit` with `--batch 0`), with `, then pushed to <remote>` when there is one

### FR:ref: Task references

Owner needs a short, stable way to name a task so that a command acts on exactly the line they mean.

- **FR:ref.format** (P1): A task MUST be addressed as `tasks/<file>.md:<line>` with a 1-based line number
  - `next` and every result print refs in this form; JSON refs are `{ path, line }` with the same 1-based line
- **FR:ref.default** (P1): `start`, `complete`, `skip`, `suspend`, and `resume` MUST accept an optional ref and act on the top task when it is omitted (`resume`: first parked task), as in legacy
- **FR:ref.expect** (P1): Commands that take a ref MUST accept `--expect <text>` and fail with exit 3, changing nothing, when the task text on that line differs
- **FR:ref.invalid** (P1): A malformed ref MUST be a usage error (exit 2)

### FR:cmd: Commands

Owner needs one command per core operation so that the terminal can do everything the legacy scripts did.

- **FR:cmd.init** (P1): `stack init` MUST create the directory if needed, `git init` when it is not a repo, create `tasks/.gitkeep` and `.xe/config/stack.json` (`{}`) when missing, and commit them
  - Running it again changes nothing (exit 0)
- **FR:cmd.add-project** (P1): `stack add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=hours,...] [--weekly-capacity n] [--file name] [--force]` MUST call `addProject` and print the new path
  > - @req FR:task-lifecycle/project.file
- **FR:cmd.add** (P1): `stack add <project> <text...> [--section name] [--parent ref]` MUST call `addTask` and print the new task ref
  > - @req FR:task-lifecycle/add.insert
- **FR:cmd.next** (P1): `stack next [--top n]` MUST print `ref score project text` for each of the first `n` ranked tasks (default 1, max 50), or nothing and exit 4 when there is none; the order is `rankStack`'s, so the `/next` skill and the web Home cannot drift
  > - @req FR:task-lifecycle/rank.order
- **FR:cmd.start** (P1): `stack start [ref]` MUST call `startTask`
  > - @req FR:task-lifecycle/start.status
- **FR:cmd.complete** (P1): `stack complete [ref] [--summary t] [--remove]` MUST call `completeTask`
  > - @req FR:task-lifecycle/complete.check
  - A rolled recurring row prints `rolled`
- **FR:cmd.skip** (P1): `stack skip [ref]` MUST call `skipTask` (alias `park`)
  > - @req FR:task-lifecycle/skip.park
- **FR:cmd.resume** (P1): `stack resume [ref]` MUST call `resumeTask`
  > - @req FR:task-lifecycle/resume.first
- **FR:cmd.suspend** (P1): `stack suspend [ref] [--days n | --hours n]` MUST call `suspendTask`
  > - @req FR:task-lifecycle/suspend.marker
- **FR:cmd.set** (P1): `stack set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis]` MUST call `setProperties`
  > - @req FR:task-lifecycle/set.props
  - An emoji flag takes an emoji or `none`
- **FR:cmd.retitle** (P1): `stack retitle <ref> --text t [--expect t] [--no-update]` MUST replace the row text in place through the web edit path (`editTask`): checkbox, indent, children, notes, and history stay. Old status, priority, effort, and impact marks at the start or end of the row stay unless the new text has a mark of the same kind at that end (tags after the marks, such as `📅 Nov 5`, are part of the text: pass them in `--text`). Summaries refresh like `FR:cmd.refresh`. Missing ref or `--text` is exit 2; a changed row (`--expect`) is exit 3
  > - @req FR:web-app/api.edit
- **FR:cmd.note** (P1): `stack note add <ref> --text t [--expect t]` MUST append `- <t>` as a nested bullet at the end of the task block, children and older notes kept; it copies a child's indent when there is one and never refreshes summaries. A changed row (`--expect`) is exit 3. Empty, multi-line, or checkbox-like text is exit 2
- **FR:cmd.remove-completed** (P1): `stack remove-completed [--project name]` MUST call `removeCompleted` and print the removed count
  > - @req FR:task-lifecycle/remove.blocks
- **FR:cmd.update** (P1): `stack update [--sweep] [--engine legacy|stack]` MUST regenerate README.md, stack.md, projects.md, and my-day.md with `generateSummaries` (previous README/projects passed in), writing only files whose text changed
  > - @req FR:summaries/generate.@function
  - **FR:cmd.update.engine** (P1): `--engine stack` MUST generate the files with the `stack` engine and the overrides in `.stack/priorities.json`, so their scores and order match `stack next`; the default is `stack`, so the README top is the row a no-ref `start`, `complete`, or `skip` acts on (`FR:ref.default`); `--engine legacy` MUST write the PowerShell output byte-for-byte (parity)
    > - @req FR:summaries/engine.@option
  - **FR:cmd.update.commit** (P1): `update` MUST make ONE commit for all changed summary files
    > - @req FR:storage-git/write.many.commit
  - **FR:cmd.update.sweep** (P1): `--sweep` MUST first run the start-date, suspend, and due-date sweeps (one commit for the task files)
    > - @req FR:task-lifecycle/sweep.all
  - **FR:cmd.update.queries** (P2): `--queries` MUST first refresh `🔎` query tasks through the `gh` CLI (off by default: it uses the network; files change and commit one by one; failures are reported, not fatal)
  - my-day.md is untouched when the generator returns none
- **FR:cmd.refresh** (P1): After `start`, `complete`, `skip`/`park`, `resume`, `suspend`, `retitle`, `remove-completed`, and `add-project` change a file, the CLI MUST run `update --sweep` (and `--queries` when that flag is given), so the task files and the four summaries are current, as legacy left them (legacy runs `Update-StackSummary` after each of these). The summaries use the `update` default engine (`FR:cmd.update.engine`). A no-op MUST NOT refresh
  - **FR:cmd.refresh.skip** (P2): `--no-update` MUST skip the refresh
  - **FR:cmd.refresh.json** (P2): `--json` MUST add `update: { files, swept?, queries? }` to the result; text output stays one line

### FR:out: Output and exit codes

AI Agent needs terse, predictable output and exit codes so that scripts and agents can act on results without parsing prose.

- **FR:out.text** (P1): Default output MUST be one short line per result (verb, ref, task text), nothing else
  - A no-op prints `no change: <reason>`
- **FR:out.json** (P1): `--json` MUST print one JSON object on stdout: the result (`ok`, `changed`, `ref`, `before`, `after`, `message`, `rolled`, or command fields)
  - Errors print `{ ok: false, command, error, code }` on stdout (`command` is absent when it is unknown)
  - `start`, `complete`, `skip`, `resume`, `suspend`, and `set` add `command`, `project`, and `text` per `FR:task-lifecycle/doc.json`; `update` adds `command: "update"`
    > - @req FR:task-lifecycle/doc.json
- **FR:out.quiet** (P2): Errors in text mode MUST go to stderr as `error: <message>`, leaving stdout empty
- **FR:out.codes** (P1): Exit codes MUST be: 0 ok (including no-op), 1 runtime failure (git, storage, config), 2 usage or invalid input (`LifecycleError`, bad flags), 3 conflict (`ConflictError`), 4 nothing to act on (no task qualifies)

### FR:parity: Legacy parity

Owner needs proof that the new CLI produces the legacy summaries so that the switch from the npm scripts loses nothing.

- **FR:parity.script** (P2): `pnpm run parity` MUST run `tests/parity/cli-parity.test.ts`, which with `STACK_LEGACY_DIR` set copies that legacy folder's `tasks/` and config to a temp directory, runs `stack update --no-commit` and `stack next`, and compares the four summary files and the top task with the legacy files in the folder
  - It is skipped when the variable is unset. The legacy folder is never written

## Data Model

None

## Architecture Constraints

- **FR:arch.thin** (P1): CLI code MUST hold no task-editing rules; it parses flags, builds the context, calls the core, and formats output
- **FR:arch.storage** (P1): Summary files MUST be written through the same `Storage` (paths `README.md`, `stack.md`, `projects.md`, `my-day.md` are allowed beside `tasks/*.md`; `list` still returns only task files)
  > - @req FR:storage-git/interface.paths

## External Dependencies

`gh` CLI (only for `stack update --queries`)
