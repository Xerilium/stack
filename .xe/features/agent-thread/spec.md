---
id: agent-thread
title: Agent Thread
author: flanakin
description: "Per-task conversation with an agent: ask or assign, read replies and questions, see added subtasks"
dependencies: [agent-team, agent-sessions, agent-inbox, ask-queue, ai-triage-assist, api, auth-security, web-app, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Thread

## Purpose

Give every task one place to talk with its agent. The owner asks or hands the task over, and the agent's replies, questions, and subtasks come back on the task itself. The feature ends at the task: projects and cross-task chat live elsewhere.

## Scenarios

### FR:ask: Asks belong to tasks

Owner needs to see the questions an agent raised about a task on that task so that they answer them in context.

- **FR:ask.cli** (P1): Interface: `stack asks put --ref tasks/<file>.md:<line>` (1-based) and `POST /asks/{key}` `{ref}` (0-based api ref)
- **FR:ask.ref** (P1): Ask store MUST accept an optional `ref` (`<project>:<line>`) on an ask
  - **FR:ask.ref.validate** (P1): `putAsk` MUST return 404 when `ref` names no existing row
  - **FR:ask.ref.list** (P1): `listAsks` MUST return `ref` in api form
  - **FR:ask.ref.follow** (P1): `currentRows` MUST follow a moved row the way inbox entries do
  - **FR:ask.ref.source** (P1): Review needs and permission asks raised by a task session MUST set `ref`
    > - @req FR:agent-team/review.needs
    > - @req FR:agent-team/talk.start
- **FR:ask.card** (P1): Ask card MUST show the task title as a link that opens the task in focus mode

### FR:reply: Agent replies

Owner needs the agent to answer on the task, not only in a chat transcript, so that the answer is findable later.

- **FR:reply.@api** (P1): Interface: `POST /inbox/reply` `{ref, text, expect?}` (route `inbox.reply`, scope `tasks:write`) and `stack inbox reply <ref> --from <agent> --text`
- **FR:reply.entry** (P1): Inbox store MUST give entries a `from` of `owner` or `agent`, defaulting to `owner` for v1 files
  - **FR:reply.entry.write** (P1): Reply route MUST append an entry with `from: agent`, `kind: reply`, `to: human`, and `agent: <token name>`
  - **FR:reply.entry.token** (P1): Reply route MUST return 403 to the owner session so the page never writes in the owner's voice
  - **FR:reply.entry.handled** (P2): Inbox store MUST NOT require the owner to handle agent entries
- **FR:reply.session** (P1): Task session persona MUST tell the agent to answer with `stack inbox reply` and raise questions with `stack asks put --ref`
  > - @req FR:agent-team/talk.start

### FR:thread: The thread

Owner needs to ask an agent about a task or assign it so that the agent answers and adds subtasks on that task.

- **FR:thread.@api** (P1): Interface: `GET /tasks/{ref}/thread` (route `tasks.thread`, scope `tasks:read`)
- **FR:thread.read** (P1): Thread route MUST return `{items, session?, review?}` with `items` in time order and 404 for an unknown ref
  - **FR:thread.read.items** (P1): Each item MUST carry `at` and a `kind` of `owner`, `agent`, `ask`, `review`, or `subtask`. An owner item the owner withdrew carries `withdrawn: true` (`FR:agent-inbox/inbox.withdraw`)
  - **FR:thread.read.subtask** (P2): Thread route MUST list a child row as `subtask` when its text carries 🤖 or 🪄
  - **FR:thread.read.session** (P2): Thread route MUST return the task's newest session with its state
  - **FR:thread.read.review** (P2): Thread route MUST return the newest review verdict
    > - @req FR:agent-team/review.needs
- **FR:thread.ask** (P1): Composer Ask MUST send the text to the task's idle live session when its title starts with the chosen agent's name, else start a new session
  - **FR:thread.ask.inbox** (P1): Composer Ask MUST also write the text to the inbox as `kind: reply` so the thread shows it at once
    > - @req FR:agent-inbox/api.send
  - **FR:thread.ask.persona** (P2): Resumed-session prompt MUST include the persona again
- **FR:thread.assign** (P1): Composer Assign MUST claim the row for the chosen agent and start a session with the assign prompt
  - **FR:thread.assign.refuse** (P1): Composer Assign MUST refuse a 🙋 row
  - **FR:thread.assign.order** (P1): Assign MUST start the run before claiming so a failed start leaves no 🚧
  - **FR:thread.assign.claimed** (P2): Assign on a claimed row MUST start a new session for the chosen agent and keep the claim
  - **FR:thread.assign.prompt** (P2): Assign prompt MUST tell the agent to add 🤖 subtasks first, then raise every question as an ask with `--ref`, then start
    > - @req FR:ai-triage-assist/claim.start

### FR:web: Thread in the expanded task

Owner needs to read and drive the thread where the task is shown so that they never leave the list to talk to an agent.

- **FR:web.expand** (P1): Expanded task MUST show the thread below notes and subtasks, newest last, with the composer's `Ask` (`Enter`) and `Assign` (`A`) below it
- **FR:web.hero** (P1): Home hero and Focus mode MUST show the same thread under the actions
- **FR:web.live** (P1): Thread MUST refresh on `asks`, `tasks`, and `sessions` changes from `/events`
  - **FR:web.live.working** (P2): Composer MUST show `Working…` with a link to the drawer while the task's session runs
- **FR:web.keys** (P1): Expanded task MUST focus the composer on `a` and assign on `A`, and only when focus is not inside the composer's text box or agent picker
  - **FR:web.keys.ask** (P2): Expanded task MUST take an ask entry's primary action on `Enter`
  - **FR:web.keys.palette** (P2): Palette and `?` MUST list every thread action
- **FR:web.a11y** (P1): Thread MUST be a labelled list with one polite status line for the newest agent reply
  - **FR:web.a11y.touch** (P2): Thread targets MUST be at least 44 px on touch
  - **FR:web.a11y.contrast** (P2): Thread text MUST have contrast of at least 4.5:1 in light and dark
  - **FR:web.a11y.width** (P2): Thread MUST work at 390, 1024, and 1440 px

## Data Model

- **FR:$thread-item** (P2): **Thread item** — One entry in a task thread.
  - `at` (string) — ISO timestamp
  - `kind` (string) — Allowed: owner, agent, ask, review, subtask
  - `text` (string?) — Owner or agent text, or subtask text
  - `agent` (string?) — Agent name for `agent` and `review` items
  - `ref` (string?) — Child row ref for `subtask` items
  - `done` (boolean?) — Subtask state

## Architecture Constraints

- Replies, asks, and rows MUST live in the task repo, never in chat alone

## External Dependencies

None
