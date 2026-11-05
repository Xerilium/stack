# Scoring bake-off: stack vs autopri

The default engine is unchanged (`stack`). This report compares it with `autopri` on real task data. It holds aggregate numbers and anonymized examples only.

## Recommendation

Ground truth ranks 1-6 pass on the fixture tasks (tests/core/autopri-engine.test.ts). On real todo tasks, ranks 1, 4 and 6 have no matching task or tag yet: Catalyst needs the 🔓 unblocker tag; v16 PRs and FOCUS v1.6 need rows. Next: owner or CoS tags those rows, then re-run. Keep stack as default; autopri is opt-in.

## Agreement

Population: 481 unparked leaf tasks, no time filter.

| Metric | Value |
| --- | --- |
| Same #1 task | yes |
| Top 10 overlap | 80% |
| Spearman rank correlation | 0.92 |
| Mean rank shift | 32.3 |
| Max rank shift | 254 |

## Effort mix of the top 10

| Engine | Quick | Medium | Large | No effort |
| --- | --- | --- | --- | --- |
| stack | 70% | 20% | 0% | 10% |
| autopri | 60% | 20% | 0% | 20% |

## Largest movers (anonymized)

| Project | Effort | Priority | Impact | stack rank | autopri rank |
| --- | --- | --- | --- | --- | --- |
| Project H | 🟡 | ‼️ | - | 102 | 356 |
| Project H | none | - | ⬆️ | 113 | 367 |
| Project H | 🟡 | - | - | 174 | 419 |
| Project H | 🟡 | - | - | 116 | 357 |
| Project H | 🟡 | - | - | 180 | 420 |

