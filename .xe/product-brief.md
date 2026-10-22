# Stack: product brief + acceptance criteria

Status: draft for sign-off. Source: Phase 1 interview with Michael Flanakin (2026-10-21).

## Goal
Rebuild Stack (legacy: `~/dev/todo`, PowerShell-driven, edited via PRs) as `xerilium/stack`: a task system reachable from anywhere, at $0 cost, with no PR workflow. Built for Michael first; shipped as Xerilium Stack if it works; long-term a feature of Xe Prime.

## Core jobs
1. Tell me what to do next (scored, time-aware, across projects).
2. AI works the stack: the task defines the autonomy level (triage/draft/execute; human checkpoint 🙋).
3. Capacity/planning per project and time block.
4. Fast capture; recurring tasks roll automatically.

## Users
Single user (Michael) in v1, secure by design. Multi-user is out of v1 but must not be blocked by the design.

## Architecture (approved, Azure variant)
- **Source of truth:** private GitHub repo of markdown (editable anywhere, git history = backup). Storage sits behind an interface; markdown/git is adapter #1, DB/API adapter later.
- **Core:** TypeScript library: parse, score, lifecycle, summaries. Pure and fully tested.
- **Formatters:** pluggable. v1 ships the emoji-markdown formatter (lossless round-trip, legacy files load) and a clean formatter (YAML-frontmatter/structured). Internal model is format-neutral; either can be written. The UI is the primary editor; text is never required.
- **Host:** Azure Static Web Apps (free tier): web app + managed Functions API (REST + MCP). Reads/writes the repo via GitHub API with direct commits (no PRs). Secrets in SWA app settings (Key Vault is not free). GitHub Pages rejected (private Pages is paid; public leaks).
- **Auth:** SWA built-in auth (GitHub/Entra) locked to one allow-listed identity for UI; scoped, revocable, hashed API tokens for CLI/agents/bots. Deny by default. The task list must never leak: no public routes, no secrets in client, no tokens in logs; threat model in `.xe/security.md`.
- **Surfaces v1:** web app (desktop keyboard-first + command palette; mobile touch-first with pickers and speech input), CLI, REST API, MCP server (token-efficient tool set), chat bots (iMessage/Slack) and webhooks/GitHub Actions hooks. Everything legacy does ("everything we have today") is in scope, including 🔎 GitHub query tasks and AI commands.

## UX bar
UI must be easier than editing text. Pickers/chips for metadata (no emoji lookup), better icons, natural-language quick add ("call dentist tomorrow 30m"), keyboard shortcuts for start/complete/skip, drag/reorder + bulk edit, inline markdown editor as escape hatch, capacity view.

## Scoring
Configurable scoring engine behind an interface. Default engine = legacy formula `(emoji weights + project value + placement bonus) / effort hours`, golden-tested against legacy output on a copy of real data. A separate agent explores a redesigned engine; a bake-off compares both on real data before any switch. Never replace the default without Michael's sign-off.

## Lifecycle / features (parity with legacy specs in `~/dev/todo/.xe/specs`)
start, complete, skip/park, resume, suspend, set-properties, remove-completed, add-project, start-date (⏰) and suspend (💤) sweeps, summaries (README, stack, projects, my-day), time blocks/capacity, recurring rows, 🔎 query tasks, triage/assist, messaging.

## Review-gate resolutions (PR 7: 8 assumptions, 8 questions)
Michael delegated the details; decisions below, reversible via config.
| # | Item | Decision |
| - | ---- | -------- |
| A1 | Date format `Mon D[, YYYY]` | Keep in emoji formatter; internal ISO dates. |
| A2 | Recurring shape `📅 date: 🔄 Cadence:` | Keep as canonical emoji-md form; legacy form also parsed. |
| A3 | Weekend due → Monday | Keep, as a per-task/config option (default on). |
| A4 | Rolled rows reset subtasks | Keep. |
| A5 | Lossless in-place edit | Keep for emoji formatter (byte-exact round-trip tests). |
| A6 | Monthly clamps to month end | Keep. |
| A7 | Build order | Superseded by roadmap below. |
| A8 | Legacy files are compat target | Yes for emoji formatter; no migration performed by agents. |
| Q1 | Compat vs break | Compat via emoji formatter; evolve through the clean formatter. |
| Q2 | Weekend drift | Store nominal day in the model (clean) / hidden marker (emoji); rolls stay on nominal day. |
| Q3 | Recurring forms | Support both + weekday names. |
| Q4 | WA quarterly | Cadence token `Quarterly-EOM+1`; generalize on a second case. |
| Q5 | Roll location | `complete` rolls in place (stays open). |
| Q6 | Config | Legacy `.xe/config/stack.json` path/shape honored; JSON; defaults baked in. |
| Q7 | Scoring parity | Yes, goldens from legacy output. |
| Q8 | Phase 1 scope | Overridden: full scope, ordered below. |

## Roadmap (one draft PR per slice, spec + tests first)
1 parser/serializer (PR 7) · 2 recurring (PR 6) · 3 model + formatters + config · 4 scoring engine + parity goldens · 5 lifecycle ops · 6 summaries · 7 sweeps · 8 storage adapter (git) · 9 API + MCP · 10 CLI · 11 web app (desktop+mobile) · 12 auth/security + threat model · 13 query tasks, triage/assist, bots, Actions · 14 scoring bake-off report · 15 docs + deploy runbook/IaC.

## Process
Catalyst 0.3 via local NPM package (or published 0.3 if validated). Orchestrator runs create → separate review agent → fix → repeat until clean. All work via Catalyst commands; full specs with traceability. Draft PRs only; agents never merge. Do not modify `~/dev/todo` or migrate data. Credentials via PowerShell Xerilium context. Running `STATUS.md` in repo.

## Acceptance criteria (done = all true)
1. Parity: scoring, summaries, lifecycle outputs match legacy golden outputs on a copy of Michael's real tasks.
2. Round-trip: every legacy `tasks/*.md` parses and re-serializes byte-exact via the emoji formatter.
3. Tests: unit + browser e2e green in CI; high coverage on core (target ≥90% lines).
4. Security: threat model + checklist pass; unauthenticated requests get 401/redirect on every route; tokens scoped/revocable/hashed; no task data in client bundle or logs; verified by tests.
5. Surfaces: web (desktop keyboard + mobile touch/speech), CLI, REST, MCP, bot hook all complete the same core flows: next, add, start, complete, skip, resume, set properties.
6. Edit without PRs: a web edit lands as a direct commit in the data repo within seconds.
7. Cost: deploys within free tiers (documented).
8. Traceability: every requirement maps spec → test → code in `.xe`.
9. Docs: README, API/MCP reference, deploy runbook usable cold.
10. Scoring bake-off report delivered; default unchanged unless approved.
