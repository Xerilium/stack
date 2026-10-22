# Status

Final status, 2026-10-22. Phases 1-4 of the blueprint are built and merged to `main`. Phases 5 and 6 (enterprise, scale) are out of scope. Cutover from the legacy system is Michael's call.

## What is built

All 20 blueprint features for Phases 1-4 have a spec, tests, and code, and their PRs are merged. Plans are missing for `config`, `scoring-engine`, and `task-parser` (spec, tests, code exist). `azure-host` was added beyond the blueprint (the Functions host that serves the API, MCP, and bots).

PR base: https://github.com/Xerilium/stack/pull/

| Phase | Feature | PR | Status |
| --- | --- | --- | --- |
| 1 | task-model | [#11](https://github.com/Xerilium/stack/pull/11) | Merged |
| 1 | task-parser | [#7](https://github.com/Xerilium/stack/pull/7) | Merged |
| 1 | recurring-rows | [#6](https://github.com/Xerilium/stack/pull/6), [#16](https://github.com/Xerilium/stack/pull/16) (full cadence) | Merged |
| 1 | config | [#10](https://github.com/Xerilium/stack/pull/10) | Merged |
| 1 | scoring-engine | [#13](https://github.com/Xerilium/stack/pull/13) | Merged |
| 1 | storage-git | [#15](https://github.com/Xerilium/stack/pull/15) | Merged |
| 1 | task-lifecycle | [#18](https://github.com/Xerilium/stack/pull/18), [#25](https://github.com/Xerilium/stack/pull/25) (gaps) | Merged |
| 1 | summaries | [#17](https://github.com/Xerilium/stack/pull/17) | Merged |
| 1 | cli | [#20](https://github.com/Xerilium/stack/pull/20) | Merged |
| 2 | formatter-clean | [#23](https://github.com/Xerilium/stack/pull/23) | Merged |
| 2 | api | [#24](https://github.com/Xerilium/stack/pull/24), [#30](https://github.com/Xerilium/stack/pull/30) (follow-ups) | Merged |
| 2 | auth-security | [#28](https://github.com/Xerilium/stack/pull/28) | Merged |
| 2 | quick-capture | [#27](https://github.com/Xerilium/stack/pull/27) | Merged |
| 2 | web-app | [#31](https://github.com/Xerilium/stack/pull/31) | Merged |
| 3 | mcp-server | [#29](https://github.com/Xerilium/stack/pull/29) | Merged |
| 3 | query-tasks | [#19](https://github.com/Xerilium/stack/pull/19) | Merged |
| 3 | chat-bots | [#26](https://github.com/Xerilium/stack/pull/26) | Merged |
| 3 | scoring-bakeoff | [#21](https://github.com/Xerilium/stack/pull/21) | Merged |
| 3 | ai-triage-assist | [#33](https://github.com/Xerilium/stack/pull/33), [#37](https://github.com/Xerilium/stack/pull/37) (autonomy gate) | Merged |
| 4 | deploy-docs | [#34](https://github.com/Xerilium/stack/pull/34) | Merged |
| extra | azure-host | [#36](https://github.com/Xerilium/stack/pull/36) | Merged |

Supporting PRs: init and toolchain ([#9](https://github.com/Xerilium/stack/pull/9), [#12](https://github.com/Xerilium/stack/pull/12), [#14](https://github.com/Xerilium/stack/pull/14)), blueprint ([#8](https://github.com/Xerilium/stack/pull/8)), Catalyst 0.3.2 from npm ([#22](https://github.com/Xerilium/stack/pull/22)), acceptance ([#32](https://github.com/Xerilium/stack/pull/32)), trace gaps ([#35](https://github.com/Xerilium/stack/pull/35)), palette e2e deflake ([#38](https://github.com/Xerilium/stack/pull/38)).

## Acceptance results

Details in [docs/acceptance.md](docs/acceptance.md). Against a copy of the legacy repo (12 task files): round trip byte-exact 12/12, `update` output byte-identical (4/4 files at 3 clocks, 0 task files changed), `next` top score equal at 10/10 instants. All 10 criteria pass.

Checks on `main`: `pnpm test` 1201 pass (11 gated parity tests skip without the legacy folder); lint and `pnpm build` clean; web unit 37 pass; web e2e 62 pass (8 skipped by project config); core coverage 96.3 statements / 89.3 branches / 98.3 functions / 98.3 lines (threshold 90/85/90/90); `scripts/trace.sh` 0 gaps across 504 requirements.

## Known gaps and follow-ups

- Upstream bug: `catalyst check` crashes in 0.3.2 (missing `check/runner`). `scripts/trace.sh` stands in. It is not yet a CI gate.
- MCP timeout may duplicate retried writes: a client that retries after a timeout can apply a write twice (no idempotency key yet).
- Tests-first is not visible in git history for some PRs (tests and code landed in the same commit); review covered it.
- Flaky-test history: the web palette e2e was flaky and was fixed in #38 (`expect.poll`); watch for other timing-based e2e tests.
- Autonomy gate L2: a flood of ~1,600 record-result calls by a triage-level token rotates out the whole result log; only the latest tombstone survives. Recovery relies on storage history (guaranteed only by the git adapter). The tombstone names whoever triggered the rotation, not necessarily the flooder.
- Autonomy gate L3 (cosmetic): the tombstone date range can include earlier tombstones' dates; no caller text can inject into it.
- Autonomy gate L7: `appendLog` can throw "Result log is busy" after 12 conflicts, so a flooding agent can make other agents' record-result fail; `rotateLogs` throws if the project file was deleted.
- `src/cli/run.ts` shows 0% in jest coverage because e2e tests run it in a subprocess; it is outside the core threshold.
- Default time blocks in `src/core/config.ts` keep the legacy names (kept for parity). One is a personal nickname; rename it in config if the repo is shared widely.
- Missing plan.md for `config`, `scoring-engine`, `task-parser`.
- Not verified live: nothing is deployed; no Azure resources exist.

### Hosting prerequisites (owner)

- Repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN` (SWA deployment token) for `.github/workflows/deploy.yml`.
- `STACK_OWNERS` allow-list of sign-in identities, and `STACK_TOKEN_PEPPER`.
- Data repo settings: `STACK_REPO_URL` and `STACK_REPO_TOKEN` (plus optional `STACK_REPO_BRANCH`, `STACK_REPO_PATH`).
- Steps in [docs/runbook.md](docs/runbook.md). Agents never deploy or hold secrets.

### Out of scope

- Phase 5 (multi-user, sharing, DB adapter, Xe Prime integration) and Phase 6 (scale).
- Cutover from the legacy system: Michael decides when.

## How Catalyst is consumed

`@xerilium/catalyst` 0.3.2 from npm (devDependency, pinned in `package.json`, locked in `pnpm-lock.yaml`). Specs, plans, and rollouts live in `.xe/`. Process: spec, plan, tests first, code, independent review, squash-merge on green CI.
