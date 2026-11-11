# Plan: GitHub Notifications Connector

## Slices

1. Tests first: `tests/inbox/github.test.ts` with fixture `tests/fixtures/github/notifications.json`.
2. `src/inbox/connectors/github.ts`: types, `githubSignal`, `githubItems`, `createGhGuard`, `githubConnector` over an injected `gh` runner.
3. `src/inbox/connectors/github-runner.ts`: `runGithub` writes items and asks.
4. Shared contract, smallest change: `Source` adds `github`; the store accepts `github` and `gh-` ids. Without it the store drops every item.

## Design

- Transport: `gh` CLI via `execFile` (no shell). `gh auth` holds the token. No new secret.
- Mapper is pure. Connector injects the runner. Same shape as `ChatConnector`.
- Untrusted text uses `oneLine` and `redact`, as chat items do.

## Human-only

- None to test. Live use needs `gh auth login` with a classic token (`notifications` or `repo` scope). Verified live: `repo` works.
