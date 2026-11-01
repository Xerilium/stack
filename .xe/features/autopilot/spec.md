---
id: autopilot
title: Autopilot PR lifecycle
author: flanakin
description: A GitHub workflow that squash-merges a pull request on its own once the owner opted it in and every gate holds, with the gates re-checked against the current head commit
dependencies: [deploy-docs]
---

<!-- markdownlint-disable single-title -->

# Feature: Autopilot PR lifecycle

## Purpose

The owner marks a pull request `Status: 🤖 Autopilot` and walks away. An agent drives it to done and certifies it `Status: ☑️ Finalized`; the workflow merges it only while every gate still holds on the commit that would land. A new commit, an unresolved thread, a red check, or a pause stops the merge. Same design as the finops-hubs PR lifecycle, cut down to what a one-owner repo needs.

## Scope

- In: the labels, the reconcile workflow, the certification comment, the squash merge, the deploy hand-off after it.
- Out: the agent that certifies (it only posts the comment and adds the label), reviewer and assignee routing, Needs labels, release gates, branch protection (the repo has none; these gates replace it).

## Scenarios

### FR:labels: Labels

Stack System needs a fixed set of PR labels so that the owner and agents share one vocabulary and the workflow never guesses.

- **FR:labels.set** (P1): The repo MUST have `Status: 🤖 Autopilot`, `Status: ✅ Ready`, `Status: ☑️ Finalized`, `Status: ⏸️ Paused`, `Status: 🚧 WIP`, and `Status: ⛔ Blocked`, with the colors and descriptions in `AUTOPILOT_LABELS` (`.github/scripts/autopilot-core.cjs`)
  - **FR:labels.ensure** (P1): The workflow MUST create any of them that is missing before it adds one, and MUST NOT edit one that exists
- **FR:labels.owners** (P1): Inputs are set by people or agents: Autopilot, Finalized, Paused, WIP, Blocked. Ready is set and cleared only by the workflow
  - **FR:labels.owners.optin** (P1): Applying Autopilot is the owner's standing authorization; it takes write access to the repo

### FR:ready: Ready

- **FR:ready.derive** (P1): The workflow MUST add `Ready` when the PR is not a draft, has no review in `CHANGES_REQUESTED`, and is approved, and MUST remove it otherwise
  - **FR:ready.derive.approved** (P1): Approved means the PR carries Autopilot (the owner's sign-off), or a person other than the author, not a bot, has a current `APPROVED` review
  - **FR:ready.derive.latest** (P1): Only each reviewer's latest review counts
- **FR:ready.paused** (P1): A PR labeled Paused MUST be left alone: no label change, no merge

### FR:cert: Finalized certification

The agent certifies one commit, so that a push after certification cannot ride the old certification into main.

- **FR:cert.comment** (P1): The certification is one PR comment whose first line is `<!-- stack:finalized-head-sha -->` and which holds ``head SHA `<40 hex>` ``
- **FR:cert.match** (P1): A certification holds only when some comment on the PR, from an owner, member, or collaborator, certifies exactly the current head SHA; comment order and count do not matter
  - **FR:cert.match.order** (P2): The agent MUST post the comment before it adds Finalized, because a Finalized with no matching comment is removed
  - **FR:cert.match.missing** (P1): No comment, an unparseable one, or a failed comment read MUST count as not certified
- **FR:cert.stale** (P1): When Finalized is on a PR whose current head SHA is not certified, the workflow MUST remove Finalized
  - **FR:cert.stale.push** (P1): A push therefore clears Finalized, and the agent re-certifies the new head to re-arm the merge

### FR:gates: Merge gates

- **FR:gates.all** (P1): The workflow MUST squash-merge a PR only when every gate holds, and MUST say which gate blocked otherwise
  - **FR:gates.all.labels** (P1): Autopilot, Ready, and Finalized are present; Paused, WIP, and Blocked are absent
  - **FR:gates.all.cert** (P1): The Finalized certification matches the current head SHA (@req FR:cert.match)
  - **FR:gates.all.threads** (P1): Every review thread is resolved. A thread list that cannot be fully read blocks
  - **FR:gates.all.checks** (P1): At least one check ran on the head commit and every check and status on it has finished green (`success`, `neutral`, `skipped`). Pending, missing, or unreadable blocks
  - **FR:gates.all.clean** (P1): GitHub reports `mergeStateStatus` `CLEAN`, read fresh just before the merge
- **FR:gates.pin** (P1): The merge call MUST pin the head SHA it checked, so a commit pushed after the check fails the merge instead of landing
- **FR:gates.retry** (P1): `UNKNOWN` merge state and transient merge errors (`405` not mergeable yet, `5xx`, rate limit) MUST be retried up to 5 times, 4 seconds apart; other errors end the attempt with the error recorded
- **FR:gates.closed** (P1): A PR that is not open, or merged while the workflow ran, MUST end without error

### FR:triggers: Triggers

- **FR:triggers.events** (P1): The workflow MUST reconcile one PR on `pull_request_target` (opened, reopened, ready for review, converted to draft, synchronize, and labels in the set), `issue_comment` that is a certification comment on a PR, and `workflow_run` completion of CI and E2E
- **FR:triggers.sweep** (P1): It MUST also reconcile every open PR labeled Autopilot every 10 minutes and on manual dispatch, because resolving a thread and approving a review start no workflow
- **FR:triggers.serial** (P1): Runs for one PR MUST be serialized and never cancelled mid-merge
- **FR:triggers.labels** (P2): A label event for a label outside the set MUST end the run before any API call, so unrelated label changes cost almost nothing
- **FR:triggers.self** (P2): The workflow's own label writes use `GITHUB_TOKEN` and so start no further run

### FR:safety: Safety

- **FR:safety.base** (P1): The workflow MUST run the default branch's workflow file and module (`pull_request_target`), check out only the default branch, and never run code from a PR
- **FR:safety.forks** (P1): PRs from forks MUST be ignored
- **FR:safety.perms** (P1): Top-level permissions stay `contents: read`; the reconcile job alone adds `contents: write`, `pull-requests: write`, `issues: write`, `actions: write`
- **FR:safety.pinned** (P1): Every action is pinned to a commit SHA
- **FR:safety.noleak** (P1): The job log and summary MUST NOT print tokens, comment bodies, or thread text; only label names, counts, SHAs, and gate names

### FR:deploy: Deploy after merge

- **FR:deploy.dispatch** (P1): Pushes made with `GITHUB_TOKEN` start no `push` workflow, so after a merge the workflow MUST dispatch `deploy.yml` on `main` with `workflow_dispatch`
  - **FR:deploy.dispatch.fail** (P2): A failed dispatch is logged and does not fail the run; the merge already happened

## Rationale

- **Certification by SHA, not by label.** A label cannot tell whether a push came after it. A comment naming the commit can; the merge compares it to the live head and the merge call pins that head.
- **Ready is derived.** One writer keeps the label an honest output. Autopilot counts as the sign-off because the owner usually authors the PR, and GitHub does not let an author approve it.
- **Gates computed here, not in branch protection.** The repo has none. Reading the check rollup directly means the gates hold without admin settings and read the same on every PR.
- **Sweep.** Thread resolution and review approval fire no workflow event. A 10-minute sweep over Autopilot PRs closes that gap at the cost of one small API read per such PR.
- **Pure module.** Decisions live in `.github/scripts/autopilot-core.cjs` with no network, so tests cover every gate. The workflow only fetches state and applies the result.
