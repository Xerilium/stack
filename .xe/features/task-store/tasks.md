# Tasks: task store

One PR per group. Tests first in each PR. `@req FR:task-store/...` on every test.

## Test plan (contract first)

- Contract suite `tests/core/task-store.contract.test.ts`, run on the in-memory adapter and the Cosmos emulator:
  - add, get, list, tree, update, remove; one atomic call each (`FR:store.*`)
  - shape: task under task throws `ShapeError`; sub-project depth 1; steps flat; `body` stays opaque (`FR:model.*`)
  - gate: each missing field throws `GateError`; clarify deletes inbox and creates in one batch (`FR:gate.*`)
  - ID form, slug from title, clash suffix, stable on rename and move, ref lookup (`FR:id.*`)
  - stale `rev` throws `ConflictError` with the current item; patch retry; actor (`FR:write.*`)
  - complete deletes and counts; recurring rolls; project with open tasks refuses without `--cascade`; dangling `blocks` resolves; dayplan keeps 2 days (`FR:done.*`)
  - three-way retry: scalar retries; `body` never retries; link and step ops merge (`FR:write.retry`)
  - tombstone on delete; ID reserved 90 days; inbound `blocks` removed; client ID create is idempotent; tombstone hit returns `{clarified: true}`; container `defaultTtl: -1` (`FR:done.tombstone`, `FR:id.reserve`, `FR:id.client`)
  - lock set: every write throws `ReadOnlyError`; bulk resumes after a failed chunk (`FR:store.lock`, `FR:store.bulk`)
  - human ask: agent creates an owner `me` task that blocks its own (`FR:gate.human`)
- Writer test: 10 writers on one task for 1 minute; no lost write (`G7`, `FR:write.expect`).
- Schema test: older `schemaVersion` upgrades; newer throws (`FR:store.schema`).
- Round-trip test: fixtures `import md` then `export md` then `import md` give equal items (`FR:export.roundtrip`).
- Import map test: parent row becomes project; gate fail becomes inbox; quotes go to `body` (`FR:import.map`).
- Import ID test: two imports of the same md give the same IDs; `--replace` clears tombstones; `updatedAt` from `git blame` (`FR:import.ids`, `FR:import.once`).
- Parity test: same fixture ranks the same on md and on the store (`FR:rank.parity`).
- Restore test: snapshot, bad write, restore, data equals snapshot (`FR:backup.restore`).
- Remote test on a local bare repo: exports commit `stack.json`; `setup --restore` on an empty store gives the same items (`FR:backup.remote`, `FR:backup.new`).
- Cost check test: drifted throughput limit, tier or backup fails `stack store check` (`FR:cost.check`).
- Offline test: edits throw `OfflineError`; inbox capture queues and sends on reconnect (`FR:offline.*`).
- Backup test: public repo refuses push; failed push sets `Backup failed` and retries (`FR:backup.private`, `FR:backup.fail`).
- Flag test: `cosmos` to `md` without export refuses; rollback export restores md (`FR:cutover.flag`, `FR:rollback.md`).
- Sandbox test: a sandbox write never reaches md or the shadow container (`FR:cutover.sandbox`).
- Privacy test: logs from every write path hold no task title or body (`NFR:privacy`).
- Perf test in CI: 2,000 tasks; read under target (`NFR:perf.*`).
- RU test: nightly job on the real account (the emulator does not meter RU); full read under 100 RU (`NFR:ru`).

## 1: store-contract

- [ ] Contract suite (above), failing
- [ ] `TaskStore`, item types, errors (`FR:store.@type`, `FR:$*`)
- [ ] Shape and gate rules in core (`FR:model.*`, `FR:gate.*`); store lock and bulk (`FR:store.lock`, `FR:store.bulk`); tombstones (`FR:done.tombstone`)
- [ ] In-memory adapter passes the suite (`FR:store.adapters`)

## 2: store-cosmos

- [ ] Cosmos adapter: container, partition, batch, ETag, throttle (`FR:store.container`, `FR:store.atomic`, `FR:write.expect`, `FR:write.throttle`)
- [ ] CI job on the Linux emulator; writer test

## 3: store-infra

- [ ] Free tier account, throughput limit, 7-day backup, budget alert (`FR:cost.*`)
- [ ] Entra data-plane role for the Mac; key in Azure host settings (`FR:write.keys`, `FR:write.auth`)
- [ ] `stack store check` (`FR:cost.check`)

## 4: store-io

- [ ] `stack import md` with map, `--dry-run`, `--replace`, report (`FR:import.*`)
- [ ] `stack export md` and `stack export json` (`FR:export.*`)

## 5: store-backup

- [ ] Hourly Actions export (OIDC) and Mac debounced export to `backup.remote`; private check; failure state (`FR:backup.snap`, `FR:backup.mac`, `FR:backup.remote`, `FR:backup.private`, `FR:backup.fail`)
- [ ] `stack restore [--at]`, `stack setup --restore`, `docs/restore.md` (`FR:backup.restore`, `FR:backup.new`, `FR:backup.pitr`)

## 6: store-surfaces

- [ ] `store` config flag (`FR:cutover.flag`)
- [ ] CLI, MCP, Mac host, Azure host on `TaskStore`; `--json`; `clarify` (`FR:write.surfaces`, `FR:write.json`, `FR:gate.clarify`)
- [ ] Change feed to SSE (`FR:sync.live`); Azure host polling (`FR:sync.poll`)

## 7: store-rank

- [ ] Ranker on the store; pool filter; `updatedAt` (`FR:rank.*`)

## 8: store-offline

- [ ] Mac read cache; capture queue; `OfflineError` (`FR:offline.*`)

## 9-12: Stages

- [ ] 9: Shadow re-import after each md commit (`FR:cutover.shadow`)
- [ ] 10: Agent files on CLI or MCP `--json`; scan test (`G4`)
- [ ] 9: `sandbox` container (`FR:cutover.sandbox`); `stack cutover check` prints gates `G1`-`G10` (`FR:cutover.gates`)
- [ ] 11: Cutover: final import, snapshot, md read-only check (`FR:cutover.final`)
- [ ] 12: Retire md; remove `stack update` (`FR:cutover.retire`, `FR:rollback.md`)
