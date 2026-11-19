# Plan: task store

- Small PRs, in order. Each PR can ship alone.
- Tests first in each PR (`.xe/process/development.md`). Contract tests come before any adapter.
- md stays the source of truth until the gates in `FR:cutover.gates` pass.

## PRs

| #   | PR             | Delivers                                                                                                                                                          | Stage     |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | store-contract | `TaskStore`, item types, errors, shape and gate rules, contract suite. In-memory adapter passes it.                                                               | 0 Build   |
| 2   | store-cosmos   | Cosmos adapter: one container, `/ownerId`, ETag checks, transactional batch, throttle retry. Same suite on the Linux emulator in CI.                              | 0 Build   |
| 3   | store-infra    | Free tier account, throughput limit, 7-day continuous backup, budget alert, Entra roles. `stack store check`. Docs in `deploy-docs`.                              | 0 Build   |
| 4   | store-io       | `stack import md` (shape mapping, inbox for gate fails), `stack export md`, `stack export json`. Round-trip test on anonymized fixtures.                          | 0 Build   |
| 5   | store-backup   | Hourly GitHub Actions export (OIDC, read-only role) to `backup.remote`; Mac debounced export, `stack restore [--at]`, `stack setup --restore`, `docs/restore.md`. | 0 Build   |
| 6   | store-surfaces | CLI, MCP, Mac host and Azure host on `TaskStore` behind the `store` flag. `--json`, actor, `clarify`. Change feed to SSE.                                         | 0 Build   |
| 7   | store-rank     | Ranker reads the store; `updatedAt` replaces `git blame`. Parity test md vs store. Needs [179](https://github.com/Xerilium/stack/pull/179).                       | 0 Build   |
| 8   | store-offline  | Mac read cache, phone and CLI capture queue, `OfflineError` on edits.                                                                                             | 0 Build   |
| 9   | store-shadow   | `store: "shadow"`: re-import after each md commit; `sandbox` container; `stack cutover check`. Cost and writer gates (`G7`, `G8`) start here.                     | 1 Shadow  |
| 10  | agents-cli     | Agent files move from md paths to CLI or MCP `--json` (`G4`). Data change in the todo repo, plus a scan test.                                                     | 1 Shadow  |
| 11  | cutover        | `store: "cosmos"`: final import, snapshot, md read-only check (CI rejects `tasks/*.md` edits).                                                                    | 2 Cutover |
| 12  | retire-md      | Delete `tasks/*.md` and generated files from `main`. Remove `stack update`. Keep md adapters for export only.                                                     | 3 Retire  |

Spec sync: PR 1 also updates `task-model` (shape, item types), `task-lifecycle` (tombstone delete, clarify) and `azure-host` (Cosmos instead of git storage; key auth) to point here. Each later PR updates any spec it changes.

App work for gates `G1`-`G3` lives in `product-reset` (its own stages 4-6, not the cutover stages here). This plan adds no UI.

## Order rationale

- The contract comes first, so every adapter and surface tests against one suite.
- Infra comes before import, so the free-tier guard exists before any data lands.
- Import, export and backup ship before any write path, so a way back exists from day one.
- Shadow runs as long as the app needs. It costs nothing: md still wins.

## Gate check

- One script, `stack cutover check`, prints each gate as pass or fail with the reason.
- `G1` compares `stack next --json` on md and on the store once a day and logs the result.
- `G10` is the owner's go. No agent sets `store: "cosmos"`.

## Done when

- Stage 3 has run 10 work days with no rollback.
- No agent file or script reads `tasks/*.md`.
