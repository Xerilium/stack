# Plan: task store

- Small PRs, in order. Each PR can ship alone.
- Tests first in each PR (`.xe/process/development.md`). Contract tests come before the adapter.
- md stays the source of truth until the gates in `FR:cutover.gates` pass.

## PRs

| #   | PR             | Delivers                                                                                                                                    | Stage     |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | store-contract | `TaskStore` interface, errors, contract test suite. In-memory adapter on `:memory:` passes it.                                              | 0 Build   |
| 2   | store-sqlite   | File adapter, WAL, migrations, `schema_version`. Same contract suite on a temp file.                                                        | 0 Build   |
| 3   | store-io       | `stack import md`, `stack export md`, `stack export json`. Round-trip test on the anonymized fixtures.                                      | 0 Build   |
| 4   | store-surfaces | CLI, MCP and API on `TaskStore` behind the `store` flag. `--json` on every read. Actor and `expectRev`.                                     | 0 Build   |
| 5   | store-rank     | Ranker reads the store; `updatedAt` replaces `git blame`. Parity test md vs store. Needs [179](https://github.com/Xerilium/stack/pull/179). | 0 Build   |
| 6   | store-backup   | Hourly snapshot, keep 48, `backup.dir`, `stack backups`, `stack restore`.                                                                   | 0 Build   |
| 7   | store-shadow   | `store: "shadow"`: re-import after each md commit. App and agents read the store.                                                           | 1 Shadow  |
| 8   | agents-cli     | Agent files move from md paths to CLI or MCP `--json` (`G4`). Data change in the todo repo, plus a scan test.                               | 1 Shadow  |
| 9   | cutover        | `store: "sqlite"`: final import, snapshot, md read-only check (CI rejects `tasks/*.md` edits).                                              | 2 Cutover |
| 10  | retire-md      | Delete `tasks/*.md` and generated files from `main`. Remove `stack update`. Keep md adapters for export only.                               | 3 Retire  |

App work for gates `G1`-`G3` lives in `product-reset` (Stages 4-6). This plan does not add UI.

## Order rationale

- The contract comes first, so the adapter, CLI and MCP all test against one suite.
- Import and export ship before any write path, so a way back exists from day one.
- Backup ships before shadow, so the restore drill (`G6`) can run early.
- Shadow runs as long as the app needs. It costs nothing: md still wins.

## Gate check

- One script, `stack cutover check`, prints each gate as pass or fail with the reason.
- `G1` compares `stack next --json` on md and on the store once a day and logs the result.
- `G7` is the owner's go. No agent sets `store: "sqlite"`.

## Done when

- Stage 3 has run 10 work days with no rollback.
- No agent file or script reads `tasks/*.md`.
