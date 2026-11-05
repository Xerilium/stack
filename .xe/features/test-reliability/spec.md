---
id: test-reliability
title: Reliable Tests
author: flanakin
description: "Tests wait on events and fake clocks, never on fixed sleeps or wall-clock budgets, so they pass on a busy machine."
dependencies: []
---

# Feature: Reliable Tests

## Purpose

Remove flaky and timeout-prone tests that slow every PR and sweep.

## Scope

- In: `tests/cli/watch.test.ts`, `tests/cli/web.test.ts`, `tests/host/token-store.test.ts`, `tests/core/storage-batch.test.ts`, `tests/calendar/ics.test.ts`, `web/e2e/live.spec.ts`, `web/playwright.config.ts`, and the seams they need in `src/cli/watch.ts` and `src/cli/web.ts`.
- Non-goals: raising timeouts to hide a race.

## Root causes found

- Fixed `sleep()` before a write: macOS FSEvents drops events written before its stream is live (seconds on a busy machine). Fix: unit tests inject a fake `fs.watch` (`watchFn`); e2e waits for a probe through `onRaw`.
- Polling `until` loops with 3 s limits and sleeps to prove "nothing happened". Fix: await the event; fake the debounce and idle timers; assert `jest.getTimerCount()`.
- Wall-clock assertions (`< 2000 ms` in ics, 300 ms sleeps in token-store). Fix: assert the outcome (step budget not exhausted) and count git calls.
- Shutdown race: `close()` waited for the api to settle, not for the reply to be sent, so `closeAllConnections()` could cut a reply off. Fix in `src/cli/web.ts`: a request is in flight until `res` closes.
- Shutdown test slept 20 ms hoping the request had arrived. Fix: hold the handler at its write until shutdown has begun.
- Extra git subprocesses per test (init/add/commit, clone-and-push seeds). Fix: one template repo copied per test; fewer git calls.
- Too many parallel Chromium workers on a busy machine. Fix: cap Playwright workers (4 local, 2 CI).

## Scenarios

### FR:wait: Deterministic waiting

- **FR:wait.event** (P1): Tests MUST wait on an event, a promise, or a fake clock. They MUST NOT sleep to let something happen, or sleep to prove nothing happened.
- **FR:wait.os** (P1): Tests that need the real OS file watcher MUST first wait until it reports a probe file.
- **FR:wait.budget** (P2): Remaining per-file jest timeouts cover real git subprocess cost only. They MUST NOT cover a wait.

### FR:shutdown: Server shutdown

- **FR:shutdown.reply** (P1): `startWeb().close()` MUST let an api request already being handled send its reply before connections close.

### FR:seam: Test seams

- **FR:seam.watch** (P2): `watchRepo` and `startWeb` accept `watchFn` (replaces `fs.watch`) and `onRaw` (hears raw events). Defaults keep production behavior.
