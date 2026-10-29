---
id: quick-triage
title: Quick triage
author: flanakin
description: "An agent asks a few priority questions one at a time; the owner answers one line each or taps the suggested default; the task files update at once."
dependencies: [ask-queue, task-lifecycle, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Quick triage

## Purpose

Mirror the triage Michael did by hand in chat (Oct 29): the agent asks "what is top of mind?", then one decision per item (draft the denial, accept all, archive, add a deadline). He answers one line each, or taps the default. Every answer lands in the task files immediately; the agent never has to come back to apply it.

## Scope

- In: flow fields on asks (`flow`, `seq`, `ref`, `apply`, `applies`), Stack applying the owner's answer to the task row, a stepper in Needs you, CLI flags.
- Non-goals: the agent that writes the questions (any agent, via `stack asks put` or the api), model calls, undo of actions Stack cannot reverse.

## Scenarios

### FR:flow: Flows of questions

- **FR:flow.fields** (P1): An ask may carry `flow` (a slug, same charset as a key), `seq` (1-99, the question's place in the flow), `ref` (a task ref `project:line`; the row must exist when the ask is put), `apply` (one action line, see `FR:flow.actions`) and `applies` (one action per option, `a | b | c`, the same count as `options`, `-` for none). They round-trip through the file format; a bad value is dropped on parse like any other bad field, and refused on put (`422`)
- **FR:flow.actions** (P1): An action line is one of `set <prop>=<value>[ <prop>=<value>…]` (priority, status, effort, impact, checkbox, with the api `set` vocabulary), `due <Mon d>[, yyyy]` (sets the 📅 date), `suspend <n>d|<n>h`, `skip`, `complete`, `start`, `resume`, or `note <text>` (appends `> <text>` under the row). Anything else is `422 invalid` at put time
- **FR:flow.apply** (P1): When the owner answers `go` Stack runs `apply`; on `option` it runs the matching `applies[i]`; on `no`, `reply`, `ask`, `defer` nothing runs. The answer is recorded, then the action runs through the lifecycle as the owner on the row `ref` names; if that row moved (a note or a new row above it) it is found again by the text remembered at put time, as long as that text is unique in the file. A failed action (row gone or changed) reopens the ask, whatever state the agent left it in, drops the owner's reply line, writes `- <iso> failed: <action> (<reason>)` to the thread and returns `409 Conflict`, so a retry runs the action once. A successful action writes `- <iso> applied: <action> → <row text after>` (or `(<lifecycle message>)` when it changed nothing). An agent acts on `applied:` only: an `answered` ask without it is still in flight or has failed
- **FR:flow.text** (P1): For kind `answer` with a `ref`, the owner's text is appended under that row as `> 🙋 <date>: <text>` (same write), so the answer lives in the task file, not only in the ask
- **FR:flow.order** (P1): Open asks that share a `flow` are listed consecutively by `seq`, at the position of the flow's best-scored ask. Each listed ask in a flow carries `flow`, `seq`, `flowTotal` (asks in the flow, any state) and `flowDone` (answered or done)

### FR:api: Api and CLI

- **FR:api.put** (P1): `POST /asks/{key}` accepts the flow fields with the agent fields (ask-queue `FR:api.put`); `GET /asks` returns them (`FR:flow.order`)
- **FR:cli.put** (P1): `stack asks put … [--flow slug --seq n --ref project:line --apply "<action>" --applies "a|b|c"]`

### FR:web: The stepper

- **FR:web.stepper** (P1): In Needs you a flow shows as one card: eyebrow `Quick triage · n of m · <from>`, a progress bar, the question, `why` under it, the suggested default as the primary (`Enter`), options `1-4` (each with what it will do, from `applies`, in small text), a one-line box for `answer`. After an answer the next question of the flow takes its place (no cursor jump); the toast says what changed (`Set priority: Critical · Pay bills`)
- **FR:web.undo** (P1): The toast says what changed (`Priority: Critical · Pay bills first?`). When nothing was applied, Undo (8 s, `u`) takes the answer back as for any ask; when an action was applied the toast offers no Undo (the row shows the change and can be edited there)
- **FR:web.done** (P1): After the last question of a flow the toast reads `Triage done · n answered` and the list returns to normal
- **FR:web.mobile** (P1): On a phone the options stack in the thumb zone (44 px each, default first); the question stays readable without scrolling at 390 px
