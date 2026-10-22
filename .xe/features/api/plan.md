---
id: api
title: API Plan
---

# Plan: API

## Approach

`src/api/` holds a pure `(Request) => Promise<Response>` handler over the core lifecycle, summaries, and storage. `azure.ts` is the only host-aware file and imports no SDK (structural types). No auth: a pluggable `authorize` hook that denies when absent.

## Contracts

- `createApiHandler`, `ApiDeps`, `Authorize`, `toAzureHandler`, `registerAzure`, `ROUTES` (route table also drives the OpenAPI test)

## Decisions

- Modules: `errors.ts` (ApiError, mapping), `validate.ts` (body/query/ref checks), `fields.ts` (selection), `handler.ts` (routes), `azure.ts`
- Refs are `project:line` strings (compact; one format in and out)
- Authorize runs before route outcomes; unmatched routes are denied first
- Core errors map by class; messages from `LifecycleError` are user-safe, everything else is a fixed 500
- Summaries are generated on read from storage (the storage interface only holds `tasks/*.md`)
- Build: `tsconfig.api.json` added to `pnpm build`
- Tests: `tests/api/*.test.ts` with `MemoryStorage` and direct `Request` objects; no network
