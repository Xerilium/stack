---
id: agent-thread
title: Agent Thread
author: flanakin
description: "Every task has one thread with its agent inside the expanded task: ask a question or assign the task, read the agent's replies, answer the questions it raises (asks), and see the subtasks it adds. Replies live in the task repo (inbox, asks, rows), never in chat."
dependencies: [agent-team, agent-sessions, agent-inbox, ask-queue, ai-triage-assist, api, auth-security, web-app, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: Agent Thread

## Purpose

The owner's biggest gap: talking to an agent about one task. He wants to ask a question or hand the task over, have the agent come back with questions and a breakdown, and see all of it on the task itself. `agent-team` gave every row an agent and a composer; this feature turns that into a thread inside the expanded task (the in-place expand from `web-shell`): the owner's messages, the agent's replies, the asks the agent raised for this task, the review verdict, and the subtasks the agent added, in time order, with the composer at the bottom.

## Scope

- In: a `ref` on asks so an ask belongs to a task; agent replies as inbox entries the agent writes (`from: agent`); the task thread read (`GET /tasks/{ref}/thread`); Ask and Assign on the composer (Assign claims the row and starts the agent); session resume per task (a follow-up goes to the task's live session when one exists, else starts one); the thread inside the expanded task on every view that expands rows; the thread on the Focus/hero block.
- Out: an unread count on the collapsed row's chip (next), Reassign / Release on a claimed row (next: the composer's agent picker plus Assign re-claims for now), run entries in the thread (the session state and the drawer show them), threads for projects or asks (the `agent-team` composer stays there), editing or deleting thread entries, threads across tasks, notifications beyond the existing ask notification.

## Scenarios

### FR:ask: Asks belong to tasks

- **FR:ask.ref** (P1): An ask may carry `ref` (`<project>:<line>`, 0-based like the api, stored as `tasks/<project>.md:<line+1>` in the file like inbox refs). `putAsk` validates it against an existing row (404 when missing); `listAsks` returns it as the api ref; `currentRows` follows a moved row like inbox entries. Review needs (`FR:agent-team/review.needs`) and permission asks raised by a task session (`FR:agent-team/talk.start`: the session title carries the ref) set it
- **FR:ask.cli** (P1): `stack asks put --ref tasks/<file>.md:<line>` (1-based, like every CLI ref) and `POST /asks/{key}` `{ref}` (api form) set it; the ask card shows the task title as a link that opens the task (focus mode, which carries the thread)

### FR:reply: Agent replies

- **FR:reply.entry** (P1): Inbox entries gain `from` (`owner` or `agent`, default `owner` for v1 files). `POST /inbox/reply` `{ref, text, expect?}` (route `inbox.reply`, scope `tasks:write`, tokens only: the owner session gets 403, so a reply is never written in the owner's voice by the page) appends an entry `from: agent`, `kind: reply`, `to: human`, named by the token (`agent: <token name>`). `stack inbox reply <ref> --from <agent> --text` writes it without a server. Agent entries are never "handled" by the owner; reading the thread is enough
- **FR:reply.session** (P1): The task session's persona (`FR:agent-team/talk.start`) tells the agent to answer the owner with `stack inbox reply` (or `POST /inbox/reply`) and to raise questions with `stack asks put --ref`, never in the chat transcript alone; the transcript stays available in the drawer

### FR:thread: The thread

- **FR:thread.read** (P1): `GET /tasks/{ref}/thread` (route `tasks.thread`, scope `tasks:read`) returns `{items, session?, review?}`: `items` in time order, each `{at, kind, ...}` with `kind` one of `owner` (an inbox entry from the owner: `text`, `state`), `agent` (an inbox entry from the agent: `agent`, `text`), `ask` (an open or answered ask with this `ref`: the listed ask fields), `review` (`verdict`, `plan`, `estimate`, `agent`), `subtask` (a child row an agent owns: `ref`, `text`, `done`; a child whose text carries 🤖 or 🪄, which is how the assign prompt tells the agent to add its subtasks); `session` is the task's newest session (`FR:agent-team` title suffix) with its state; `review` is the newest verdict. Unknown ref is 404
- **FR:thread.ask** (P1): Ask sends the text to the task's live session when one exists and is idle (`POST /sessions/{id}/prompt`), else starts one (`POST /sessions {ref, text}`); the owner's text is also written to the inbox (`FR:agent-inbox/api.send`, `kind: reply`) so the thread shows it at once and an agent that is not running still finds it
- **FR:thread.assign** (P1): Assign claims the row for the agent (`FR:ai-triage-assist/claim.start`: 🚧 on the row, the claim logged for `agent:<slug>`; a 🙋 row is refused) and starts the session with the assign prompt: flesh out the subtasks under this row first (each marked 🤖 so the thread shows them), then raise every question as an ask with `--ref`, reply on the task, start. Assign on a row already claimed re-claims it for the chosen agent

### FR:web: Thread in the expanded task

- **FR:web.expand** (P1): The expanded task (web-shell inline expand) shows, under the notes and subtasks, the thread: compact entries (`You · 5m ago`, `🎧 Cid Manager · 2m ago`, an ask as a mini card with its primary action and Reply, a review verdict line, `Added 3 subtasks`), newest last, then the `agent-team` composer with `Ask` (`Enter`) and `Assign` (`A`) in place of Do it / Plan (Review stays).
- **FR:web.hero** (P1): The Home hero and Focus mode show the same thread under the actions
- **FR:web.live** (P1): The thread refreshes on `asks`, `tasks`, and `sessions` changes from `/events`; while the task's session runs, the composer shows `Working…` with the drawer one click away, and an agent reply fades in like a new ask
- **FR:web.keys** (P1): In the expanded task `a` focuses the composer, `A` assigns, `Enter` on an ask entry takes its primary action; every action is in the palette and `?`
- **FR:web.a11y** (P1): The thread is a labelled `log` region (`aria-live="polite"` for agent entries only), entries have full labels, 44 px targets on touch, contrast at least 4.5:1, light and dark designed, works at 390 / 1024 / 1440 px

## Dependencies

- agent-team (composer, chip, sessions by title), agent-sessions (prompt, drawer), agent-inbox (inbox entries, moved-row matching), ask-queue (asks, answers), ai-triage-assist (claim, result log), web-shell (inline expand surface)
