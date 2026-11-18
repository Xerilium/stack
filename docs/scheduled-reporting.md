<!-- @req FR:ask-briefs/brief.lint -->
<!-- @req FR:scheduled-task-reporting/step.block @req FR:scheduled-task-reporting/step.last @req FR:scheduled-task-reporting/step.always @req FR:scheduled-task-reporting/step.ids @req FR:scheduled-task-reporting/tokens.none @req FR:scheduled-task-reporting/tokens.lines @req FR:scheduled-task-reporting/exit.codes @req FR:scheduled-task-reporting/exit.stop @req FR:scheduled-task-reporting/exit.host @req FR:scheduled-task-reporting/answers.save @req FR:scheduled-task-reporting/secrets.none @req FR:scheduled-task-reporting/samples.types @req FR:scheduled-task-reporting/samples.tasks @req FR:scheduled-task-reporting/samples.run -->

# Scheduled task reporting

A scheduled Chief of Staff (CoS) task sends its status with `stack report` as its last step. The step adds no LLM call. Report schema and CLI: [report.md](report.md). Spec: `.xe/features/scheduled-task-reporting/spec.md`.

## Final step

Paste this block at the end of the task prompt. Replace `<agent>` and `<project>` with the values in [Tasks](#tasks). The task writes its own JSON in the heredoc.

```text
FINAL STEP (always the last step): send the Stack status report. No LLM call: use only facts from this run; no subagent, search, or summary pass.
- Send a report on every run. If the main work failed, put the cause in `blockers`.
- One short line of fact per item, with an https link when one exists. No prose, no greeting, no recap.
- Never a secret: no token, key, password, webhook url, signed url, or url with a token in its query.
- Asks: only items that need the owner. List every open ask again each run; a dropped ask leaves Needs you. `id` = the real item (`pr-130`, `issue-42`; add the repo when the project has more than one: `toolkit-pr-130`), same every run. New item, new `id`. Never a date or run number.
- Fields: `top`, `blockers`, `progress` items are {text, link?}. `asks` items are {id, ask, link (https), by (ISO date), kind? (approve|review|go-do|answer), recommend?, why?, default?, priority? (crit|high|normal|low), brief?}. No other keys.
- Every `approve` ask needs `brief`: {problem, solution, risks [1-5], recommendation, evidence? [https links]}. Max 120 words in all, max 25 words per sentence, plain words. Without it the owner sees "No context yet" and cannot approve; the output prints `warning:`. Fix it next run.
- Run this. Keep the quotes on 'JSON'. Replace the middle line with the JSON:
stack report --agent <agent> --project <project> --json <<'JSON'
<this run's report JSON: top (max 3), asks (max 10; id max 24 chars), blockers, progress (max 10 each)>
JSON
- Exit 0: stored. A `context` answer means: send a `brief` on that ask next run. If `asks.answers` is not empty, save it to this task's state file (create `state.md` beside this prompt if none). Do not act on it now. The next run reads it before its main work.
- Exit 2: fix only what `error` and `issues` name; send once more. Exit 1: send once more.
- Still failing, or `stack` not found: print `report failed: <error>` and stop. Never loop. No step after this one.
```

## Tasks

| Task                    | Agent         | Project | Type               |
| ----------------------- | ------------- | ------- | ------------------ |
| `f4-daily-checkin`      | `f4-cos`      | `f4`    | CoS daily check-in |
| `ftk-cos-daily-checkin` | `ftk-cos`     | `ftk`   | CoS daily check-in |
| `ftk-support-report`    | `ftk-support` | `ftk`   | Support report     |

A new CoS agent uses its agent slug and project slug (`[a-z0-9][a-z0-9-]{0,23}`).

## Rules

- **Last step.** The report reflects the end state of the run. A report failure cannot block the main work.
- **Every run.** A new report replaces the prior one. An ask that the new report drops leaves Needs you. So always list each open ask again.
- **Stable ids.** The `id` keeps the owner's answer across runs. A changed `id` loses the answer and shows a duplicate.
- **Briefs.** Every `approve` ask carries a `brief`. The owner decides from the card. A link alone is not context.
- **One retry.** A retry costs tokens. One retry, then stop. The next run sends a fresh report.

## No LLM call

`stack report` validates and stores the JSON. It makes no model call. The task already holds the facts from its own run. It copies them into the JSON. It does not start a subagent, search again, or write a summary for the report.

## Exit codes

| Code | Meaning                                                                             | Action                                                  |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `0`  | Stored (`via`: `host` or `store`)                                                   | Save `asks.answers` if the task has a state file. Stop  |
| `2`  | Bad input: not JSON, a flag mismatch, or schema `issues` (one per field)            | Fix only what `error` and `issues` name. Send once more |
| `1`  | Store busy (the CLI already waited 5 s for the lock) or the host refused the report | Send once more                                          |
| n/a  | `stack: command not found`                                                          | Print `report failed: <error>`. Stop                    |

## Host down

No action. When the desktop host is not running, `stack report` writes `~/.stack/reports.json` itself under a lock. The output ends in `(store)` (or `"via":"store"`). The host shows the report when it starts. A stale `host.json` is safe: the CLI checks the pid and the reply first.

## No secrets

The report shows in Needs you and the local store. Treat it as visible to anyone who sees the screen.

- Never put a token, key, password, webhook url, signed url, or url with a token in its query.
- The FTK support task reads a Teams webhook url. Never copy it into the report.
- No personal data beyond names already public on the linked page.
- Links point at the item itself: a PR, issue, or doc.

## Samples

### CoS daily check-in

```json
{
  "top": [
    {
      "text": "Release PR 412 ready for review",
      "link": "https://github.com/example/app/pull/412"
    },
    { "text": "Draft launch post for Friday" },
    { "text": "Close 3 stale issues" }
  ],
  "asks": [
    {
      "id": "pr-412",
      "ask": "Review release PR 412",
      "link": "https://github.com/example/app/pull/412",
      "by": "2026-11-13",
      "kind": "approve",
      "recommend": "Approve; CI green, 2 small fixes",
      "priority": "high",
      "brief": {
        "problem": "Release 4.2 is blocked on PR 412.",
        "solution": "Merge PR 412. It bumps the version and adds the changelog.",
        "risks": ["Two small review fixes are not yet tested on Windows."],
        "recommendation": "Approve. CI is green and the fixes are small.",
        "evidence": ["https://github.com/example/app/pull/412/checks"]
      }
    }
  ],
  "blockers": [{ "text": "Waiting on artwork from the designer" }],
  "progress": [{ "text": "Merged PR 409 and PR 410" }]
}
```

### Support report

```json
{
  "top": [
    {
      "text": "2 new issues need a maintainer",
      "link": "https://github.com/example/toolkit/issues"
    },
    { "text": "Teams post sent" }
  ],
  "asks": [
    {
      "id": "issue-1234",
      "ask": "Pick an owner for issue 1234 (export fails)",
      "link": "https://github.com/example/toolkit/issues/1234",
      "by": "2026-11-14",
      "kind": "answer",
      "recommend": "Assign to the export area owner",
      "priority": "normal"
    }
  ],
  "blockers": [],
  "progress": [{ "text": "Closed 5 answered issues" }]
}
```
