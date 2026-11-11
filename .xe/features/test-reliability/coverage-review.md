# Spec and test coverage review

Date: 2026-11-10. Base: `main` at PR 117. Tool: `pnpm exec catalyst traceability`.

## TL;DR

- Traceability: 92% to 96%. Uncovered: 110 to 56. Orphaned `@req` ids: 12 to 0. Test gaps: 132 to 79.
- Most "uncovered" P1s had tests. The tests named the parent FR, not the leaf. Real untested behavior was rare.
- Highest open risk: 9 test files still sleep or poll the wall clock. A ratchet test now stops new ones.

## Ranked gaps

| # | Gap | Risk | Status |
| --- | --- | --- | --- |
| 1 | Tests sleep or poll the wall clock (`FR:test-reliability/wait.event`). `tests/mcp/stdio.test.ts` slept 300-400 ms, then read replies | P1: flaky on a busy machine | Fixed for MCP stdio (waits on reply ids). `tests/deploy/reliability.test.ts` fails on any new sleep. 9 files remain in its `KNOWN` list |
| 2 | Orphaned ids: 9 `FR:autopri-tagging/*` (spec moved to `auto-priority`), 3 `web-app` ids the spec removed | P1: 9 shipped P1s showed as uncovered | Fixed |
| 3 | Docs drift: `docs/cli.md` missed `graph --account` and `agents --reports-to`. No check for stale doc entries or `docs/acp.md` | P1: docs teach wrong usage | Fixed. `tests/deploy/docs-drift.test.ts` (`FR:deploy-docs/docs.drift`) |
| 4 | `FR:github-pr-status/status.fetch.limit`: the test used 6 PRs, so a cap of 12 still passed | P1: GitHub rate limits | Fixed: 13 PRs, peak must be 6. Mutation (cap 12) fails it |
| 5 | `FR:auto-priority/engine.project-value`: no test | P1: ranking | Fixed. Mutation (share 0) fails it |
| 6 | Stale spec: `FR:cos-view/brief.ai.web` and `brief.phone` described the removed Brief page. Four deprecation markers did not parse | P2 | Fixed: deprecated with targets |
| 7 | 12 rollout files, all `in-progress`, all shipped (PRs 8-42) | P2: process noise | Deleted (`FR:catalyst-adoption/config.rollouts`) |
| 8 | PR 114 (Now-first, Brief removed) had no design-decision entry | P3 | Logged |
| 9 | Leaf FRs with tests but no leaf `@req` (agent-thread, autopilot, github-pr-status) | P2: false gaps | Annotated where a test asserts the behavior |

## Open (not fixed here)

| # | Gap | Next |
| --- | --- | --- |
| 1 | 9 files in `KNOWN` (`tests/deploy/reliability.test.ts`): `until` and `wait` helpers in `tests/agents/*`, `tests/cli/sessions-events.test.ts`; bare sleeps in `tests/agents/acp.test.ts`, `tests/cli/agent.test.ts`, `tests/host/github-storage.test.ts` | Replace with events or fake timers, one file per PR. Remove each from `KNOWN` |
| 2 | `catalyst-adoption`: 19 uncovered. Process FRs (flow, pilot, deprecate) have no code | Mark `[@req:exempt=process]` or move to a process doc |
| 3 | Web FRs without tests: `agent-thread/web.*` (keys, a11y, working), `web-app/now.blockers`, `row2`, `row.chips`, `ux.motion`, `web-shell/nav.views.default`, `now-screen/tokens.theme` | Add Playwright or web unit tests with `@req` |
| 4 | `agent-thread/ask.ref.source`, `thread.ask.inbox`, `reply.entry.handled`, `ask.card` | Unit tests; `ask.card` in web |
| 5 | `FR:cos-view/brief.empty`: Now draws empty lines, no test | Web unit test |
| 6 | `FR:test-reliability/wait.budget`: per-file jest timeouts not checked | Ratchet like `KNOWN` |
| 7 | `asks --limit` missing in `docs/cli.md` and the `asks` usage | Owned by PR 115 (`docs/asks.md`); docs-drift test skips `asks` |
| 8 | `comms-connectors`, `security-review`, `stack-app` are folders in `.xe/features` without `spec.md` | Move to a research folder, or keep and accept |
| 9 | Design-only FRs (`iphone-access/*.design`, `pwa/push.design`, `desktop-app/native.*`, `perf/bench.script`) | Mark exempt or test |
| 10 | `autopilot/labels.owners.optin`, `cert.match.order`: agent behavior, not workflow code | Mark exempt |

## Checked and clean

- `docs/api/README.md` and `openapi.yaml` match the route table (`tests/api/openapi.test.ts`). Token admin paths are documented as not in OpenAPI.
- `docs/mcp.md`: every tool row exists in `TOOLS`; no stale rows.
- `docs/runbook.md`: every `STACK_*` variable in `src/` is documented.
- `docs/acp.md`: timeout 600 s and 3 s grace match `src/cli/agent.ts`.
