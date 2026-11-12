---
id: ask-briefs
title: Ask Briefs
author: flanakin
description: "Every approve or decide ask carries a short brief (problem, solution, risks, recommendation, evidence). Without one the owner sees No context yet and asks the agent for it. References link to GitHub everywhere."
dependencies: [ask-queue, status-ingest, pr-page, web-app, desktop-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Ask Briefs

## Purpose

The owner cannot approve what he cannot see. Asks such as "Apply Autopilot to PR 130" arrive with no context and no link on the number. This feature adds a brief to each approve or decide ask, so the owner decides on the card without opening the PR. An ask with no brief never offers `Go with it` as the main action: the main action asks the agent for context. Every PR reference in rendered text is a link. Issue: Xerilium/stack#152 section C.

Agent contract: `docs/asks.md` (ask files), `docs/report.md` (reports).

## Scope

- In: the brief schema and its check; the brief on ask files (`asks.put`, `stack asks put`), report asks (`stack report`, `reports.put`), Chief of Staff items (`.stack/needs-you.json`) and PR escalations; the brief and `No context yet` on Now, Needs you and the PR page; `Ask <agent> for context`; `Go with it anyway` behind a confirm; reference links in asks, briefs, threads and task text; the lint warning; agent docs.
- Out: briefs on 🙋 task rows and quick triage questions (the owner's own row is the context), PR priority recommendations and blocked live checks (they carry their own reason), a model writing briefs for agents.

## Scenarios

### FR:brief: Brief data

- **FR:brief.validate** (P1): `checkBrief(raw)` accepts only `problem`, `solution`, `risks`, `recommendation`, `evidence` (@req FR:$brief). `problem`, `solution`, `recommendation` are required single lines of 1-400 characters; `risks` lists 1-5 such lines; `evidence` lists 0-5 `https` urls. The text fields hold at most 120 words in all and at most 25 words per sentence (Simplified Technical English). It returns every issue as `{field, message}` (for example `asks[0].brief.risks`)
- **FR:brief.store** (P1): An ask file keeps the brief under `## Brief` (before `## Detail`) as `- problem:`, `- solution:`, one `- risk:` per risk, `- recommendation:`, one `- evidence:` per link. Parsing drops a brief that no longer passes the check. Brief text is cleaned like other ask fields (`FR:ask-queue/ask.safe`)
- **FR:brief.api** (P1): `POST /asks/{key}` takes `brief`; a bad brief is `422` with every issue. An update without `brief` keeps the stored one. `GET /asks` returns it on each item. The OpenAPI document has a `Brief` schema
- **FR:brief.cli** (P1): `stack asks put … --brief-file <brief.json>` reads the brief as JSON
- **FR:brief.report** (P1): A report ask takes an optional `brief`; a bad brief fails the report with the issue paths (`FR:status-ingest/schema.errors`)
- **FR:brief.needs** (P1): `GET /needs-you` returns, for each report ask, `from` (the agent), `askKind`, and `brief`. A Chief of Staff item may carry `from`, `askKind` (default `approve`) and `brief`; a bad brief is left out and the item still shows
- **FR:brief.pr** (P1): A PR escalation entry (`escalations.blockedAutopilot[]`) may carry `brief`. `stack pr-pri escalate` rejects a bad brief with its issue paths; reading the set drops a bad one and keeps the entry
- **FR:brief.lint** (P1): `stack report` stores an `approve` ask with no brief, exits 0, and prints one line per ask: `warning: asks <id> (approve) has no brief: …` (`warnings` with `--json`). `stack asks put` prints the same warning for an `approve` or `decide` ask with no brief

### FR:context: Ask for context

- **FR:context.need** (P1): `POST /needs-you/{id}/answer` takes `choice: context` for report asks and Chief of Staff items (`400` for PR priority recommendations and live checks). It is stored like other answers and returned to the agent in the next report result (`FR:status-ingest/asks.result`). The page hides an item answered `context` until the item has a brief, then shows it again

### FR:web: Cards

- **FR:web.brief** (P1): The expanded ask on Now (Waiting on you) and Needs you shows the brief as a labelled list: Problem, Proposed solution, Risks (one bullet each), Recommendation, and Evidence (links that open a new tab)
- **FR:web.none** (P1): An agent ask of kind `approve` or `decide` (a need: `askKind`, default `approve`) with no brief shows `No context yet. <agent> sent no brief.` A Needs you row says `No context` instead of its action
- **FR:web.context** (P1): Such an ask has one primary action, `Ask <agent> for context` (`Enter`, and the collapsed Now card's one button). It sends the fixed text `Send a brief before I decide: …` through the ask's own token-free channel: an ask file gets answer `ask` (wake file), a need gets `context`. The toast says `Asked <agent> for context` with Undo
- **FR:web.anyway** (P1): `Go with it anyway` (decide: `Go with "<option>" anyway`, only when an option is recommended) has no key. The first tap arms it and shows `Confirm: no context` (focused) and Cancel; Esc or Cancel disarms; only the second tap sends the answer
- **FR:web.pr** (P1): On the PR page Escalation set, a decision shows its brief, or `No context yet` with `Ask for context` (records the fixed text as the answer for the Sweep Manager) and `Accept anyway` behind the same confirm

### FR:link: References as links

- **FR:link.refs** (P1): `autolink(text, {repo, repos})` is pure. It links full `https` urls, `owner/repo#123`, `#123`, `PR 123`, `PR #123`, `<alias> 123` and `<alias> PR 123` (for example `FH 1105`). `PR` forms link to `/pull/<n>`, the others to `/issues/<n>` (GitHub redirects). Trailing punctuation stays text. A reference with no repo stays plain text
- **FR:link.repo** (P1): A bare `#123` or `PR 123` takes the repo of the ask's GitHub link, else of its project. Aliases come from the project map: each project's name and `Aliases` (never its title) to its `Repository` (or `Repo`) metadata (a markdown link, url, or `owner/repo`)
- **FR:link.web** (P1): Asks (title, why, recommendation, agent reply), briefs, thread lines, task markdown and PR escalation context render references as links with `target="_blank"` and `rel="noopener noreferrer"`; the desktop app opens them in the browser (`FR:desktop-shell` window policy). Text inside a button stays plain (no nested controls)

## Data Model

- **FR:$brief** (P1): **`Brief`** — Context for one approve or decide ask.
  - `problem` (string) — what is wrong or needed
  - `solution` (string) — the proposed change
  - `risks` (string[]) — 1-5 risks or cons
  - `recommendation` (string) — what the agent recommends and why
  - `evidence` (string[]?) — 0-5 `https` links

## Architecture Constraints

- No LLM call: agents write briefs; Stack only checks and shows them

## External Dependencies

None

## Dependencies

- ask-queue (ask files, Needs you), status-ingest (reports), pr-page (escalations), web-app (cards), desktop-shell (external links)
