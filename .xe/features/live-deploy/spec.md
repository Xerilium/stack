---
id: live-deploy
title: Live deployed Stack on the real repo
author: flanakin
description: "Always-on Stack on Azure Static Web Apps with GitHub sign-in, reading and writing the owner's task repo through the GitHub API, with live updates by polling and a sync state that is never a dead end."
dependencies: [azure-host, storage-git, ask-queue, pwa, deploy-docs]
---

<!-- markdownlint-disable single-title -->

# Feature: Live deployed Stack on the real repo

## Purpose

The owner opens Stack (an installed Edge app or a phone) and sees his real tasks and agents' asks, live, with no server of his own to start. GitHub stays the source of truth: every change is a commit on the repo Claude Code already uses.

Decision and research: [docs/hosting.md](../../../docs/hosting.md).

## Scope

- In: a GitHub REST storage adapter for the host (no git binary, no clone), host wiring that picks it for github.com repos, a cheap `GET /api/sync` change probe, change-driven polling in the web app, a sync state with a working action in every state, and a one-command setup script plus a setup doc.
- Non-goals: offline writes or a write queue (pwa non-goal stands), GitHub webhooks or push channels (Web PubSub, SignalR), a GitHub App, multi-user, custom domains.

## Scenarios

### FR:gh: GitHub storage adapter

- **FR:gh.select** (P1): When `STACK_REPO_URL` is `https://github.com/<owner>/<repo>` (optional `.git`, nothing after it), the host stores tasks with `GitHubStorage` over the GitHub REST API. Any other https URL keeps the git clone adapter
- **FR:gh.token** (P1): The repo token is sent only to `https://api.github.com`, only as `Authorization: Bearer`, with `X-GitHub-Api-Version: 2022-11-28`. Redirects are not followed. Errors carry a fixed message with the HTTP status and never the token, headers, URLs with query strings, or response bodies
- **FR:gh.snapshot** (P1): Reads come from a snapshot of the branch head: one recursive tree read per head commit, blob contents fetched on first read and cached by blob sha (content-addressed, so never stale). A path absent from the tree is `NotFoundError` with no network call
- **FR:gh.fresh** (P1): Before a read the adapter re-checks the branch ref at most every `freshMs` (default 5000) with `If-None-Match`; a `304` keeps the snapshot (GitHub does not count it against the rate limit). `sync()` forces a check. A failed check serves the current snapshot and the next read retries
- **FR:gh.paths** (P1): Same contract as `FsStorage`: `validatePath` and `validateAuxPath` rules, `list()` returns sorted `tasks/*.md` direct children (no dotfiles), `listAsks()` returns `tasks/asks/*.md` matching the ask key rule, `STACK_REPO_PATH` prefixes every path. Symlink (`120000`) and submodule entries are refused (`StorageError`), never followed
- **FR:gh.write** (P1): `writeMany` (and `write`, `writeAux`) makes one commit: base64 blobs (bytes kept exactly), a tree on the head's tree (`sha: null` deletes), a commit whose parent is the head, then a ref update with `force: false`. Every `expectedVersion` is checked against the head content first; a mismatch is `ConflictError` and nothing is written. A write that changes no bytes makes no commit
- **FR:gh.race** (P1): When the ref update is rejected because the branch moved (`422`), the adapter re-reads the head, re-checks every `expectedVersion` (any change is `ConflictError`), and rebuilds the commit on the new head, up to 3 attempts, then `ConflictError`
- **FR:gh.serial** (P1): Writes on one adapter instance run one at a time; reads never wait for a write
- **FR:gh.limits** (P2): Each GitHub call has a timeout (default 15000 ms). A truncated tree (repo too large for one tree read) is a `StorageError` naming the limit. Commit author is `STACK_GIT_NAME`/`STACK_GIT_EMAIL`, message as given or `Update <path>`

### FR:sync: Change probe

- **FR:sync.route** (P1): `GET /api/sync` (owner session or any token with `tasks:read`) answers `{ rev }`: the head commit sha after a freshness check, or `null` when the storage has no revision (local `stack web`). `Cache-Control: no-store`. It reads no task content
- **FR:sync.cheap** (P1): A poll when nothing changed costs one conditional GitHub request at most, and none when the last check is younger than `freshMs`

### FR:web: Live updates and sync state

- **FR:web.poll** (P1): With no event stream the page probes `/api/sync` every 15 s while visible, at once when it becomes visible again, and at once on `online`. It reloads asks and tasks only when `rev` changes; a `null` rev reloads on every probe (current behavior)
- **FR:web.state** (P1): One sync state is shown on the Asks view, never "Offline" before the first attempt: `Live` (stream), `Synced <h:mm>` (last good probe), `Connecting…` (first attempt), `Offline · retrying` (network failure, browser offline), `Sign-in expired` (401). Changing state is announced politely
- **FR:web.action** (P1): Every non-good state has an action that does something: `Retry now` restarts the live connection and reloads at once; `Sign in` goes to `/.auth/login/github`. A probe failure keeps retrying on the poll interval without a click

### FR:setup: Owner setup

- **FR:setup.script** (P1): `scripts/setup-azure.sh` sets up hosting from the owner's signed-in `az` and `gh` CLIs: on the first run it creates the resource group and the Free Static Web App from `infra/main.bicep` with the app settings; it stores the deployment token as the `AZURE_STATIC_WEB_APPS_API_TOKEN` Actions secret of the Stack repo, triggers the deploy workflow, and prints the site URL. Re-running it is safe: it never re-applies the template to an existing site; it merges only the changed settings into the current list (other settings such as bot or mail secrets are kept) and keeps the pepper. Every argument is validated before use
- **FR:setup.secrets** (P1): The script reads the repo token from a hidden prompt (or `STACK_REPO_TOKEN` in its env), checks it can read the repo's contents, generates the pepper, and passes secrets only through child-process environments, mode-600 temp files it deletes on exit, and stdin to `gh secret set`; never on a command line. JSON is built by `node` from the environment, never by shell interpolation. It never prints a secret or writes one inside a git work tree
- **FR:setup.owner** (P1): SWA's `userId` is generated per app, not the GitHub id, so the owner cannot be known before the first sign-in. The "Not on the allow-list" page shows the signed-in `provider:userId` and the exact command `scripts/setup-azure.sh --owner <it>`; that command only updates `STACK_OWNERS` on the existing site (no redeploy)
- **FR:setup.doc** (P1): `docs/setup-live.md` lists the human-only steps as go-do items with exact clicks (fine-grained token on the task repo with Contents read and write; run the script; sign in; install as an Edge app) and how to undo each

## Non-functional

- **NFR:cost** (P1): Runs at $0: SWA Free with managed Functions, no other Azure resources; GitHub calls stay well inside 5,000 requests per hour per token (one open page polling every 15 s with no changes uses at most 720 conditional requests per hour, mostly `304`)
- **NFR:security** (P1): No GitHub token reaches the browser. Owner access is the existing SWA GitHub sign-in plus the `STACK_OWNERS` allow-list. Task and ask text are rendered as text, never as html, and never sent to a model by the host

## Architecture constraints

- The adapter implements `Storage & AuxFiles` and `sync()`, plus `rev()`; it uses `fetch` only (injectable), no git, no file system.
- `/api/sync` is an API route so local `stack web` and the host share it.
