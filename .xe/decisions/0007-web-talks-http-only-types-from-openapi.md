# 0007: Web talks HTTP only; types come from OpenAPI

- **Status**: Proposed
- **Date**: 2026-11-19

## Context

- `web/` imports nothing from `src/`. Good: the page runs on the Mac host, the Azure host and a mock.
- The price: response types are copied by hand into `web/src/*.ts`.
- Some rules are also copied: day plan, needs order, priorities (`web/src/plan.ts`, `needs.ts`, `priorities.ts`).
- The e2e mock (`web/e2e/mock.ts`) is a third copy of the API shape.
- Two ask models reach one page: `/asks` and `/needs-you`.

## Decision

- Keep the rule: `web/` imports nothing from `src/`. The boundary test checks it.
- `docs/api/openapi.yaml` is the contract. Generate `web/src/api-types.ts` from it in the build.
- A test checks each mock response in `web/e2e/mock.ts` against the same file.
- A rule that decides order, count or state lives in `core` and is served. The page only renders.
- One `Ask` type in `core` feeds the page. Sources map into it on the host.

## Consequences

- A changed response fails the web type-check, not the owner's screen.
- Counts and verbs match on every page, because one place computes them.
- Cost: `openapi.ts` must carry full response schemas. It has 6 open PRs; start after they merge.

## Evidence

- Usability review: wrong "Approve" verb, four different PR counts.
- `src/api/openapi.ts` (935 lines), `web/src/api.ts`.
