# Status

- 2026-10-22: landed config (#10), task-parser (#7), recurring-rows (#6) via squash after independent review; pnpm test 232 pass.
- 2026-10-22: task-lifecycle in review (PR #TBD); pnpm test 320 pass; legacy goldens byte-exact.
- 2026-10-22: scoring-bakeoff in review; balanced engine + report added, default unchanged.
- 2026-10-22: cli in review; pnpm test 473 pass; parity script skips without STACK_LEGACY_DIR.
- 2026-10-22: acceptance verification in review; 9 of 10 criteria pass, traceability partial (docs/acceptance.md); `scripts/parity.sh` reproduces parity against a legacy copy; core coverage threshold added.

## Known gaps

- Autonomy gate L2: a flood of ~1,600 record-result calls (~800 bytes each) by a triage-level token rotates out the whole 5x256KB log; only the latest tombstone survives (earlier ones shift down and drop after 4 rotations). Recovery relies on storage history (guaranteed only by the git adapter). The tombstone names whoever triggered the rotation, not necessarily the flooder.
- Autonomy gate L3 (cosmetic): the tombstone date range can include earlier tombstones' dates; no caller-controlled text can inject into it.
- Autonomy gate L7: `appendLog` can still throw "Result log is busy" after 12 conflicts, so a flooding agent can make other agents' record-result fail; `rotateLogs` re-reads the project file and throws if it was deleted.
- Traceability: `scripts/trace.sh` reports 0 gaps (402 requirements, all with code and test `@req` tags). It is not yet a CI gate.
- `catalyst check` is broken in 0.3.2, so `scripts/trace.sh` is the traceability check.
- `src/cli/run.ts` shows 0% in jest coverage because e2e tests run it in a subprocess; it is outside the core threshold.
- 2026-10-22: ai-triage-assist in review; autonomy gate (deny by default), triage/claim/record-result via core, API, MCP, CLI.
