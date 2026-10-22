# Status

- 2026-10-22: landed config (#10), task-parser (#7), recurring-rows (#6) via squash after independent review; pnpm test 232 pass.
- 2026-10-22: task-lifecycle in review (PR #TBD); pnpm test 320 pass; legacy goldens byte-exact.
- 2026-10-22: scoring-bakeoff in review; balanced engine + report added, default unchanged.
- 2026-10-22: cli in review; pnpm test 473 pass; parity script skips without STACK_LEGACY_DIR.
- 2026-10-22: acceptance verification in review; 9 of 10 criteria pass, traceability partial (docs/acceptance.md); `scripts/parity.sh` reproduces parity against a legacy copy; core coverage threshold added.

## Known gaps

- Autonomy gate (ai-triage-assist): no per-actor quota on the result log, so one token can still fill it and push other actors' entries out (the oldest file is dropped, a tombstone records it); review actors in the log.
- Autonomy gate: `/tasks/edit` compares marker counts and the first words after 📅 ⏰ 🔄, not a full parse; a token can still rewrite free text freely on rows at `assist`+, including text that other readers trust.
- Autonomy gate: a resumed log rotation (storage without `writeMany`) writes a tombstone without the dropped date range.
- Traceability: `scripts/trace.sh` reports 0 gaps (402 requirements, all with code and test `@req` tags). It is not yet a CI gate.
- `catalyst check` is broken in 0.3.2, so `scripts/trace.sh` is the traceability check.
- `src/cli/run.ts` shows 0% in jest coverage because e2e tests run it in a subprocess; it is outside the core threshold.
- 2026-10-22: ai-triage-assist in review; autonomy gate (deny by default), triage/claim/record-result via core, API, MCP, CLI.
