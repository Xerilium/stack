# 0002: Module layers and import rule

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

- `core` imports no other module today. That is by habit, not by rule.
- `desktop` imports the host from `src/cli/web.ts`. The host is not a CLI concern.
- `agents` imports `api` for ref parsing (`src/agents/team.ts:15`).
- `graph` and `calendar` import Graph types from `email` (`src/graph/transport.ts:6`).
- `src/host/` is the Azure host. The Mac host has no folder of its own.

## Decision

Imports go down these layers only:

| Layer | Modules                                   | May import                 |
| ----- | ----------------------------------------- | -------------------------- |
| 4     | `desktop/`, `host/`, `cli`                | Layers 1 to 3              |
| 3     | `api`, `mcp`, `bots`, `local` (new)       | Layers 1 and 2             |
| 2     | `agents`, `inbox`, `email`, `calendar`, `graph` | Layer 1; listed peers |
| 1     | `core`                                    | Node built-ins only        |
| -     | `web/`                                    | Nothing from `src/` (0007) |

- Move `startWeb` and its helpers from `src/cli/web.ts` to `src/local/`. `cli` and `desktop` both call it.
- Move ref parsing (`formatRef`, `parseRef`) to `core`.
- Move the Graph guard types to `graph`.
- A Jest test holds the allowed arrows (`tests/architecture/boundaries.test.ts`). Wrong arrows are listed as debt and can only shrink.

## Consequences

- The desktop shell stops depending on CLI code.
- `local` and `host` become two thin composition roots over one API.
- A new cross-module import needs a visible list change.
- Cost: one file move while `src/cli/web.ts` has open PRs. Do it after they merge.

## Evidence

- `desktop/src/host.ts:4`, `src/cli/web.ts:266`, `src/agents/team.ts:15`, `src/calendar/index.ts:5`.
