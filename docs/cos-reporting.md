# CoS reporting

<!-- @req FR:cos-base-of-ops/doc.contract -->

What the Chief of Staff (CoS) agent sends each check-in so the owner's Chief of Staff view (`#/cos`) is complete. No LLM call in Stack. Spec: `.xe/features/cos-base-of-ops/spec.md`.

## Each check-in

1. **Read the inbox.** `stack inbox list --json`. Act on each owner instruction, then `stack inbox handle <id> --note "<what you did>"`. Messages from the CoS view arrive here as `instruction`.
2. **Report.** `stack report --agent <cos> --project all --file report.json` (shape: [report.md](report.md)).
   - `top`: the 3 things that matter most now, each with a `link` when one exists.
   - `asks`: each decision for the owner. Give `ask` (the question), `why` (the brief), `link`, `by` (deadline), `recommend` (your recommended answer), `kind`. They show under Decisions; the owner answers inline.
   - `blockers`: what stops progress. `progress`: what moved since the last report.
   - Read `asks.answers` in the result (`--json`) and act on each answer.
3. **Priority status.** For each priority that moved: `stack pris note <id> "<one-line status>"`. Run `stack pris gaps` and fix every gap (no status, stale > 7 days, no linked tasks).
4. **PR escalations.** Keep the set current: `stack pr-pri escalate --file set.json` (≤3 blocked, ≤3 enable, ≤1 live validation; shape: [pr-priority.md](pr-priority.md)).

## Rules

- Report at least every 24 h. After 24 h the view says `CoS has not reported since <date>`.
- Use the agent slug the team lists as the roll-up (`--agent cos`); the view reads only that agent's reports. Project `all` wins over a single project.
- Never send zeros you did not check. Send `{}` to clear the report.
- Use full links. Keep each item under 20 words.

## Paste as the final step of the CoS prompt

```text
Final step, every check-in (docs/cos-reporting.md):
1. stack inbox list --json; act on each instruction; stack inbox handle <id> --note "<done>".
2. Write report.json: top (3, with links), asks (ask, why, link, by, recommend, kind), blockers, progress.
3. stack report --agent cos --project all --file report.json --json; act on asks.answers.
4. stack pris note <id> "<status>" for each priority that moved; stack pris gaps; fix every gap.
5. stack pr-pri escalate --file set.json (≤3 blocked, ≤3 enable, ≤1 live).
```
