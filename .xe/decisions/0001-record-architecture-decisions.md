# 0001: Record architecture decisions

- **Status**: Accepted
- **Date**: 2026-11-19

## Context

- Product choices are in `.xe/features/design-decisions.md`.
- Architecture choices are spread over 85 feature specs.
- No one file says why the structure is as it is.

## Decision

- Keep one architecture decision per file in `.xe/decisions/`.
- `.xe/architecture.md` describes the structure. A decision file says why.
- A feature spec links to a decision. It does not repeat it.

## Consequences

- A reviewer can check a PR against a short list.
- Agents get one place to read before a structure change.
- Cost: one small file per decision.

## Evidence

- Architecture review, 2026-11-19.
