# Scoring bake-off: autopri vs pris

<!-- @req FR:pris-aware-ranking/bakeoff.fixture @req FR:pris-aware-ranking/bakeoff.ground-truth @req FR:pris-aware-ranking/bakeoff.picks -->

The default engine is unchanged (`stack`). `pris` is opt-in: `stack rank --engine pris`. It adds a priority term to the `autopri` parts (spec: [pris-aware-ranking](../.xe/features/pris-aware-ranking/spec.md)).

## Recommendation

On the fixture, `pris` puts 9 of 10 owner picks in the top 10; `autopri` puts 2. On real todo tasks the gain needs link terms: the live `pris.json` has none, so only automatic title links apply (project names and version tokens). Next: CoS runs `stack pris gaps`, then `stack pris link <id> --keywords ...` for each priority. Keep `stack` as default.

## Fixture top 10 vs owner picks

Fixtures: `tests/fixtures/pris-aware-ranking` (the 12 priorities of 2026-11-11 with link terms, synthetic tasks, owner picks). Time: 2026-11-11 17:00 UTC. **Bold** = an owner pick.

| Engine | Picks in top 10 |
| --- | --- |
| autopri | 2/10 |
| pris | 9/10 |

Missed by pris: Stack v2. Missed by autopri: PR quality pass, Autopilot escalations, Allyte marketplace, finops-hubs 0.11, v16 PRs, draft PR, errand one, Stack v2.

| # | autopri | pris | Priority served (pris) |
| --- | --- | --- | --- |
| 1 | **Catalyst 0.3.4 release: automated PR sweeps** | **Catalyst 0.3.4 release: automated PR sweeps** | 9:p9 keyword |
| 2 | **Office hours blog post** | **PR quality pass on Catalyst PRs (security, reliability, STE specs)** | 1:p1 keyword |
| 3 | Update pricing page copy | **Office hours blog post** | 10:p10 keyword |
| 4 | Invoice template cleanup | **Autopilot escalations: top 3 blocked threads** | 2:p2 keyword |
| 5 | Website footer polish | **Allyte marketplace listing: submit offer** | 3:p3 keyword |
| 6 | Refactor logger internals | **finops-hubs 0.11 backend changes** | 4:p4 keyword |
| 7 | Rename workbook tabs | **Update authored v16 PRs and review non-authored v16 PRs** | 5:p5 keyword |
| 8 | Old v14 docs cleanup | **Publish one draft PR** | 6:p6 ref |
| 9 | Merch store ideas | Errand two | 7:p7 ref |
| 10 | Rename CLI flags for consistency | **Errand one** | 7:p7 ref |

The unblocker (Catalyst 0.3.4, 🔓) stays first. The due-today blog stays high. Untagged noise with high emoji value drops out.

## Ground truth (2026-11-05)

With priorities built from the ground-truth table (ranks 1-6), `pris` keeps the order: Catalyst sweeps, FH 0.10, FTK v15 blog, FTK v16 PRs, Christmas After Dark, FOCUS v1.6 (`tests/core/pris-rank.test.ts`).

## Real data (aggregate only)

Population: 483 unparked leaf tasks, live `pris.json` (12 priorities, no link terms), 2026-11-11.

| Metric | Value |
| --- | --- |
| Priorities with linked tasks (auto) | 6 of 12 |
| Top 10 overlap with autopri | 100% |
| Broad project links (auto) | p3 links 224 tasks; p5 links 83 |

Automatic project links are broad. Explicit keywords and refs make the boost precise.
