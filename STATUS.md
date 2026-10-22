# Status

- 2026-10-22: landed config (#10), task-parser (#7), recurring-rows (#6) via squash after independent review; pnpm test 232 pass.
- 2026-10-22: task-lifecycle in review (PR #TBD); pnpm test 320 pass; legacy goldens byte-exact.
- 2026-10-22: scoring-bakeoff in review; balanced engine + report added, default unchanged.
- 2026-10-22: cli in review; pnpm test 473 pass; parity script skips without STACK_LEGACY_DIR.
- 2026-10-22: acceptance verification in review; 9 of 10 criteria pass, traceability partial (docs/acceptance.md); `scripts/parity.sh` reproduces parity against a legacy copy; core coverage threshold added.

## Known gaps

- Traceability tags: of 382 requirements, 45 lack a code `@req` tag and 15 lack a test `@req` tag (run `scripts/trace.sh`). Mostly interface (`@function`) and docs requirements whose tests/code exist untagged. Untagged tests: authorize/session/token `@function`, session.input, chat-bots cmd.ref and github.deliver, quick-capture speech.*, query-tasks expand/github/refresh/trigger `@function`, github.inject, github.parse. Retag; add tests where behavior is genuinely unchecked.
- `catalyst check` is broken in 0.3.2, so `scripts/trace.sh` is the traceability check.
- `src/cli/run.ts` shows 0% in jest coverage because e2e tests run it in a subprocess; it is outside the core threshold.
- 2026-10-22: ai-triage-assist in review; autonomy gate (deny by default), triage/claim/record-result via core, API, MCP, CLI.
