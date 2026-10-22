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
- Denials are `forbidden`; agents treat them as "skip and move on"
- Agent suggestions never overwrite existing priority/effort/impact
- Completion is the only gated state change; merge/deploy have no code path
- Tests first: `tests/core/triage.test.ts`, `tests/api/triage.test.ts`, `tests/mcp/triage.test.ts`, `tests/cli/triage.test.ts`
