# Audit and decision

Score 0-5 per need (5 = answers it in one glance). Source: code in `web/src` after #79.

| Need | Home (#79) | My day | Projects | Needs you | Brief (new) |
| --- | --- | --- | --- | --- | --- |
| Next meetings | 1 (window line only) | 5 (timeline) | 0 | 0 | 5 |
| Top messages | 0 | 2 (email block count) | 0 | 4 (all asks, mixed) | 5 |
| Top actions | 2 (task rows) | 2 (collapsed line) | 0 | 5 | 4 |
| One task | 5 | 3 | 1 | 0 | 5 |
| Finite, no scroll | 4 | 2 | 3 | 3 | 5 |
| Noise | low | high (many rows) | medium | low | low |

| View | Redundant | Missing | Noisy | Single job (decision) |
| --- | --- | --- | --- | --- |
| Home | Per-project rows duplicate Projects | Meetings, messages | No | "What now": one task + fit. Keep |
| My day | Task rows duplicate Home/Full stack | Messages | Yes (timeline of every task) | "Schedule": meetings + time blocks. Keep; drop duplicates later |
| Projects | Top task per project duplicates Home rows | Nothing | Medium | "Capacity per project". Keep; candidate to merge into Full stack |
| Needs you | None | Split of messages vs decisions | No | "Answer everything asked of me". Keep |
| Brief (new, experimental) | Reuses data of all four | n/a | No | "CoS": 5 sections, one screen |

## Decision

- Do not change existing views in this slice. Risk is high with 4 open PRs on Home and My day.
- Add Brief behind `Experimental`. If used for 2 weeks: Home becomes Brief; Home's project rows move to Projects; My day keeps the timeline only.
- Experiment 2 (inside Brief): `Next 90 minutes` strip. Next candidate (not built): AI daily brief text with one-tap actions; needs server summary endpoint.
