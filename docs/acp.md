# ACP agents runbook

Stack runs ACP agents (Gemini CLI, Codex, Copilot) with `stack agent run`. Spec: `.xe/features/acp-driver/spec.md`.

## Human step: log in to Gemini CLI (one time)

```sh
npm i -g @google/gemini-cli@latest && gemini
```

In the menu, pick **Sign in with Google**. Finish the sign-in in the browser. Then type `/quit`.

- Gemini CLI 0.1.x does not answer ACP `initialize`. Use the current version (0.68.0 was tested).
- Credentials stay in `~/.gemini`. Stack never reads or stores them.
- A login from an old version is not enough. The current version then fails with `Gemini API key is missing or not configured`. Log in again with the current version.
- Unpaid and Google One accounts: Gemini CLI was replaced by Antigravity CLI on 2026-06-18 (source 1). Use an API key from Google AI Studio in `~/.gemini/.env` (`GEMINI_API_KEY=...`). Do not put it in the shell environment: Stack does not pass it to the agent.
- Work accounts can also need `GOOGLE_CLOUD_PROJECT` in `~/.gemini/.env` (source 1).

## Check the login

```sh
STACK_ACP_AGENT="gemini --acp" pnpm exec jest tests/agents/acp-real.test.ts
```

The test is skipped when `STACK_ACP_AGENT` is not set. It sends one prompt and denies every permission request.

## Run a prompt

```sh
stack agent run --prompt "Summarize README.md" gemini -- --acp
```

- `--acp` starts Gemini CLI in ACP mode (source 2). `--experimental-acp` is the old name. Stack flags go before `--`; the agent arguments go after it.
- Each permission request becomes an ask `tasks/asks/perm-*.md`. Answer it in the web app or with `stack asks`. No answer by the deadline means deny.
- `Ctrl+C` cancels the run. A second `Ctrl+C` stops the agent at once.
- `--timeout s` (default 600) cancels the run. When the agent does not stop in 3 s, Stack stops it.
- Exit codes: 0 done, 1 error, cancel or timeout, 2 usage error.

## Troubleshoot

| Error                                         | Fix                                              |
| --------------------------------------------- | ------------------------------------------------ |
| `Agent did not answer initialize`             | Old Gemini CLI. Update it.                       |
| `session/new failed: ... API key is missing`  | Do the login step with the current version.      |
| `Agent exited (code n)` and the stderr tail   | Run `gemini --acp --debug` by hand and read it.  |

## Sources

1. Gemini CLI authentication (accounts, `.env` search order): https://geminicli.com/docs/get-started/authentication/
2. Gemini CLI ACP mode: https://geminicli.com/docs/cli/acp-mode/

