# Email triage cost report

- Build `8d51a83` (main), 60 synthetic messages (`tests/fixtures/email-cost/`), no mailbox, sign-in or secrets. Do not connect inboxes yet: fix the 3 blockers first. Estimated cost: $0.10 to $0.46 per inbox per day; 6 inboxes: $0.60 to $2.80 per day. Not measured: `claude` is signed out, so every live call failed.

| Pass                                       | modelCalls      | costUsd | Rules / model | Asks | Drafts      |
| ------------------------------------------ | --------------- | ------- | ------------- | ---- | ----------- |
| A: offline stub (`emailCmd`, CLI flags)    | 24              | 0       | 36 / 24       | 2    | 0 (dry run) |
| B: live `claude -p` (Haiku)                | 0 ok, 24 errors | 0       | 36 / 24       | 26   | 0           |
| C: label oracle (perfect model), drafts on | 24 + 5 drafts   | 0       | 36 / 24       | 11   | 5           |

## Classes (pass C)

| Kind                                       | n   | Right    | Errors                                                                   |
| ------------------------------------------ | --- | -------- | ------------------------------------------------------------------------ |
| Newsletter, calendar, cold mail, human ask | 31  | 31       | None. 5 drafts, all on human asks.                                       |
| GitHub                                     | 10  | 8        | A review request and an SSH key alert get the newsletter class (no ask)  |
| Receipt                                    | 10  | 8        | 2 get the newsletter class (`List-Unsubscribe` is checked first)         |
| Sensitive                                  | 3   | 2        | Lab results from a gmail doctor go to the model                          |
| Injection                                  | 2   | 1        | 1 gets the receipt class (subject has "invoice"); 1 flagged, not drafted |
| Human FYI                                  | 4   | 3        | 1 gets the receipt class (subject has "Shipped")                         |
| Total                                      | 60  | 53 (88%) | Rules: 30 of 36 (83%). Model accuracy: not measured.                     |

## Blockers and guard

1. `--offline` and `--all` are missing from `BOOLEAN_FLAGS` (`src/cli/args.ts`). `email run --dry-run --offline --fixture f.json` and `email run --all` exit 2. The launchd plist runs `email run --all`, so the schedule never runs.
2. A model login failure makes asks, not an error. Each failed call becomes a "Could not classify" ask, exit 0. Pass B made 24 such asks; at 150 messages per day, about 60 per inbox. Stop the pass (exit 4) when all model calls fail.
3. Privacy: the sensitive rule reads only the sender address (`src/email/rules.ts`). Medical, legal or payroll mail from a plain address goes to the model.

- Guard denies: send, sendMail, reply, replyAll, forward, createForward, createReplyAll, copy, DELETE, `%73end`, body PATCH, other hosts, and a move not approved in an answered ask (Archive or Junk only). Guard allows: GET of messages, `createReply` (drafts mode, comment only), `categories` PATCH (not in observe mode). The offline transport refuses every POST.

## Cost model (150 messages per inbox per day)

| Call                                                    | Per day | Unit cost          | Low to high    |
| ------------------------------------------------------- | ------- | ------------------ | -------------- |
| Haiku classify (24 of 60 pass the rules)                | 60      | $0.0002 to $0.0006 | $0.01 to $0.04 |
| Sonnet escalation (15%, confidence below 0.6)           | 9       | $0.0025 to $0.011  | $0.02 to $0.10 |
| Sonnet draft (5 of 60); high unit includes 30% redrafts | 12.5    | $0.005 to $0.026   | $0.06 to $0.33 |

- Prompts: classify 1,514 chars, draft 2,357 chars (no learned voice); `claude -p` overhead not measured. Anthropic list prices (2026-10-06): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per MTok. Drafts are 64% to 71% of cost. A plan login uses plan quota, not cash.
- Next: fix the blockers. Add a flag to run a real model on a fixture (`--offline` always uses the stub; a dry run never drafts). Then run `claude` login and measure cost, model accuracy and injections.
