---
id: pr-review-lane
title: PR Review Lane
author: flanakin
description: "PR review aids: spec-line sort, agent briefs for Autopilot PRs, and a one-PR live validation checklist."
dependencies: [pr-priority, pr-page, status-ingest, ask-queue, api, auth-security, cli, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: PR Review Lane

## Purpose

The owner reviews many PRs. Small spec changes are fast to review, so he wants them first. An Autopilot PR that waits on him needs a short brief, so he decides fast. Some PRs need a live check in a running app. Exactly one PR is always in the live lane, so an agent prepares the next one while he checks the current one.

## Scope

- In: spec-line counts and the live-validation rule; the brief store; the live lane store, its CLI and API; one checklist panel at `#/live`; the agent contract `docs/live-validation-agent.md`.
- Out: the PR page rows and groups (`FR:pr-page/*`); the queue and its CLI (`FR:pr-priority/*`). This feature reads `<home>/pr-priority.json` and never writes it.
- Never: an LLM call; a write to GitHub; a merge, a label, an un-draft; a reply to, an edit of, or a resolve of a review thread; a server or agent start.

## Terms

- **Ref**: `<owner>/<name>#<number>` or a GitHub PR url (`FR:pr-priority/queue.ref`). Repo names compare without case.
- **Spec file**: a path under `.xe/`, a file named `spec.md` in any folder, or a `.md` file under `docs/`.
- **Autopilot label**: `Status: 🤖 Autopilot` (no case, variation selectors ignored).
- **Home**: `STACK_HOME` or `~/.stack` (`FR:status-ingest/store.path`).

## Scenarios

### FR:sort: Spec-line sort

The owner needs the smallest spec change first so that he clears reviews fast.

- **FR:sort.lines** (P1): `specLines(files)` is pure. It returns the sum of `additions + deletions` of each spec file in the PR file list. A PR with no spec file has 0
- **FR:sort.order** (P1): `sortBySpecLines(rows)` is pure and stable. It drops Autopilot rows, then sorts by `specLines`, fewest first. A row with no count goes last. Ties keep the input order
- **FR:sort.cache** (P1): The host reads PR facts with `gh` (`STACK_GH` or `gh`): `gh api repos/<repo>/pulls/<n>` (head SHA, body, labels, title, draft) and, only on a cache miss, `gh api --paginate repos/<repo>/pulls/<n>/files`. It caches `{repo, number, url, title, headSha, specLines, labels, live, reasons, at}` in `<home>/pr-facts.json` per PR and head SHA. A new head SHA reads the files again. At most 4 reads run at a time. A PR that `gh` cannot read keeps its prior facts. The browser never gets a GitHub token
- **FR:sort.cli** (P1): `stack prs [--group g] --sort spec-lines` (`FR:pr-page/cli.prs`) adds `specLines` and `live` from the facts cache to the board rows and sorts them by `FR:pr-review-lane/sort.order`. Each line: `<specLines> <url>[ 🔬] - <title>` (🔬 marks `live`). Another `--sort` exits `2`
- **FR:sort.api** (P1): `GET /pr-review` (route `prReview.get`, scope `tasks:read`) returns `{facts, briefs}` from the caches only, with no GitHub call. Each fact has the field `specLines`. The PR page reads `specLines` from here for its sort option

### FR:flag: Live-validation flag

The lane needs a fixed rule so that it picks the PRs that need a running app.

- **FR:flag.rule** (P1): `needsLiveValidation({labels, body, paths})` is pure and returns `{live, reasons}`. `live` is true when any of these match. A label matches `needs validation` or `live validation` (no case). The body says `live validation` or `validate live` (no case). A path starts with `infra/` or `deploy/`, or has a folder named `deploy` or `deployment`, or is a workflow file whose name has `deploy`. `reasons` names each match, for example `label: Needs Validation`

### FR:brief: Autopilot brief

The owner needs a short, current brief on an Autopilot PR that waits on him so that he decides in one read.

- **FR:brief.model** (P1): `<home>/pr-briefs.json` is `{version: 1, items}`. Each item is `{repo, number, url, problem, solution, recommendation, evidence, askedAt, headSha, by?}`. `problem`, `solution` and `recommendation` are one line each, 1-600 characters. `evidence` has 1-5 `https` links. `headSha` is 7-40 hex characters. `askedAt` is an ISO time (default: now). One brief per PR: a new brief replaces the prior one. Writes go through a temp file and a rename under `<home>/pr-briefs.lock`
- **FR:brief.lint** (P1): `lintBrief(b)` is pure. It fails when `problem`, `solution` and `recommendation` together have more than 120 words. It also fails a sentence of more than 20 words (STE). Links in `evidence` do not count. A failed lint stores nothing and lists each issue
- **FR:brief.stale** (P1): A brief is `stale` when the PR head SHA that Stack knows (`FR:pr-review-lane/sort.cache`) is not the brief `headSha`. With no known head, `stale` is false
- **FR:brief.cli** (P1): Agents write: `stack pr-pri brief <ref> --file brief.json [--agent a]`. It prints `brief stored <ref> (<n> words)`. A bad ref, file, or lint exits `2` and prints each issue. `stack pr-pri brief <ref> [--refresh] [--json]` prints the brief, with `[stale]` when stale. `--refresh` reads the head SHA first. A PR with no brief exits `1`. Stack makes no LLM call; agents write the text
- **FR:brief.api** (P1): `GET /pr-review` returns each brief with `stale`

### FR:lane: Live validation lane

The owner needs exactly one PR in live validation so that a ready PR always waits for him and an agent works on the next one.

- **FR:lane.model** (P1): `<home>/live-lane.json` is `{version: 1, rev, active?, done, lists}`. `active` is `{repo, number, url, title?, state, by?, claimedAt, worktree?, serverUrl?, port?, pid?, headSha?, waitingOnLock?}`. `state` is `preparing`, `working`, `ready-for-michael` or `revalidating`. The lane state is `idle` when there is no `active` PR. `done` keeps the newest 50 `{repo, number, url, at, reason}`. `lists` holds each PR checklist. At most one PR is active. Writes use `<home>/live-lane.lock`, a temp file and a rename, and increment `rev`
- **FR:lane.item** (P1): A checklist item is `{id, text, by, state, comment?, reason?, createdAt, updatedAt, updatedBy?}`. `id` is `li-` and 8 hex characters. `text` is one line, 1-300 characters. `by` (who added it) and `updatedBy` (who made the last change) are `owner` or an agent name. `state` is `open`, `passed`, `failed`, `needs-fix`, `fixed-pending-revalidation` or `blocked`. `reason` is required for `blocked`
- **FR:lane.config** (P1): `<home>/live.config.json` is `{lockPath?, portMin?, portMax?, reservedPorts?, exclude?}`. Defaults: `/tmp/fh-server.lock`, `5173`, `5182`, `[5180]`, `["#918"]`. An `exclude` entry is a ref or `#<n>` (any repo). An excluded PR never enters the lane. A missing or broken config uses the defaults. Choice: PR 918 is the owner's own session, so it stays out
- **FR:lane.pick** (P1): The next PR is the first queue item (`<home>/pr-priority.json`, rank order) that is not excluded, not done, and has `live` facts. `live next` reads missing facts, or facts older than 10 minutes, with `gh` (`FR:pr-review-lane/sort.cache`); `--offline` uses the cache only
- **FR:lane.next** (P1): `stack live next [<ref>] [--agent a] [--worktree p]` claims a PR for an agent. With an active PR, it changes nothing and returns it, except that it records the agent when `by` is empty. A `<ref>` that is not the active PR exits `3`. With no active PR, it takes `<ref>` or the next PR (`FR:pr-review-lane/lane.pick`) and sets `preparing`. With no PR to take, it prints `idle: no PR needs live validation` and exits `4`
- **FR:lane.lock** (P1): The server lock file is JSON `{owner, port, pid, wt, head}`, shared with the Sweep Manager. The lane owner name is `live:<owner>/<name>#<n>`. The lock is free when the file is absent, broken, held by the same owner, or its `pid` is not running (stale). Recording a server checks the lock first. A lock that another owner holds with a running pid refuses the server (exit `3`), and the PR keeps its state with `waitingOnLock` set to the holder. Otherwise Stack writes the lock with the lane fields. `live next` reports a held lock and does not take it
- **FR:lane.port** (P1): A server port must be in `portMin`-`portMax` and not in `reservedPorts`. Any other port exits `2`
- **FR:lane.ready** (P1): `stack live ready <ref> --url <u> --pid <n> [--port n] [--worktree p]` records the server (`--pid` is the server process, so a dead server frees the lock) (`FR:pr-review-lane/lane.lock`) and sets `ready-for-michael`, or `revalidating` when an item is `fixed-pending-revalidation`. `--url` is an `http` or `https` url; `--port` defaults to the url port. The ref must be the active PR, else exit `1`
- **FR:lane.state** (P1): `stack live state <ref> preparing|working` sets the agent state of the active PR. The panel shows `working` while the agent fixes items
- **FR:lane.checklist** (P1): `stack live checklist <ref> --file items.json [--agent a]` seeds items from `[{text}]` or `{items: [{text}]}` (1-50). An item whose text is already in the list (no case) is skipped. New items are `open` and `by` the agent
- **FR:lane.items** (P1): `stack live item <op> <ref> [<id>] [--text t] [--reason r] [--by b]` changes one item. `add` (`--text`) adds an `open` item; `check` sets `passed`; `uncheck` sets `open`; `fail` sets `failed`; `needs-fix` sets `needs-fix` (`--text` sets the comment); `fixed` sets `fixed-pending-revalidation`; `block` (`--reason`) sets `blocked`; `comment` (`--text`) sets the comment; `edit` (`--text`) sets the text. `--by` is `owner` or an agent name (default `owner`). An unknown id exits `1`. The same change twice changes nothing
- **FR:lane.resolve** (P1): `stack live resolve <ref> [--reason merged|closed|done]` moves the PR to `done`, frees the lock when the lane holds it, and at once makes the next PR (`FR:pr-review-lane/lane.pick`) active as `preparing` with no agent. It prints `done <url>` and `next <url>` or `next: none (idle)`. So the lane always has one live PR when one exists
- **FR:lane.show** (P1): `stack live [--json]` prints the active PR, its state, server url, and item counts by state, or `idle`
- **FR:lane.needs** (P1): Each `blocked` item of the active PR is in `GET /needs-you` as `{id: "lv.<item id>", title: "Live check blocked: <text>", recommendation: <reason>, link: <PR url>}`. `POST /needs-you/lv.<id>/answer` with `go` or `reply` reopens the item, with the reply text as its comment. An item that is no longer `blocked` does not change, and the answer returns `changed` false
- **FR:lane.api** (P1): `GET /live` (route `live.get`, scope `tasks:read`) returns `{state, active?, items, done}`. `POST /live/items` (route `live.item`, scope `tasks:write`) takes `{op, repo, number, id?, text?, reason?}` with the ops of `FR:pr-review-lane/lane.items`. An owner session call is `by: owner`; any other caller is `by: <token name>`. A host with no lane store returns `404`
- **FR:lane.guard** (P1): No `stack live` command and no lane route reads or writes a GitHub thread, label, or review. The only GitHub calls are the reads in `FR:pr-review-lane/sort.cache`

### FR:contract: Agent contract

The live agent needs one short contract so that it works the lane with no report noise and never crosses an owner hold.

- **FR:contract.doc** (P1): `docs/live-validation-agent.md` (at most 50 lines) gives the loop: claim with `live next`; start the server in a worktree for that PR with the repo launch config, inside the port range; seed the checklist from the PR spec and acceptance; `live ready`; on `needs-fix` items, set `working`, fix, flip each to `fixed`, then `live ready`. It sends no report when done. It sends a report only when it did not do what was asked, as a `blocked` item with a reason
- **FR:contract.guard** (P1): The doc says: never resolve, reply to, or edit a review thread on which the owner wrote a hold (`hold`, `wait for my ack`); never apply the Autopilot label; call `stack pr-pri ack` only with the owner's own ack record; never merge; never take a lock that another owner holds

### FR:panel: Checklist panel

The owner needs to tap through the checks on his phone so that live validation takes minutes.

- **FR:panel.view** (P1): `#/live` shows the panel in place of the app shell. It shows the active PR (title link, `repo#n`) (the title comes from the facts cache), an `Open app` link to the server url, the state chip, and the items. With no active PR it says `No PR in live validation.`
- **FR:panel.chip** (P1): The state chip shows `Preparing`, `Agent working`, `Ready for you`, or `Recheck` (`revalidating`)
- **FR:panel.check** (P1): A tap on an item check toggles `passed` and `open`. The item shows its state as text and the author (`by`)
- **FR:panel.comment** (P1): A long press on an item, or its `Comment` button, opens a comment box. Save sends `comment`
- **FR:panel.fix** (P1): `Needs fix` on an item sends `needs-fix` with the comment box text
- **FR:panel.add** (P1): An add box at the end adds an item as the owner
- **FR:panel.refresh** (P2): The panel reloads `/live` after each action and every 15 s while visible
- **FR:panel.a11y** (P1): Axe finds no violation at 375 px and 1280 px. Every target is at least 44 px tall on touch. No sideways scroll

## Follow-up: lane controller (not in this feature)

A host controller will later run the loop for the agent: on `resolve`, start the Sweep Manager's live agent for the next PR, and stop the old server. It will reuse `FR:pr-review-lane/lane.lock` and `FR:pr-review-lane/lane.port`. This feature only stores state; the agent or the Sweep Manager starts servers and agents.

## Integration with in-flight features

- `pr-priority`: its `pr-pri` command sends `brief` to `briefCmd` in `src/cli/pr-review.ts`.
- `pr-page`: its `prs` command sends `--sort spec-lines` to `specSort` in `src/cli/pr-review.ts`.

## Data Model

- **PR facts**: `<home>/pr-facts.json`, see `FR:pr-review-lane/sort.cache`
- **Brief**: `<home>/pr-briefs.json`, see `FR:pr-review-lane/brief.model`
- **Lane**: `<home>/live-lane.json`, see `FR:pr-review-lane/lane.model`; checklist item, see `FR:pr-review-lane/lane.item`
- **Lane config**: `<home>/live.config.json`, see `FR:pr-review-lane/lane.config`

## Architecture Constraints

- Live state is under Home, never in the content repo or git
- No LLM call. No GitHub write. No server or agent start
- Pure rules (`specLines`, `sortBySpecLines`, `needsLiveValidation`, `lintBrief`, `isStale`) have no I/O

## Dependencies

- pr-priority (the queue file, read-only), pr-page (sort consumer), status-ingest (Home, lock rules), ask-queue (Needs you), api, auth-security (scope table), cli (exit codes), web-shell (hash routes)

## External Dependencies

- GitHub CLI (`gh`): PR, PR files, and search reads only
- The shared server lock file (default `/tmp/fh-server.lock`), also written by the Sweep Manager
