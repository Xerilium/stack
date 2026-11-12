# Plan: Pris-aware ranking

Base: PR 129 (`xe/session-inventory`) for `PriStore` and `pris.json`.

1. Schema: `pris.ts` accepts optional `projects`, `keywords`, `refs`, `statusAt`. Seeded files stay valid.
2. Link: `pris-rank.ts` `linker` compiles terms once per list; best boost wins. No task file edits.
3. Engine: `autopri.ts` `autopriRank` takes an optional extra term per task. `pris` engine passes the link boost and puts unblockers first. `autopri` order unchanged.
4. Cache: `ScoringEngine.version?()` joins the rank memo key, so new priorities never reuse an old order.
5. Explain: `explainAutopri` takes `pris`; `formatExplain` prints `pri=` and `serves=`.
6. CoS: `stack pris link|note|gaps`. Pure `withLinks`, `withNote`, `priGaps`; writes go through `PriStore.put` (rev check, lock).
7. Bake-off: fixtures from `daily-pris.md` and the ground-truth table; report in `docs/scoring-bakeoff-pris.md`, numbers checked by test.
8. Tests first: `tests/core/pris-rank.test.ts`, `tests/cli/pris-rank.test.ts`.

Boost: rank 1 = 3000, linear to 3000/N. Project links get half. Due-today urgency is 2000, so pri 1 beats an unlinked due-today task; unblockers stay first by tier.
