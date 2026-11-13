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

**Amended 2026-10-29 (measured)**: the SDK's `listSessions` parsed every transcript on each call: 70 s for this machine's 7,003 sessions (6.2 GB). The list is therefore built by Stack's own store index (`src/agents/store.ts`: stat scan, head and tail samples, a usage line scan, cached by size and mtime; first call about 2 s for the newest 200, then incremental). The SDK still owns transcripts (`getSessionMessages`) and runs (`query`). Cost is the CLI's `cost-state` record plus list-priced usage after it, because `cost-state` is written only at some turns and is missing from many transcripts.

**Rejected**: ACP-first (an extra subprocess and adapter for no new capability today); a WebSocket for the run stream (SSE is one-way and already in `stack web`); letting the dashboard append to a session that Claude Desktop is still writing.

**Risks noted**: the SDK's bundled CLI uses the machine's Claude login (`apiKeySource` in the init message says which); session resume from a different cwd is supported from CLI 2.1.223 (the SDK bundles 2.1.312); the store format is Claude Code's and may change, so every read is tolerant and tested against a fixture.

## Log the iPhone in with a per-device token; push with Web Push

**Decision**: Each phone gets its own scoped, revocable API token and a device record (`iphone-access`). Push uses Web Push (VAPID) through the installed PWA. Passkeys, a native shell and a Cloudflare tunnel wait.

**Date**: 2026-11-05

**Why**: Tokens are already hashed, scoped, expiring and tested, so a device login adds no dependency. Web Push on a Home Screen app is free and supported from iOS 16.4 ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). Details and sources: [research](iphone-access/research.md).

**Rejected**: Passkeys first (new dependency; unconfirmed in the installed iOS app); Cloudflare Tunnel (public hostname, more accounts); native SwiftUI (second UI, $99/yr, no need yet).

## Add an ACP stdio driver beside the SDK driver

**Decision**: `createAcpDriver` (`src/agents/acp.ts`) drives any ACP agent (Gemini CLI, Codex, Copilot) over stdio. Claude stays on the Agent SDK driver. `stack agent run <command> --prompt` is the first caller; the API's `ApiDeps.agents` wiring is next.

**Date**: 2026-11-05

**Why**: `.xe/features/stack-app/research-architecture.md` (Smallest first slice). ACP's only defined transport is stdio, so the Stack host must be the client that spawns the agent. The official SDK is `@agentclientprotocol/sdk` `2.4.0` (Apache-2.0), stable v1 entrypoint; v2 is a draft and stays off. The driver advertises no fs or terminal capability, so every risky tool call returns as `session/request_permission` and goes to the ask queue through the existing permission broker. A failure to answer never allows.

**Trade-offs**: The SDK is ESM-only and the repo is CommonJS: it loads through a native `import()` (the same trick as the Agent SDK driver), and Jest compiles the SDK's JavaScript to CommonJS in `jest.config.js` (tests only). The child gets an allow-list environment, so an agent's own login must live under `HOME` or in `env` passed to the driver. Session resume across processes (`session/load`) and cost (ACP v1 reports none) are not in this slice.

## Ship the Mac shell with Electron

**Decision**: The Mac app is an Electron shell (`desktop/`) that runs the Stack host (`startWeb`) in its main process, loads the web UI from a loopback port, and adds a tray icon, a global hotkey, and a single-instance lock. The iPhone stays on the PWA.

**Date**: 2026-11-10

**Why**: `.xe/features/stack-app/research-architecture.md`, section 2. The host must spawn ACP agents over stdio, so it needs a long-lived Node process on the Mac. Electron's main process is that Node process: one language, no sidecar, the `web/` UI as is. Tauri's size advantage is gone once the Agent SDK binary (263 MB) ships. The owner asked for a menu-bar icon and a hotkey, which is the gate in `FR:desktop-app/native.gate`.

**Trade-offs**: Electron adds ~100 MB and its own release cadence (pinned, bumped by renovate). Build scripts for `electron` stay blocked in pnpm so CI never downloads the binary; the smoke script downloads it on demand. Signing and notarization are human steps and wait for a later slice.

**Rejected**: Tauri (Rust toolchain, sidecar stdio plumbing for no size win); native Swift (second UI); PWA alone (cannot own the host process).

## Ship an unsigned Mac build with @electron/packager

**Decision**: `pnpm desktop:package` stages the built shell, installs production dependencies flat, runs `@electron/packager`, ad-hoc signs, and writes a `zip` and a `dmg`. Spec: `FR:desktop-app/package`.

**Date**: 2026-11-11

**Why**: The owner wants a real Mac app now without the $99/yr Apple account. Ad-hoc signing runs on Apple silicon. A build made on the same Mac opens with no prompt; a copied or downloaded build needs `Open Anyway` once (macOS 15+). Packager is one function call; the rest is macOS tools (`codesign`, `ditto`, `hdiutil`) with no extra dependencies.

**Trade-offs**: A copied build needs `Open Anyway` once (or `xattr -dr com.apple.quarantine`). No auto-update. `asar` is off so the host reads `web/dist` and spawns agent binaries from plain files.

**Rejected**: electron-builder (large dependency tree, pnpm workspace dependency collection, config surface for features not used); bundling with esbuild (the Agent SDK resolves its own binary by path).

## Make Now the one start screen; fold Brief into it

**Decision**: Now (`#/now`) is the start screen and the first tab. It shows one task, then the next 2 meetings and the top 3 asks. The Brief view is gone (`#/brief` opens Now). Home leaves the nav and stays at `g h` as `Top asks`. `GET /brief/summary` stays on the server.

**Date**: 2026-11-10

**Why**: `.xe/features/stack-app/ux-review.md`: four views (Now, Home, Brief, My day) showed the same task, and the phone tab bar could not reach Now. `design-principles.md` P1 (one thing). Spec: `.xe/features/ux-consolidation/spec.md`.

**Trade-offs**: The web AI summary section went with the Brief page (`FR:cos-view/brief.ai.web` deprecated). Keep, fold into Now, or remove the server route is an open owner call (`.xe/features/stack-app/architecture-review.md` #3).


## Now: honest calendar line, ask cards that expand, two columns on wide screens

**Decision**: `GET /calendar` reports a source status (`{kind, via, account, state, lastSyncAt}`). Now says `No meetings left today.` only when that source is `ok` and under 60 min old; otherwise it says what is wrong and offers Connect (paste a published ICS link, saved in the user config with mode `0600` through `POST /setup {connect: 'calendar'}`), the Graph sign-in command, and Check connection. `Waiting on you` rows are cards that expand in place with the full ask and every response, through the same `useAsks` calls as Needs you. At 1100 px and wider, Now uses two columns: the task and its message box on the left, `Next` and `Waiting on you` on the right.

**Date**: 2026-11-11

**Why**: The owner saw `No meetings left today.` with a meeting 10 minutes away: no calendar was connected, so the page lied. The ask rows had one button and no context, and the page left most of a desktop screen empty. Specs: `.xe/features/ux-consolidation/spec.md` (`FR:cal.*`, `FR:one.expand`), `.xe/features/now-screen/spec.md` (`FR:now.layout`, `FR:now.compose`).

**Trade-offs**: Connect reuses the first-run restart (the host restarts on the same port) instead of a hot swap of the calendar provider: one code path, a few seconds of wait. The source shape matches the inbox source status planned in `xe/inbox-connect` (`{kind, account, state, lastSyncAt}`) so the two can merge into one `sources[]` list later. Rejected: a right column below 1100 px (the task column gets too narrow beside the rail).
