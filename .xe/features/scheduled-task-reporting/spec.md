---
id: scheduled-task-reporting
title: Scheduled Task Reporting
author: flanakin
description: "Scheduled CoS tasks send their status with `stack report` as the last step, with no LLM call."
dependencies: [status-ingest]
---

<!-- markdownlint-disable single-title -->

# Feature: Scheduled Task Reporting

## Purpose

Scheduled Chief of Staff (CoS) tasks run without the owner. Today each task prompt has its own copy of the report step. This feature gives one standard final step. Every scheduled task pastes it into its prompt. The step sends the run's status with `stack report` (`FR:status-ingest/cli.report`). The step makes no LLM call and adds no research, so it costs no extra tokens.

Agent guide: `docs/scheduled-reporting.md`.

## Scope

- In: the copy-paste final step, the rules for when and how to send, exit-code handling, host-down behavior, secret rules, one sample report per task type, the agent and project names of the current tasks.
- Out: new CLI flags or code (`stack report` already does all of this), a reports page (status-ingest chunk 2), edits to the task prompts in `~/.claude/scheduled-tasks` (the owner applies the block), a scheduler.

## Scenarios

### FR:step: Final step

A scheduled task needs one standard step so that every CoS task reports the same way and a fix lands in one place.

- **FR:step.block** (P1): `docs/scheduled-reporting.md` MUST have one copy-paste block for task prompts. Its first line starts with `FINAL STEP`. It runs `stack report --agent <agent> --project <project> --json` with the report JSON in a quoted heredoc (`<<'JSON'`), so the shell does not expand `$` or backticks
- **FR:step.last** (P1): The block MUST say that the report is the last step of the run. No tool call and no other work comes after it, except the retry and the answer save in `FR:step.exit` and `FR:step.answers`
- **FR:step.always** (P1): The block MUST say that the task sends a report on every run. A run that cannot do its main work still sends one, with the cause in `blockers`
- **FR:step.ids** (P1): The block MUST say that each ask `id` names one real item (for example `pr-130`) and stays the same across runs. A new item gets a new `id`. A date or run number is never an `id`

### FR:tokens: No LLM call

The owner needs the report to cost no extra tokens so that reporting does not grow the cost of each run.

- **FR:tokens.none** (P1): The guide MUST say that the report step calls no LLM. The task builds the JSON only from facts it already has in this run. It starts no subagent, no extra search, and no summary pass for the report. `stack report` makes no model call (`FR:status-ingest/cli.report`)
- **FR:tokens.lines** (P1): Each item is one short line of fact with a link when one exists. No prose, no greeting, no recap

### FR:exit: Exit codes and failures

A task needs a fixed response to each result so that a failed report does not start a long LLM loop.

- **FR:exit.codes** (P1): The block MUST map the exit codes of `FR:status-ingest/cli.errors`: `0` stored, stop; `2` bad input, fix only the fields named in `issues` and send once more; `1` busy or the host refused it, wait 5 s and send once more
- **FR:exit.stop** (P1): After one retry, or when `stack` is not found, the task prints one line `report failed: <error>` and stops. It never loops. The next run sends a new report
- **FR:exit.host** (P1): The guide MUST say that a host that is down needs no action. `stack report` then writes `~/.stack/reports.json` itself (`FR:status-ingest/cli.direct`), and the host shows it when it starts

### FR:answers: Owner answers

- **FR:answers.save** (P2): On exit `0`, when the result's `asks.answers` is not empty, a task with a state file saves the answers there for the next run. The task does not act on answers in the same run

### FR:secrets: No secrets

- **FR:secrets.none** (P1): The guide MUST say that a report never holds a secret: no token, key, password, webhook url, signed url, or url with a token in its query. It holds no personal data beyond names already public on the linked page. Links are plain `https` links to the item

### FR:samples: Samples

The owner needs a valid sample per task type so that a new task starts from a report that passes the schema.

- **FR:samples.types** (P1): The guide MUST have one sample report per task type: CoS daily check-in, and support report. Each sample MUST pass `parseReport` (`FR:status-ingest/schema.errors`)
- **FR:samples.tasks** (P1): The guide MUST list the agent and project of each current scheduled task: `f4-daily-checkin` (`f4-cos`, `f4`), `ftk-cos-daily-checkin` (`ftk-cos`, `ftk`), `ftk-support-report` (`ftk-support`, `ftk`)
- **FR:samples.run** (P1): The block, with a sample in its heredoc, MUST run as written and exit `0`

## Architecture Constraints

- No new code path: the guide uses `stack report` as merged in status-ingest
- The report step makes no LLM call

## External Dependencies

None

## Dependencies

- status-ingest (`stack report`, the schema, exit codes, host fallback)
