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
  - **FR:wire.token.scope** (P1): The host MUST send the token only to `https://api.github.com` and MUST NOT log or return it

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
