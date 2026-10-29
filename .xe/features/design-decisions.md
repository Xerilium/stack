# Design Decisions: Stack

## Keep tasks as markdown in a private GitHub repo

**Decision**: Markdown files in a private GitHub repo are the source of truth, behind a storage interface.

**Date**: 2026-10-22

**Why**: Markdown stays editable by hand and by agents, and history is the audit trail. The interface leaves room for a database adapter later.

**Rejected**: Database-first (loses editability); GitHub Pages (private Pages is paid, public leaks).

## Host on Azure Static Web Apps free tier with managed Functions

**Decision**: Azure Static Web Apps free tier plus managed Functions, secrets in app settings.

**Date**: 2026-10-22

**Why**: Runs at $0 and fits the free-tier requirement.

**Rejected**: Key Vault (not free); Cloudflare (owner preference).

## Allow-list the owner and use hashed, scoped, revocable API tokens

**Decision**: SWA built-in auth allow-listed to the owner. API tokens are hashed, scoped, and revocable. Single-user in v1.

**Date**: 2026-10-22

**Why**: One owner needs deny-by-default access, not account management.

**Rejected**: Multi-user in v1.

## Support pluggable formatters with the legacy emoji-markdown format as default

**Decision**: Formatters are pluggable. Emoji-markdown (lossless, legacy) and a clean format both ship. Date format `Mon D[, YYYY]` stays in the emoji formatter; internal dates are ISO.

**Date**: 2026-10-22

**Why**: Existing task files must round-trip byte-exact, so the legacy format cannot change.

**Rejected**: Replacing the legacy format.

## Parse both recurring forms and shift weekend due dates to Monday

**Decision**: Canonical form is `📅 date: 🔄 Cadence:`; legacy `🔄 Weekly: 📅 Mondays:` is also parsed; weekday names work. Weekend due dates shift to Monday (config, default on) and the nominal day is kept so rolls do not drift. Rolled rows reset subtasks, monthly clamps to month end, and `Quarterly-EOM+1` is a token. `complete` rolls the row in place.

**Date**: 2026-10-22

**Why**: Matches legacy behavior and prevents date drift across rolls.

**Rejected**: Dropping the legacy form; letting the due date follow the shifted day (drifts).

## Keep scoring pluggable with the legacy formula as default

**Decision**: Pluggable scoring engine, legacy formula by default, verified by golden outputs from legacy. Any redesign goes through a separate bake-off.

**Date**: 2026-10-22

**Why**: Replacing scoring without parity proof risks silent behavior change.

**Rejected**: Replacing the formula without parity proof.

## Read config from legacy `.xe/config/stack.json`

**Decision**: JSON config at the legacy path with baked-in defaults.

**Date**: 2026-10-22

**Why**: Existing setups keep working with no migration.

**Rejected**: A new config location or format.

## Commit edits directly with no PRs

**Decision**: Task edits are direct commits to the repo.

**Date**: 2026-10-22

**Why**: Edits land in seconds and git history is the audit trail.

**Rejected**: PR workflow for task edits (too slow for capture).

## Scope phase 1 to the full product

**Decision**: Phase 1 covers the full product, not only a POC.

**Date**: 2026-10-22

**Why**: The rebuild only replaces legacy once every surface exists.

**Rejected**: A narrow POC first.

## Use pnpm as the package manager

**Decision**: pnpm for installs and scripts (`pnpm run`).

**Date**: 2026-10-22

**Why**: Matches the Catalyst toolchain and gives strict, fast installs.

**Rejected**: npm.

## Build with Catalyst

**Decision**: Stack is built using Catalyst (specs, rollouts, and agent playbooks).

**Date**: 2026-10-22

**Why**: Spec-first, traceable delivery fits the product's own agent-driven model.

**Rejected**: Ad hoc development without specs.

## Plan Stack as a future feature of Xe Prime, not built yet

**Decision**: Long term, Stack becomes a feature on top of Xe Prime. Nothing for Xe Prime is built now.

**Date**: 2026-10-22

**Why**: Stack must ship standalone first; the integration is planned for the Enterprise phase.

**Rejected**: Building on Xe Prime now (not available).

## Agents never block on a human

**Decision**: Agents proceed on their own judgment, record decisions, and never wait on approval. They never merge or deploy. Humans review asynchronously at the PR.

**Date**: 2026-10-22

**Why**: Waiting on a person stalls the stack the product exists to keep moving.

**Rejected**: Human approval gates before implementation.

## CLI refs are 1-based and no-ops exit 0

**Decision**: CLI task refs are `tasks/<file>.md:<line>` (1-based). No-ops exit 0; only "no task to act on" exits 4. Summary files are allowed storage paths beside `tasks/*.md`.

**Date**: 2026-10-22

**Why**: Matches editors and grep output; scripts should not fail on idempotent calls.

**Rejected**: 0-based refs (error-prone); non-zero exit for no-ops.

## Build the web app with Preact and Vite under web/

**Decision**: Static SPA in `web/` (Preact, Vite, vitest, Playwright), its own package and tsconfig. Data comes from `/api` after sign-in; nothing task-related is in the bundle. Two additive api routes (`tasks.edit`, `tasks.move`) fill the gaps for inline edit and reorder. Bulk edit is client-side, one call per row.

**Date**: 2026-10-22

**Why**: The UI has many stateful views; Preact adds about 4 KB and keeps the footprint small. A strict CSP (no inline script) ships with the SWA config.

**Rejected**: Vanilla TS (more glue for the same views); a bulk api route (YAGNI, per-row results are clearer).

## Replies go to a per-project inbox file, not the task file

**Decision**: Today replies and decisions append to `tasks/inbox/<project>.md` (format in `.xe/features/agent-inbox/spec.md`). Only the owner session can write it; agents read it (file or `GET /inbox`) and mark entries handled.

**Date**: 2026-10-28

**Why**: Child `💬` rows mixed conversation into the task list, moved with line edits, and had no handled state. A separate append-only file is durable, diffable in git, and gives agents a clear queue without touching task order.

**Rejected**: `💬` child rows (clutter, no ack); pushing into a live chat session (not durable, needs a runner).

## Agent activity comes from artifacts

**Decision**: `GET /agents` derives state from agent rows, result logs, inbox entries, and GitHub PR state and checks (when `GITHUB_TOKEN` is set). Never from chat transcripts.

**Date**: 2026-10-28

**Why**: Artifacts are the truth an owner can verify; chat says what an agent intended, not what it shipped.

**Rejected**: Reading session transcripts (private, unstructured, not in the task repo).

## Plan to a daily budget; warn only for at-risk misses

**Decision**: The owner sets available time per day (browser storage, resets daily). Tasks are packed to that budget; only tasks due today, late by 30 days or less, or in progress raise a warning when they miss.

**Date**: 2026-10-28

**Why**: With ~900 open tasks, "268 don't fit" is true and useless. The question is whether anything that matters today misses.

**Rejected**: Showing every left-out task as a warning; a server-side setting (one more write path for a per-day convenience).

## Asks are files; the page is the only interface

**Decision**: Agents bring the owner decisions as one file per ask (`tasks/asks/<key>.md`). Stack ranks them with a deterministic score, pushes changes to the page over server-sent events, and writes the owner's answer back into the same file. The owner answers there instead of in chat. Stack never parses CoS state files and never applies a default itself.

**Date**: 2026-10-28

**Why**: Chat overwhelms the owner; files are durable, agent-agnostic, and reviewable, and any CoS can resume from them. Parsing prose state files would guess; applying defaults needs the owning agent's knowledge.

**Rejected**: A status feed (the overload to remove); WebSocket (SSE is simpler and one-way); agent-set scores (inconsistent); parsing `.stack/*-state.md`.

## Meetings take time; the plan packs first-fit around them

**Decision**: Calendar events come through a read-only `CalendarProvider` (Graph `calendarView` behind its own allowlist, or fixtures). Busy time lowers the default Available and blocks the timeline; tasks go to the first gap that holds them, inside the work day unless the budget asks for more. Email asks reserve one block first in the day.

**Date**: 2026-10-28

**Why**: A plan that ignores meetings books hours that do not exist. First fit uses the gap before a meeting for a short task instead of wasting it; capping at the work day keeps unusable gaps from pushing work into the evening.

**Rejected**: IMAP (app passwords and a client library for a Microsoft 365 mailbox Graph already covers); splitting a task across a meeting (context switching); a server-side plan (the budget and clock are per viewer).

## Graph sign-in is a device code flow with a local token file

**Decision**: The owner signs in once with `stack graph login` (device code, public client, no secret). Scopes come from an allowlist per feature (`Calendars.Read`, `Mail.Read`, and `Mail.ReadWrite` for drafts, which is not read-only; the email guard limits writes to reply drafts) plus sign-in basics; every other scope, requested or granted, is refused in code. The refresh token lives in `~/.config/stack/graph-token.json` (0600), never in a task repo.

**Date**: 2026-10-29

**Why**: A terminal flow needs no redirect URI or secret, works on any machine, and keeps the token off GitHub and Azure. Refusing unsafe scopes in code means a bad app registration still cannot send mail.

**Rejected**: Auth code with a localhost redirect (more moving parts, same result); storing the token in the task repo or Azure (it would leave the owner's machine); a confidential client (a secret to manage for one user).
