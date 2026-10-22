---
id: ai-triage-assist
title: AI Triage Assist Plan
---

# Plan: AI Triage Assist

## Approach

`src/core/triage.ts` holds all logic: autonomy parsing (marker in the task line, inherited down the tree), `authorize` gate, `applyTriage`, `claimTask`, `recordResult`, and the redacting log writer. API routes and CLI call it; MCP tools stay thin (one tool, one route) and add only the server-chosen `actor`.

## Contracts

- `authorize`, `effectiveAutonomy`, `setAutonomy`, `applyTriage`, `claimTask`, `recordResult`, `redact`, `TriageDenied`
- Routes `tasks.triage|claim|result` (scope `tasks:write`); tools `triage`, `claim`, `record-result`; CLI `triage`

## Decisions

- Autonomy lives in the row as `🤖:<level>` (the model field `autonomy` maps to it), so it round-trips in plain markdown and cannot be changed through API/MCP
- Log at `tasks/logs/<project>.md`: beside the tasks, outside the project list. `validatePath` accepts it; `MemoryStorage.list` filters to task files
- Actor comes from the request token in the API handler, never the body
- Agent-reachable text writes reject `🤖` in the API layer; core `addTask` stays unchanged for owners
- Denials are `forbidden`; agents treat them as "skip and move on"
- Agent suggestions never overwrite existing priority/effort/impact
- Merge/deploy have no code path
- Change: the API calls `authorizeMutation` (core) for every token mutation, and pins the row for the write; owner session skips it. Hold-mark moves (`skip`, `suspend`, `resume`) stay owner-only, matching `/tasks/edit`
- Change: a full log shifts down one file (oldest dropped) instead of failing, so a `tasks:write` token cannot block claim or record-result. Git history keeps the dropped entries
- Change tests first: `tests/api/autonomy-gate.test.ts`
- Tests first: `tests/core/triage.test.ts`, `tests/api/triage.test.ts`, `tests/mcp/triage.test.ts`, `tests/cli/triage.test.ts`
