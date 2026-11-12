# Email triage cost report

Build `8d51a83` (main), 60 synthetic messages (`tests/fixtures/email-cost/`). No mailbox, no Graph sign-in, no secrets.

- Do not connect inboxes yet: fix the 2 blockers below first.
- Estimated cost: $0.10 to $0.46 per inbox per day; 6 inboxes: $0.60 to $2.80 per day. Not measured: `claude` is signed out, so every live call failed.

| Pass                                       | modelCalls      | costUsd | Rules / model | Asks | Drafts      |
| ------------------------------------------ | --------------- | ------- | ------------- | ---- | ----------- |
| A: offline stub (`emailCmd`, CLI flags)    | 24              | 0       | 36 / 24       | 2    | 0 (dry run) |
| B: live `claude -p` (Haiku)                | 0 ok, 24 errors | 0       | 36 / 24       | 26   | 0           |
| C: label oracle (perfect model), drafts on | 24 + 5 drafts   | 0       | 36 / 24       | 11   | 5           |

## Classes (pass C)

| Kind                                               | n   | Right    | Wrong                                                                          |
| -------------------------------------------------- | --- | -------- | ------------------------------------------------------------------------------ |
| Newsletter, GitHub, calendar, cold mail, human ask | 41  | 41       | GitHub review requests and SSH key alerts go quiet as newsletter               |
| Receipt                                            | 10  | 8        | 2 newsletter (`List-Unsubscribe` wins over receipt)                            |
| Sensitive                                          | 3   | 2        | Lab results from a gmail doctor go to the model                                |
| Injection                                          | 2   | 1        | 1 quiet as receipt (subject has "invoice"); 1 flagged, not drafted             |
| Human FYI                                          | 4   | 3        | 1 receipt (subject has "Shipped")                                              |
| Total                                              | 60  | 55 (92%) | Rules: 32 of 36 (89%). Model accuracy: not measured. 5 drafts, all human asks. |

## Blockers and guard

1. `--offline` and `--all` are missing from `BOOLEAN_FLAGS` (`src/cli/args.ts`). `email run --dry-run --offline --fixture f.json` and `email run --all` exit 2. The launchd plist runs `email run --all`, so the schedule never runs.
2. A signed-out model fails open. Each failed call becomes a "Could not classify" ask, exit 0. Pass B made 24 junk asks; at 150 messages per day, about 60 per inbox. Fail the pass (exit 4) when all model calls fail.

- Guard denies: send, sendMail, reply, replyAll, forward, createForward, createReplyAll, copy, DELETE, `%73end`, body PATCH, other hosts, and any move not approved in an answered ask (Archive or Junk only).
- Guard allows: GET, `createReply` (comment only), `categories` PATCH. The offline transport refuses every POST.

## Cost model (150 messages per inbox per day)

| Call                                          | Per day | Unit cost          | Low to high    |
| --------------------------------------------- | ------- | ------------------ | -------------- |
| Haiku classify (40% pass the rules)           | 60      | $0.0002 to $0.0006 | $0.01 to $0.04 |
| Sonnet escalation (15%, confidence below 0.6) | 9       | $0.0025 to $0.011  | $0.02 to $0.10 |
| Sonnet draft (8%), 30% redrafts on high       | 12.5    | $0.005 to $0.026   | $0.06 to $0.33 |

- Prompts: classify 1,514 chars, draft 2,357 chars (no learned voice), plus `claude -p` overhead. Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per MTok. Drafts are about 70% of cost. A plan login uses plan quota, not cash.
- Next: fix the blockers, run `claude` login, rerun pass B to measure cost, model accuracy and injections.
