# Scoring bake-off: legacy vs balanced

The default engine is unchanged (`legacy`). This report compares it with `balanced` on real task data. It holds aggregate numbers and anonymized examples only.

## Recommendation

Keep `legacy` as the default; do not switch without owner approval. `balanced` agrees on the #1 task and 8 of the top 10, but it does not change the top-10 effort mix (still mostly quick tasks), so it does not fix the quick-task bias where it matters most. Its main effect is demoting quick tasks that carry no value signal from the middle of the list to the bottom. That is arguably better, but this report has no ground truth for "better". Next step if wanted: have the owner review the top 20 of each engine side by side for a week, then decide.

## Agreement

Population: 280 unparked leaf tasks, no time filter.

| Metric | Value |
| --- | --- |
| Same #1 task | yes |
| Top 10 overlap | 80% |
| Spearman rank correlation | 0.80 |
| Mean rank shift | 38.2 |
| Max rank shift | 161 |

## Effort mix of the top 10

| Engine | Quick | Medium | Large | No effort |
| --- | --- | --- | --- | --- |
| legacy | 90% | 0% | 0% | 10% |
| balanced | 90% | 0% | 0% | 10% |

## Largest movers (anonymized)

| Project | Effort | Priority | Impact | legacy rank | balanced rank |
| --- | --- | --- | --- | --- | --- |
| Project A | 🔹 | - | - | 45 | 206 |
| Project D | 🟢 | - | ⬇️ | 50 | 202 |
| Project H | 🟢 | - | - | 71 | 220 |
| Project D | 🟢 | - | ⬇️ | 49 | 194 |
| Project C | 🟢 | - | - | 62 | 207 |
