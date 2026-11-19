---
id: pr-chat
title: PR Chat
author: flanakin
description: "Talk to an agent about one PR in its details pane, with the reply streamed token by token."
dependencies: [pr-page, agent-sessions, acp-driver, ui-kit, auth-security]
---

<!-- markdownlint-disable single-title -->

# Feature: PR Chat

## Purpose

The owner needs to ask an agent about a PR, or tell it what to change, from the PR details so that he does not find a terminal or a session window. The reply must feel as fast as Claude Desktop: text shows as the agent writes it.

## Scope

- In: one agent session per PR, the PR chat routes, the stream to the page, the chat in the PR details pane, the shared `ChatPanel` component.
- Out: the driver and its stream (`FR:agent-sessions/run.*`, `FR:acp-driver/*`), permission asks (`FR:agent-sessions/perm.*`), the sweep itself, GitHub writes. The chat never merges, approves, closes, or un-drafts a PR (`FR:pr-page/act.never`).

## Terms

- **PR session**: the one agent session Stack keeps for a PR. Its key is `<owner>/<repo>#<n>` (no case).
- **Checkout**: the folder the agent runs in: the first git checkout of the repo under the configured roots (`FR:agent-delivery/run.cwd`), else none.

## Scenarios

### FR:session: One session per PR

The owner needs each PR to keep its own conversation so that the agent remembers what was said.

- **FR:session.map** (P1): `<home>/pr/<owner>/<repo>/<n>.chat.json` holds `{sessionId, agent, cwd, at}` (`<home>` as `FR:pr-page/check.file`). It is written when the first prompt reports its session id. A bad file is no session
- **FR:session.start** (P1): The first message starts a new session (`FR:agent-sessions/run.prompt`, `POST /sessions`) in the Checkout. The prompt is a short persona, then the PR context, then the owner's text. Context: the PR url, title, head branch, next action, the live check file (`FR:pr-page/check.*`) when present, and the open sign-off threads (paths and asks, from `FR:pr-page/detail.data`). No PR body or diff is sent; the agent reads them with its own tools
- **FR:session.resume** (P1): Each later message resumes the PR session (`POST /sessions/{id}/prompt`) with the owner's text only
- **FR:session.none** (P1): With no Checkout, the chat says `No checkout of <repo> on this host.` and has no composer
- **FR:session.agent** (P1): The agent is Claude through the SDK driver by default. Config `prChat.agent` may name an ACP agent command (`FR:acp-driver/conn.spawn`); both speak the same driver vocabulary, so the page does not change
- **FR:session.new** (P2): `New chat` drops the map entry; the next message starts a new session. The old session stays in Agents

### FR:api: Routes

The page needs owner-only routes keyed by PR so that it never handles session ids it did not get from Stack.

- **FR:api.get** (P1): `GET /prs/chat?repo=&number=` (route `prs.chat.get`, scope `tasks:read`, owner only) returns `{sessionId?, agent, cwd?, running, turns}`. `turns` are the last 30 turns of the session (`FR:agent-sessions/sessions.messages`). The PR must be on the board, else `404`
- **FR:api.send** (P1): `POST /prs/chat` `{repo, number, text}` (route `prs.chat.send`, scope `tasks:write`, owner only; a token gets `403`) starts or resumes the PR session. `text` is 1-4000 characters. Reply `202 {runId, sessionId?}`. A run in flight answers `409` (`SessionBusy`)
- **FR:api.cancel** (P1): `POST /prs/chat/cancel` `{repo, number}` cancels the run in flight (`FR:agent-sessions/run.cancel`)
- **FR:api.repos** (P1): The PR must be on the owner board and its repo pass `FR:pr-page/api.repos`, else `403`

### FR:stream: Streamed reply

The owner needs the reply to show as it is written so that the chat feels live.

- **FR:stream.sse** (P1): The page opens `GET /sessions/{id}/events` (`FR:agent-sessions/run.events`) as soon as the send returns a session id, and for a run in flight when the chat opens. No polling: the page reads only the stream, and reloads `turns` once after `done`
- **FR:stream.chunks** (P1): Each `message_chunk` (`assistant`) appends its text to the open reply at once. The page batches paint to one per animation frame; it never waits for the full reply
- **FR:stream.latency** (P1): The first token shows within 100 ms of its arrival on the host (local host, measured in e2e with a fake driver)
- **FR:stream.tools** (P2): `tool_call` and `tool_update` show as one muted line each (`Reading src/a.ts`, then `done`), as shared `Flag`s, not as controls
- **FR:stream.perm** (P1): A `permission` update shows the request title with the agent's options as buttons. The answer goes through the existing ask (`FR:agent-sessions/perm.answer`), so the same ask also shows in Needs you
- **FR:stream.end** (P1): `done` closes the stream. `cancelled` shows `Stopped.`; `error` shows the redacted error and `Try again`; `max_budget` shows `Budget reached.`
- **FR:stream.reconnect** (P1): A dropped stream reopens once after 1 s; the host replays the buffered updates (`FR:agent-sessions/run.events`), so no text is lost or shown twice (the page keeps the count of chunks it applied)

### FR:ui: Chat in the details pane

The owner needs the chat next to the facts for the PR so that he asks without losing his place.

- **FR:ui.place** (P1): The PR details pane (`FR:pr-page/detail.*`) ends, after Quick actions, with a `Chat` section: the turns, newest last, then the composer. On a phone it is in the same full-screen details view
- **FR:ui.component** (P1): The chat is the shared `ChatPanel` (`FR:ui-kit/chat`, added with this feature): turns, the streaming reply, tool lines, permission buttons, a composer with Send and Stop. Other views can reuse it
- **FR:ui.compose** (P1): `Enter` sends, `Shift+Enter` makes a new line. Send is disabled while a run is in flight; `Stop` shows in its place and calls `FR:pr-chat/api.cancel`
- **FR:ui.a11y** (P1): The turns are a labelled log (`role=log`, `aria-live=polite`) that announces each finished reply once, not each chunk. Axe clean at 375 px and 1280 px, light and dark. Targets 44 px on touch
- **FR:ui.card** (P2): A card whose PR session has a run in flight shows the `Flag` `Agent replying`

## Architecture Constraints

- No new driver, transport, or stream: the chat is a thin layer over `agent-sessions` and the `AgentDriver` (SDK or ACP).
- The browser never gets a token or a cwd it did not ask for; routes are owner only and keyed by PR.
- `ChatPanel` lives in `web/src/ui/` with tests, like the rest of the shared set.

## Open questions

- Should the chat also post a summary to the PR as an `🤖 [AI]` comment when the owner asks? Default: no. The PR page writes to GitHub only through `FR:github-pr-status/write.*`.
