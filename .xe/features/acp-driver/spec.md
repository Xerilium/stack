---
id: acp-driver
title: ACP Agent Driver
author: flanakin
description: "Drive any Agent Client Protocol agent (Gemini CLI, Codex, Copilot) from the Stack host over stdio, with permission requests as asks"
dependencies: [agent-sessions, ask-queue, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: ACP Agent Driver

## Purpose

Stack drives Claude through the Claude Agent SDK. Other agents (Gemini CLI, Codex, Copilot) speak the Agent Client Protocol (ACP): JSON-RPC 2.0 over a subprocess's stdio. This feature adds an `AgentDriver` for them so the Stack host is an ACP client. It is the first slice of the Stack app (`.xe/features/stack-app/research-architecture.md`, "Smallest first slice").

## Scope

- In: `createAcpDriver` (spawn, `initialize`, `session/new`, `session/prompt`, `session/update` stream, `session/request_permission` as asks, `session/cancel`, clean shutdown), the `stack agent run` command, a fake ACP agent for tests.
- Out: Claude through ACP (stays on the SDK driver), ACP over HTTP or WebSocket (drafts), agent file-system and terminal methods (the client does not advertise them), session list and resume across processes, auth flows (each agent owns its login), UI changes, Electron.

## Protocol

- SDK: `@agentclientprotocol/sdk` `2.4.0`, stable v1 entrypoint (ACP `protocolVersion` 1). It is ESM-only: the driver loads it with a native `import()` on first use (`src/agents/acp-sdk.ts`), never at import time. Tests mount that loader on the CommonJS build the test runner makes of the SDK.
- Transport: stdio, newline-delimited JSON-RPC (`ndJsonStream`).
- The driver is a client. It advertises no `fs` and no `terminal` capability, so the agent must use its own tools and ask for permission.

## Scenarios

### FR:conn: Connection

- **FR:conn.spawn** (P1): `createAcpDriver({command, args?, cwd?, env?, loadSdk?, spawn?, startTimeoutMs?})` starts the agent on the first `prompt`, not at creation. The child gets stdio pipes, no shell, and an environment limited to an allow-list (`PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `SHELL`, `XDG_*`, `NODE_PATH`, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`) plus the `env` passed in. Stack tokens (`GH_TOKEN`, `GITHUB_TOKEN`, Graph and Anthropic keys) are never inherited
- **FR:conn.init** (P1): After spawn the driver sends `initialize` (`protocolVersion` 1, `clientInfo` `stack`, no fs or terminal capability) and keeps the agent's capabilities. It fails with `AcpError` when the agent answers with a version the driver does not support, does not answer within `startTimeoutMs` (default 30 s), or exits first
- **FR:conn.session** (P1): The first prompt without `sessionId` calls `session/new` (`cwd` absolute, `mcpServers: []`) and emits `{type: 'session', sessionId}`. A prompt with a `sessionId` the driver created in this process reuses it. An unknown `sessionId` is `AcpError` (no `session/load` in this slice)
- **FR:conn.close** (P1): `close()` cancels runs in flight, ends the connection, closes the child's stdin, waits up to `killAfterMs` (default 2 s) for exit, then sends `SIGTERM`, then `SIGKILL`. It is idempotent and leaves no child process or pending timer. A child that exits on its own fails the runs in flight with `done.stopReason: 'error'`

### FR:run: Prompting

- **FR:run.prompt** (P1): `prompt({sessionId?, cwd?, text, onPermission})` returns a `Run` at once; its `updates` stream until `done`. It sends `session/prompt` with one text block. A second prompt to a session with a run in flight is `SessionBusy`
- **FR:run.updates** (P1): `session/update` maps to the driver vocabulary: `agent_message_chunk` text to `message_chunk` (`assistant`), `tool_call` to `tool_call`, `tool_call_update` to `tool_update` (text content joined into `output`), other update kinds are ignored. Unknown tool kinds map to `other`. The `session/prompt` response ends the run with `done`: `end_turn` stays `end_turn`, `cancelled` stays `cancelled`, `max_tokens`, `max_turn_requests` and `refusal` map to `error` with the ACP reason in `error`. `done.text` is the joined assistant text. `done.cost` is `{usd: 0, tokens: 0}` (ACP v1 reports none)
- **FR:run.cancel** (P1): `cancel(runId)` sends `session/cancel` and resolves `true` when the run was in flight. Pending permission requests of the run are answered `cancelled`. The run ends with `done.stopReason: 'cancelled'`
- **FR:run.errors** (P1): A JSON-RPC error from `session/prompt` ends the run with `done.stopReason: 'error'` and a redacted one-line `error`; the stream never throws

### FR:perm: Permissions

- **FR:perm.ask** (P1): `session/request_permission` calls `onPermission` with `{requestId, callId, tool, title, input, options}` (options keep ACP `optionId`, `name`, `kind`) and emits `{type: 'permission'}` first. `title` and the options are redacted and cut to one line. `kind` `allow_*` or `reject_*` is kept; an unknown kind is treated as `reject_once`
- **FR:perm.answer** (P1): The answer's `optionId` is returned as `{outcome: 'selected', optionId}` when it names an offered option. The broker's synthetic ids map to the first offered option of a matching kind: `allow` to `allow_once`, `deny` to `reject_once` (then `reject_always`). With no match, or when `onPermission` throws, the response is `{outcome: 'cancelled'}`: a failure never allows
- **FR:perm.broker** (P1): `stack agent run` answers permissions through the permission broker (`createPermissionBroker`, `FR:agent-sessions/perm.*`): each request is an ask `tasks/asks/perm-*.md`; the owner answers it in the web app or `stack asks`; unanswered requests are denied at the deadline. The command never auto-allows. `--yolo` does not exist

### FR:cli: Command

- **FR:cli.run** (P1): `stack agent run <command> [args...] --prompt t [--cwd dir] [--timeout s] [--json]` runs one prompt against `<command>` (words after it are the agent's arguments; put `--` before an argument that starts with `--`), prints the assistant text as it streams (or one JSON object `{ok, sessionId, stopReason, text}` with `--json`), prints permission asks as `permission: <title> (ask <key>)` on stderr, and exits 0 on `end_turn`, 1 on `error` or `cancelled`, 2 on usage errors. `--prompt` is required. The agent is always closed before exit, also on error, timeout (default 600 s) and `SIGINT`
- **FR:cli.safe** (P1): Output and errors pass through `redact` (`FR:agent-inbox/inbox.send`). The command never prints the child's environment, and the agent's stderr is shown only when the run fails, redacted and cut to 2000 characters

### FR:test: Test agent

- **FR:test.fake** (P1): `tests/fixtures/fake-acp-agent.js` is a dependency-free ACP agent that speaks newline-delimited JSON-RPC on stdio: `initialize`, `session/new`, `session/prompt` (streams two text chunks, one tool call that asks for permission and one update, replies with `end_turn`), `session/cancel`. Prompt text selects a mode (`ask`, `slow`, `crash`, `error`). No network, no model, no secrets

## Non-functional requirements

- **NFR:acp.seam** (P1): The driver implements `AgentDriver` (`FR:agent-sessions/driver.interface`); API and web code never import the ACP SDK
- **NFR:acp.lazy** (P1): Importing `src/agents` MUST NOT load the ACP SDK or spawn a process
- **NFR:acp.log** (P1): No logging of prompts, tool input, environment, or agent stderr except as `FR:cli.safe` allows

## Dependencies

`agent-sessions` (driver contract, permission broker), `ask-queue` (asks), `cli`.
