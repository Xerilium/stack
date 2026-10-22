# Acceptance verification

Date: 2026-10-22. Verified against a read-only copy of the legacy repo (12 task files). Aggregate results only; no task content is recorded here because this repo is public.

The blueprint (`.xe/features/blueprint.md`, Phase 1) states the bar: "byte-exact round-trip, golden-tested scoring", legacy parity for core and CLI. It does not number its criteria, so the ten below are derived from it, the design decisions, and the specs.

Reproduce: `STACK_LEGACY_DIR=<legacy repo> scripts/parity.sh` (needs pwsh; reads the legacy folder, writes only to a temp copy), `pnpm test:coverage`, `scripts/trace.sh`.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Every legacy `tasks/*.md` round-trips byte-exact through parser and emoji formatter | Pass | 12/12 files; also check-all/uncheck-all via `setChecked` restores bytes (`tests/parity/real-data.test.ts`) |
| 2 | `stack update` reproduces README.md, stack.md, projects.md, my-day.md | Pass | 4/4 files byte-identical to the legacy generator at 3 frozen clocks (weekday morning, Saturday afternoon, Monday early morning), 12/12 comparisons; update changed 0 task files |
| 3 | `next` ordering matches legacy | Pass | Scores of every task, project weights, and ranking (up to legacy's unstable tie order) match the legacy golden; time-filtered candidates match at 10 instants (all time blocks, boundaries, DST change); `stack next` top score equals legacy at 10/10 instants |
| 4 | Core test coverage >= 90% | Pass | src/core: statements 96.2, branches 88.7, functions 98.8, lines 98.1. Enforced by `coverageThreshold` for `./src/core/` in `jest.config.js` (90/85/90/90) |
| 5 | Traceability spec -> test -> code | Pass (tag coverage; semantic coverage is the test suite) | 402 requirements in 16 specs; all 402 carry a code and a test `@req` tag (`scripts/trace.sh`: 0 gaps). Docs and script deliverables (threat model, SWA config, parity script) are tagged in place; `trace.sh` reads code tags from src, docs, scripts, package.json. `catalyst check` is broken in 0.3.2, so `scripts/trace.sh` stands in |
| 6 | `pnpm test`, `lint`, `build` green | Pass | 963 tests pass (11 gated parity tests skip without env); lint and `pnpm build` (all four targets) clean |
| 7 | Legacy config read from `.xe/config/stack.json` with no migration | Pass | Real legacy config used unchanged in criteria 2 and 3 |
| 8 | Lifecycle matches legacy goldens | Pass | `tests/core/lifecycle.golden.test.ts` green |
| 9 | Legacy repo is never modified | Pass | Scripts copy `tasks/`, `src/`, config, README.md, projects.md to a temp dir; `update` run with `--no-commit` on the copy changed 0 files |
| 10 | Default scoring and formatter stay legacy; alternatives are opt-in | Pass | Default engine is `legacy`; bake-off engine and clean formatter are selectable only; criteria 1-3 run on defaults |

## Notes

- The update comparison regenerates the legacy output with `tests/parity/generate-legacy.ps1` on the same copy and clock, so drift in the live legacy files (they change daily) does not matter. That script documents its deliberate deviations (insertion-ordered dictionaries, ordinal file order, date-driven task edits disabled).
- The `next` check compares scores, not task identity, because legacy sorts unstably and ties come out in arbitrary order.
- Not verified here: web-app, mcp-server, ai-triage-assist, deploy-docs (not yet built).
