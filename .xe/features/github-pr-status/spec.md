---
id: github-pr-status
title: GitHub Pull Request Status
author: flanakin
description: "Pull request state and check results from the GitHub REST API, limited to an allow-list of repos."
dependencies: []
---

<!-- markdownlint-disable single-title -->

# Feature: GitHub Pull Request Status

## Purpose

Give other features the current state and check result of a GitHub pull request without exposing the token or reading pull requests the owner did not allow.

## Scenarios

### FR:status: Read pull request status

Stack needs to read a pull request's state and checks so that features can show where agent work stands.

- **FR:status.@function** (P1): Interface: `createGitHubPrs({token, fetch?, ttlMs?, repos?})` returns a provider that takes pull request references
- **FR:status.input** (P1):
  - Pull request references (`{repo, number}[]`) — `repo` is `owner/repo`
  - Token (string) — GitHub token
- **FR:status.fetch** (P1): The provider MUST read `GET /repos/{o}/{r}/pulls/{n}` and `GET /repos/{o}/{r}/commits/{sha}/check-runs` for each pull request
  - **FR:status.fetch.limit** (P1): The provider MUST keep at most 6 requests in flight
  - **FR:status.fetch.cache** (P2): The provider MUST cache results for `ttlMs` (default 60 s)
- **FR:status.checks** (P1): The provider MUST report `failing` for any failure, cancel, or timeout conclusion; else `pending` for any run not completed; else `none` for no runs; else `passing`
- **FR:status.failure** (P1): The provider MUST leave a pull request without status when GitHub fails; other pull requests still get theirs
- **FR:status.output** (P1): Status per pull request (@req FR:$pr-status)

### FR:repos: Limit which repos are read

The owner needs to limit status to named repos so that a token cannot read a private pull request just because a row links to it.

- **FR:repos.@env** (P1): Interface: `STACK_GITHUB_REPOS`, a comma list of `owner` or `owner/repo` (case-insensitive), passed as `repos`
- **FR:repos.allow** (P1): When `repos` is set, the provider MUST NOT ask GitHub about pull requests in other repos, and those get no status
- **FR:repos.unset** (P1): When `repos` is unset or blank, the provider MUST look up every repo
- **FR:repos.invalid** (P1): The host MUST turn pull request status off and log `STACK_GITHUB_REPOS` with a reason that omits the value when an entry is not `owner` or `owner/repo`

### FR:wire: Host wiring

The owner needs the hosts to enable status from one setting so that no extra setup is needed.

- **FR:wire.token** (P2): The Azure host and `stack web` MUST pass the provider when `GITHUB_TOKEN` is set
  - **FR:wire.token.scope** (P1): The host MUST keep the token out of logs and responses and send it only to `https://api.github.com`

### FR:board: Read the owner's PR board

The PR page needs every open PR the owner reviews or moves, with enough detail to group it, so that it can show who must act in few calls.

- **FR:board.@function** (P1): Interface: `createGitHubBoard({token, fetch?, user?, repos?, now?})` returns `{user(), fetch()}`. `fetch()` returns raw PR facts for `FR:pr-page/group.*`
- **FR:board.search** (P1): One GraphQL call runs three searches (`is:pr is:open archived:false`): `involves:<user>`, `review-requested:<user>`, and, for my repos, `draft:false -author:<user>` with `repo:`/`user:` from `repos` (else `user:<user>`). 50 PRs each, merged by url. Each PR has labels, author, assignees, review requests, latest reviews, mergeable, head oid, body, check rollup with each check's name, state and start time
- **FR:board.detail** (P1): A second GraphQL call reads, for up to 10 PRs per call, the review threads (node id, resolved, file path, root comment id, and the last 10 comments with author, body, url, and time), the last 10 comments (author, body, url, time), the last 10 commits (oid, headline, url, time), the changed files (first 100: path, additions, deletions), my pending review (url, body, first 20 comments with path and body), and which checks are required (`isRequired`). It is cached per PR by `updatedAt`, head oid, and rollup state, and read again after 5 minutes
- **FR:board.user** (P1): Without `user`, each poll reads `GET /user` with `If-None-Match` and the last ETag. A `304` (free against the rate limit) keeps the cached login
- **FR:board.etag** (P1): Choice: GraphQL is a POST and has no ETag, and REST cannot read thread resolution. One poll costs about 10 points of 5000 an hour, so polls every 45 s use under 20%. ETags apply to the REST calls (`board.user`)
- **FR:board.rate** (P1): The result carries `rate: {remaining, resetAt}` from GraphQL `rateLimit`. A rate-limit answer throws `GitHubRateLimit` with the reset time
- **FR:board.scopes** (P1): Read needs a fine-grained token with Pull requests, Issues, Checks, Commit statuses, and Metadata read (or a classic `repo` token)

### FR:write: Owner writes

The PR page needs a few writes so that the owner can unblock a PR with one tap.

- **FR:write.@function** (P1): Interface: `createGitHubWrites({token, fetch?, repos?})` returns `addLabel`, `removeLabel`, `comment`, `reply`, `resolveThread`. This is the only module that writes to GitHub for the PR page
- **FR:write.label** (P1): `addLabel` and `removeLabel` accept only the Autopilot label (`Status: 🤖 Autopilot`, matched without case or emoji variation selectors; add uses the repo's own spelling from `GET /repos/{o}/{r}/labels`, read once per repo; remove uses the name as the PR carries it). They call `POST /repos/{o}/{r}/issues/{n}/labels` and `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}`
- **FR:write.comment** (P1): `comment` calls `POST /repos/{o}/{r}/issues/{n}/comments`; `reply` calls `POST /repos/{o}/{r}/pulls/{n}/comments/{id}/replies`, where `id` is the thread's first comment (GitHub does not take replies to replies). The body must start with `🤖 [AI] ` and be at most 4000 characters
- **FR:write.resolve** (P1): `resolveThread(pr, threadId, resolve)` runs the GraphQL mutation `resolveReviewThread` or `unresolveReviewThread` with the thread node id. The id must match `^[A-Za-z0-9_=-]{1,100}$`. The repo check is the same as the other writes
- **FR:write.never** (P1): No write merges, closes, un-drafts, approves, or reviews a PR. There is no other method
- **FR:write.errors** (P1): A failed write throws `GitHub <status>` with no body text and no token
- **FR:write.scopes** (P1): Writes need Pull requests write (thread replies, resolve) and Issues write (labels, PR comments)

## Data Model

- **FR:$pr-status** (P1): **`PrStatus`** — State and checks of one pull request.
  - `state` (string) — Allowed: open, draft, merged, closed
  - `checks` (string) — Allowed: passing, failing, pending, none
  - `title` (string)
  - `updatedAt` (string) — ISO timestamp

## Architecture Constraints

None

## External Dependencies

GitHub REST API (`https://api.github.com`)
