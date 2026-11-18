# Tasks: task store

One PR per group. Tests first in each PR. `@req FR:task-store/...` on every test.

## Test plan (contract first)

- Contract suite `tests/core/task-store.contract.test.ts`, run on `:memory:` and on a temp file:
  - add, get, list, update, remove; one transaction per call (`FR:store.*`)
  - ID form, slug from title, clash suffix, stable on rename, move updates links, loose lookup (`FR:id.*`)
  - `rev` adds 1; `expectRev` mismatch throws `ConflictError` with the current task; patch changes only given fields (`FR:write.rev`, `FR:write.expect`, `FR:write.lww`)
  - `updatedBy` from token, `STACK_ACTOR`, `me` (`FR:write.actor`)
  - complete deletes; recurring rolls; open children refuse without `--cascade`; dangling `blocks` resolves (`FR:done.*`)
- Migration test: old `schema_version` upgrades; newer version refuses (`FR:store.schema`).
- Concurrency test: two processes write the same file; no lost write, no corrupt file (`FR:write.host`).
- Round-trip test: fixtures `import md` then `export md` then `import md` give equal tasks (`FR:export.roundtrip`).
- Parity test: same fixture ranks the same on md and on the store (`FR:rank.parity`).
- Restore test: snapshot, bad write, restore, data equals snapshot (`FR:backup.restore`).
- CLI and MCP tests: every read gives `--json` in the `Task` shape (`FR:write.json`).
- Perf test: 2,000 tasks, `list` and `next` under 100 ms (`NFR:perf.read`).

## 1: store-contract

- [ ] Contract suite (above), failing
- [ ] `TaskStore` interface, errors (`FR:store.@type`, `FR:$errors`)
- [ ] In-memory adapter passes the suite (`FR:store.memory`)

## 2: store-sqlite

- [ ] File adapter, WAL, busy timeout (`FR:store.file`)
- [ ] Migrations and `schema_version` (`FR:store.schema`)
- [ ] Concurrency test

## 3: store-io

- [ ] `stack import md` with `--dry-run`, `--replace`, report (`FR:import.*`)
- [ ] `stack export md` and `stack export json` (`FR:export.*`)

## 4: store-surfaces

- [ ] `store` config flag (`FR:cutover.flag`)
- [ ] CLI, MCP, API on `TaskStore`; ID refs; `--json` (`FR:write.surfaces`, `FR:write.json`)
- [ ] Actor, `rev`, `expectRev` (`FR:write.actor`, `FR:write.rev`, `FR:write.expect`)
- [ ] Host-first write path (`FR:write.host`)
- [ ] Change signal after each write (`FR:sync.live`); phone offline read-only view (`FR:sync.offline`)

## 5: store-rank

- [ ] Ranker on the store; `updatedAt` for activity (`FR:rank.source`, `FR:rank.activity`)
- [ ] Parity test (`FR:rank.parity`)

## 6: store-backup

- [ ] Snapshot, skip when unchanged, keep 48, `backup.dir` (`FR:backup.snap`, `FR:backup.copy`, `FR:backup.keep`)
- [ ] `stack backups`, `stack restore` (`FR:backup.list`, `FR:backup.restore`)

## 7-10: Stages

- [ ] 7: Shadow re-import after each md commit (`FR:cutover.shadow`)
- [ ] 8: Agent files on CLI or MCP `--json`; scan test (`G4`)
- [ ] `stack cutover check` prints gates `G1`-`G7` (`FR:cutover.gates`)
- [ ] 9: Cutover: final import, snapshot, md read-only check (`FR:cutover.final`)
- [ ] 10: Retire md; remove `stack update` (`FR:cutover.retire`, `FR:rollback.md`)
