---
id: azure-host
title: Azure Host Plan
---

# Plan: Azure Host

## Approach

All logic lives in `src/host/` with injected seams (git runner, storage opener, token store, logger) so tests use fakes and never call Azure, git, or the network. `host/main.ts` only registers the catch-all with `registerAzure`.

## Contracts

- `parseSettings(env)`, `SettingsError` (`settings.ts`)
- `openGitStorage(settings, deps)`, `gitEnv` (`git-repo.ts`)
- `createHost(env, deps)` returning `(Request) => Promise<Response>` (`runtime.ts`)

## Decisions

- One catch-all function (not one per area): avoids route-precedence surprises; `registerAzure` reused unchanged
- Lazy storage proxy so auth runs before any clone
- Bots get an in-process API handler with a route allow-list instead of a service token (nothing to store or leak)
- Repo config via `STACK_CONFIG` setting (the API takes config at construction, before the clone exists)
- Token store is a file path (reference adapter); managed SWA only guarantees temp storage, documented
- `host/` is a pnpm workspace package; deploys use prebuilt `host/dist` plus `npm install --omit=dev`
- Tests: `tests/host/*.test.ts` with `MemoryStorage`, `MemoryTokenStore`, fake git runner
