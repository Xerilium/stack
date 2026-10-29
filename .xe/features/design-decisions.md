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

## Drive agents through the Claude Agent SDK behind an ACP-shaped driver

**Decision**: Stack talks to agents through one `AgentDriver` interface that uses the Agent Client Protocol's vocabulary (sessions, prompt, streamed updates, `request_permission` with `allow_once` / `allow_always` / `reject_once` options). The first driver is the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), loaded lazily, and only in `stack web` on the owner's machine. Files stay the contract for decisions: a permission prompt is written as an ask and answered on the home view. MCP stays what it is: the agents' door into Stack.

**Date**: 2026-10-29

**Why** (compared with cited evidence):

| Option | What it gives | Why not alone |
| --- | --- | --- |
| **Claude Agent SDK** (`0.3.312`): [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) | `listSessions` / `getSessionMessages` read the same `~/.claude/projects/<cwd>/*.jsonl` that Claude Desktop writes (verified locally: transcripts carry `entrypoint: claude-desktop`, `custom-title`, `pr-link`, and a `cost-state` record with `totalCostUSD` and `modelUsage`), so the dashboard sees his real sessions, not only ones Stack started. `query({resume, canUseTool, includePartialMessages, maxBudgetUsd, abortController})` gives resume, streaming, permission interception, cost, and cancel in one call. | Vendor-specific; bundles a 263 MB native binary (optional dependency, never loaded on the Azure host); resuming a transcript another client is writing is unsafe, so active sessions are refused (`FR:driver.active`). |
| **ACP** ([protocol overview](https://agentclientprotocol.com/protocol/v2/overview.md), [tool calls and permissions](https://agentclientprotocol.com/protocol/v2/tool-calls.md)) | An open standard (Zed, Aug 2025): JSON-RPC over stdio, agent as a subprocess, `session/new` / `session/resume` / `session/list` (capability-gated), `session/prompt`, `session/update` notifications, `session/request_permission` with option kinds. Official SDKs. The Claude Code adapter `@zed-industries/claude-code-acp` (`0.16.2`) wraps the Claude Agent SDK. | For Claude it is a second process wrapping the SDK we can call directly, with no access to Desktop's session list beyond what the adapter chooses to expose. Its shape is right, so the driver interface copies it and an `AcpDriver` can be added for other agents without touching the API or the web app. |
| **MCP** (Stack's own server, `FR:mcp-server/*`) | Agents call Stack tools (tasks, asks). | It is agent → Stack. It cannot list the owner's sessions, stream an agent's output to the page, or surface a permission prompt. Keep it for what it does. |
| **Files** (ask queue, `FR:ask-queue/*`) | Durable, agent-agnostic, survives any session; already the owner's answer path. | Cannot stream or cancel, and cannot see a session the agent did not write about. Keep it as the decision contract: permission prompts become asks so one home view still answers everything. |

**Rejected**: ACP-first (an extra subprocess and adapter for no new capability today); reading `~/.claude/projects` ourselves (the SDK already parses the store and tracks its format); a WebSocket for the run stream (SSE is one-way and already in `stack web`); letting the dashboard append to a session that Claude Desktop is still writing.

**Risks noted**: the SDK's bundled CLI uses the machine's Claude login (`apiKeySource` in the init message says which); session resume from a different cwd is supported from CLI 2.1.223 (the SDK bundles 2.1.312); the store format is Claude Code's and may change, so every read is tolerant and tested against a fixture.
