---
id: feedback-button
title: Feedback Button Plan
---

# Plan: Feedback Button

## Approach

One core module `src/core/feedback.ts` (`FeedbackStore`, `redactSecrets`, `setPageCapture`). API route, CLI and web stay thin.

## Decisions

- Desktop capture runs in the host process: the shell registers `capturePage` with `setPageCapture`; no preload, no renderer bridge. The renderer only sends `capture: true`
- Browser capture is a downscaled PNG (max 1280 px wide, smaller until it fits 700 KB), so it fits the local server's 1 MB body cap
- Append under `withFileLock` with one `writeSync`; the file is never rewritten, so `tail -F` consumers keep their place
- `appVersion` and `sha` come from the host at start (package.json, `git rev-parse --short HEAD`), never from the client
- Tests first: `tests/core/feedback.test.ts`, `tests/api/feedback.test.ts`, `tests/cli/feedback.test.ts`, `web/e2e/feedback.spec.ts` (375 and 1280, axe)
