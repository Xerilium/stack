---
id: live-deploy
title: Live deployed Stack on the real repo
author: flanakin
description: Always-on Stack on Azure SWA over the owner's GitHub repo, with a sync probe, pending-commit flush, and live polling
dependencies: [azure-host, storage-git, ask-queue, pwa, deploy-docs]
---

<!-- markdownlint-disable single-title -->

# Feature: Live deployed Stack on the real repo

## Purpose

The owner opens Stack (an installed Edge app or a phone) and sees his real tasks and agents' asks, live, with no server of his own to start. GitHub stays the source of truth: every change is a commit on the repo Claude Code already uses. Offline writes, push channels, a GitHub App, multi-user, and custom domains are out of scope.

Decision and research: [docs/hosting.md](../../../docs/hosting.md).

## Scenarios

### FR:gh: GitHub storage adapter

Stack System needs to read and write the owner's task repo through the GitHub API so that the hosted app needs no git binary, no clone, and no disk.

- **FR:gh.@function** (P1): Interface: `new GitHubStorage({ owner, repo, branch, token, fetch?, freshMs?, path? })` implements `Storage & AuxFiles` with `writeMany`, `sync()`, and `rev()`
  > - @req FR:storage-git/interface.@type
- **FR:gh.select** (P1): When `STACK_REPO_URL` is `https://github.com/<owner>/<repo>` (optional `.git`, nothing after it), the host MUST store tasks with `GitHubStorage` over the GitHub REST API
  > - @req FR:azure-host/settings.url
  - Any other https URL keeps the git clone adapter
- **FR:gh.token** (P1): The adapter MUST send the repo token only to `https://api.github.com`, only as `Authorization: Bearer`, with `X-GitHub-Api-Version: 2022-11-28`, and never follow redirects
  - **FR:gh.token.errors** (P1): Errors MUST carry a fixed message with the HTTP status and never the token, headers, URLs with query strings, or response bodies
- **FR:gh.snapshot** (P1): Reads MUST come from a snapshot of the branch head: one recursive tree read per head commit, blob contents fetched on first read and cached by blob sha (content-addressed, so never stale)
  - **FR:gh.snapshot.missing** (P1): A path absent from the tree MUST be `NotFoundError` with no network call
- **FR:gh.fresh** (P1): Before a read the adapter MUST re-check the branch ref at most every `freshMs` (default 5000) with `If-None-Match`; a `304` keeps the snapshot (GitHub does not count it against the rate limit)
  - **FR:gh.fresh.sync** (P1): `sync()` MUST force a check
  - **FR:gh.fresh.fail** (P1): A failed check MUST serve the current snapshot; the next read retries
- **FR:gh.paths** (P1): The adapter MUST keep the `FsStorage` path contract: `validatePath` and `validateAuxPath` rules, `list()` returns sorted `tasks/*.md` direct children (no dotfiles), `listAsks()` returns `tasks/asks/*.md` matching the ask key rule, `STACK_REPO_PATH` prefixes every path
  > - @req FR:storage-git/interface.paths
  > - @req FR:ask-queue/ask.path
  - **FR:gh.paths.links** (P1): Symlink (`120000`) and submodule entries MUST be refused (`StorageError`), never followed
- **FR:gh.write** (P1): `writeMany` (and `write`, `writeAux`) MUST make one commit: base64 blobs (bytes kept exactly), a tree on the head's tree (`sha: null` deletes), a commit whose parent is the head, then a ref update with `force: false`
  > - @req FR:storage-git/write.many
  - **FR:gh.write.expected** (P1): Every `expectedVersion` MUST be checked against the head content first; a mismatch is `ConflictError` and nothing is written
    > - @req FR:storage-git/interface.version
  - **FR:gh.write.noop** (P1): A write that changes no bytes MUST make no commit
- **FR:gh.race** (P1): When the ref update is rejected because the branch moved (`422`), the adapter MUST re-read the head, re-check every `expectedVersion` (any change is `ConflictError`), and rebuild the commit on the new head, up to 3 attempts, then `ConflictError`
- **FR:gh.serial** (P1): Writes on one adapter instance MUST run one at a time; reads never wait for a write
- **FR:gh.limits** (P2): Each GitHub call MUST have a timeout (default 15000 ms)
  - **FR:gh.limits.tree** (P2): A truncated tree (repo too large for one tree read) MUST be a `StorageError` naming the limit
  - Commit author is `STACK_GIT_NAME`/`STACK_GIT_EMAIL`, message as given or `Update <path>`

### FR:sync: Change probe and flush

The web app needs a cheap way to ask "did anything change, and is anything unsaved?" and to save now, so that polling costs nothing when idle and no edit is left behind on the desk.

- **FR:sync.@api** (P1): Interface: `GET /api/sync`, `POST /api/sync`
- **FR:sync.route** (P1): `GET /api/sync` (owner session or any token with `tasks:read`) MUST answer the sync state (@req FR:$sync-state) with `Cache-Control: no-store`, reading no task content
  - `rev` is the head commit sha after a freshness check, or `null` when the storage has no revision (local `stack web`)
- **FR:sync.pending** (P1): When the storage batches commits, the answer MUST add `pending` and `since`; other storages omit both
  > - @req FR:storage-git/batch.pending
- **FR:sync.flush** (P1): `POST /api/sync` (owner only) MUST commit and push what is pending now and answer the flush result (@req FR:$flush-result)
  > - @req FR:storage-git/batch.flush
  - **FR:sync.flush.none** (P1): With nothing pending, or a storage that does not batch, the route MUST answer `flushed: 0` and change nothing
  - **FR:sync.flush.error** (P1): A conflict or push failure MUST be a 409 or 500 with the storage's message; the batch stays pending
    > - @req FR:storage-git/batch.failure
- **FR:sync.cheap** (P1): A poll when nothing changed MUST cost one conditional GitHub request at most, and none when the last check is younger than `freshMs`

### FR:web: Live updates and sync state

Owner needs the page to stay current and to say plainly whether it is live, stale, or holding unsaved edits, so that nothing is a dead end and nothing is lost when he walks to his phone.

- **FR:web.poll** (P1): With no event stream the page MUST probe `/api/sync` every 15 s while visible, at once when it becomes visible again, and at once on `online`
  > - @req FR:ask-queue/live.fallback
  - **FR:web.poll.reload** (P1): The page MUST reload asks and tasks only when `rev` changes; a `null` rev reloads on every probe
- **FR:web.state** (P1): The Asks view MUST show one sync state, never "Offline" before the first attempt: `Live` (stream), `Synced <h:mm>` (last good probe), `Connecting…` (first attempt), `Offline · retrying` (network failure, browser offline), `Sign-in expired` (401)
  > - @req FR:pwa/offline.banner
  - **FR:web.state.announce** (P2): A state change MUST be announced politely
- **FR:web.action** (P1): Every non-good state MUST have an action that does something: `Retry now` restarts the live connection and reloads at once; `Sign in` goes to `/.auth/login/github`
  - **FR:web.action.auto** (P1): A probe failure MUST keep retrying on the poll interval without a click
- **FR:web.unsaved** (P1): When `/api/sync` reports pending writes the page MUST show a quiet `Unsaved · <n>` chip with the time of the first pending write in its tooltip
  - **FR:web.unsaved.click** (P1): A click MUST post `/api/sync`; the chip reads `Saving…` until the next answer clears it
  - **FR:web.unsaved.hide** (P1): The page MUST post `/api/sync` (keepalive) when it is hidden or unloaded while writes are pending
  - **FR:web.unsaved.refresh** (P1): The page MUST re-read the count after each of its own writes, on each change event, and when it becomes visible
  - **FR:web.unsaved.none** (P1): The chip MUST be absent when nothing is pending or the answer has no `pending`
  - **FR:web.unsaved.error** (P2): A failed flush MUST keep the chip and show the error as a toast

### FR:setup: Owner setup

Owner needs one script and one short doc to put Stack online so that hosting is a ten-minute job with nothing to remember.

- **FR:setup.script** (P1): `scripts/setup-azure.ps1` MUST set up hosting from the owner's signed-in Az PowerShell and `gh` (see FR:deploy-stack-xerilium-com/setup.ps): on the first run it creates the resource group and the Free Static Web App from `infra/main.bicep` with the app settings, stores the deployment token as the `AZURE_STATIC_WEB_APPS_API_TOKEN` Actions secret of the Stack repo, triggers the deploy workflow, and prints the site URL
  > - @req FR:deploy-docs/infra.swa
  > - @req FR:deploy-docs/ci.deploy
  - **FR:setup.script.rerun** (P1): Re-running MUST be safe: it never re-applies the template to an existing site; it merges only the changed settings into the current list (other settings such as bot or mail secrets are kept) and keeps the pepper
  - **FR:setup.script.args** (P1): Every argument MUST be validated before use
- **FR:setup.secrets** (P1): The script MUST read the repo token from a hidden prompt (or `STACK_REPO_TOKEN` in its env), check it can read the repo's contents, generate the pepper, and pass secrets only in process memory, child-process environments, and stdin to `gh secret set`; never on a command line or in a file
  - **FR:setup.secrets.json** (P1): JSON MUST be built from objects (`ConvertTo-Json`, a parameter hashtable), never by string interpolation
  - **FR:setup.secrets.quiet** (P1): The script MUST never print a secret or write one inside a git work tree
- **FR:setup.owner** (P1): The "Not on the allow-list" page MUST show the signed-in `provider:userId` and the exact command `scripts/setup-azure.ps1 -Owner <it>`; that command only updates `STACK_OWNERS` on the existing site (no redeploy)
  > - @req FR:azure-host/auth.swa
  - SWA's `userId` is generated per app, not the GitHub id, so the owner cannot be known before the first sign-in
- **FR:setup.doc** (P1): `docs/setup-live.md` MUST list the human-only steps as go-do items with exact clicks (fine-grained token on the task repo with Contents read and write; run the script; sign in; install as an Edge app) and how to undo each
  > - @req FR:deploy-docs/docs.runbook

### Non-functional Requirements

- **NFR:cost** (P1): The deployment MUST run at $0: SWA Free with managed Functions, no other Azure resources
  - **NFR:cost.github** (P1): GitHub calls MUST stay well inside 5,000 requests per hour per token (one open page polling every 15 s with no changes uses at most 720 conditional requests per hour, mostly `304`)
- **NFR:security** (P1): No GitHub token MUST reach the browser
  - **NFR:security.owner** (P1): Owner access MUST be the existing SWA GitHub sign-in plus the `STACK_OWNERS` allow-list
  - **NFR:security.text** (P1): Task and ask text MUST be rendered as text, never as html, and never sent to a model by the host

## Data Model

- **FR:$sync-state** (P1): **`SyncState`** — Answer of `GET /api/sync`.
  - `rev` (string | null) — head commit sha; `null` when the storage has no revision
  - `pending` (number?) — writes not yet committed; present only for a batching storage
  - `since` (string | null?) — ISO time of the first pending write; present only for a batching storage
- **FR:$flush-result** (P1): **`FlushResult`** — Answer of `POST /api/sync`.
  - `flushed` (number) — writes committed by this call
  - `rev` (string | null) — the commit made by this flush, else the storage's revision (`null` when it has none)

## Architecture Constraints

- The adapter implements `Storage & AuxFiles` and `sync()`, plus `rev()`; it uses `fetch` only (injectable), no git, no file system.
- `/api/sync` is an API route so local `stack web` and the host share it; the handler discovers `pending()`/`flush()` on the storage and never imports an adapter.

## External Dependencies

Azure Static Web Apps (Free), GitHub REST API, Az PowerShell and `gh` (setup script only)
