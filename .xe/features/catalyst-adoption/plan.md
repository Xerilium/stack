# Plan: Catalyst adoption

## Steps

1. Verify bootstrap in a clean clone. Install plugin. Record result.
2. Confirm coverage gaps (FR:deprecate.nogap). List gaps. File upstream issues in Catalyst.
3. Pilot: run `/catalyst:change` on `cli` (`--json` output for lifecycle commands).
   - Phase 0 scope -> spec edit -> failing tests -> code -> `/catalyst:pr-loop` (max 3 rounds).
   - Record tokens, time, human touches.
4. Review pilot against FR:pilot.exit. Owner reviews PR. Owner merges.
5. If pass: raise traceability to `error` for `src/`. Write the stub PR for todo legacy commands (Phase 1).
6. After 2 weeks or tasks-only: delete stubs (Phase 2).

## Order and owners

| Step | Owner | Effort |
| --- | --- | --- |
| 1-2 | Stack architect agent | 0.5 h |
| 3 | Stack architect agent | 2-3 h |
| 4 | Owner | 15 min review |
| 5 | Stack architect agent | 1 h |
| 6 | Any agent | 15 min |

## Risks

- Catalyst playbooks cost more tokens than legacy commands. Mitigation: measure in the pilot; compare with a legacy run.
- Rollout files left behind. Mitigation: pr-loop checks they are deleted.
- Traceability warnings flood. Mitigation: keep `warning` until pilot passes.

## Open decisions (agent default)

- Pilot choice: `--json` output (default). Owner may override in PR review.
