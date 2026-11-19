# 0004: One home for live state

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

State is in five places:

| Place                                   | Holds                                          |
| --------------------------------------- | ---------------------------------------------- |
| Content repo `tasks/`                   | Tasks, asks, agents, inbox                     |
| Content repo `.stack/`                  | Overrides, schedule, tokens, inbox items       |
| `~/.stack` (`STACK_HOME`)               | Reports, pris, QM plan, PR queue, lane, delivery |
| `~/.config/stack`                       | User config, Graph token, clones, demo copy    |
| `~/Library/Application Support/stack`   | Voice profiles, email state                    |

- Two different folders are named `.stack`.
- `STACK_HOME` does not move the Graph log (`src/graph/diag.ts:16`), the Graph token (`src/graph/auth.ts:165`) or voice data (`src/email/voice/store.ts:12`).
- A test or a second host with `STACK_HOME` set can still write the owner's real files.
- `stackHome()` lives in the report store file (`src/core/reports.ts:125`) and is called in 28 places.

## Decision

- Three classes of state, three places, no more:
  - **Content** (in git): content repo. Tasks and what the owner can edit by hand.
  - **Live** (never git): `stackHome()`. All machine-written state, logs, caches, tokens.
  - **User config** (hand-edited): `~/.config/stack/config.json` only.
- Move `stackHome` to `src/core/home.ts`. Every live path comes from it.
- `STACK_HOME` moves all live state, with no exception.
- Each composition root calls `stackHome()` once and passes one `LiveStores` object down.
- Move a file only with a read-old-then-write-new step. Never drop owner data.

## Consequences

- Tests and a second host are isolated by one variable.
- Backup and reset are one folder.
- Cost: a small migration for the Graph token, voice profiles and email state.

## Evidence

- `src/cli/web.ts:270-345` calls `stackHome()` 9 times; `desktop/src/host.ts:77` wires the same stores again.
