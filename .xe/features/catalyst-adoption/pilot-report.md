# Catalyst pilot report

Date: 2026-11-05. Branch: `xe/catalyst-pilot`. Scope: `FR:pilot.scope` (one small real change).

## Verdict

Partial. Install works. The real `/catalyst:fix` run did NOT happen: the headless `claude -p` session had an expired OAuth login. A human must run `claude /login`. The fix was then done by hand in the Catalyst order (red test, then docs fix).

## Install steps

1. Catalyst repo: `Xerilium/catalyst`. npm package: `@xerilium/catalyst` 0.3.3 (bins: `catalyst`, `catalyst-github`, `catalyst-bootstrap`). Marketplace: `xerilium/ai-plugins`.
2. User scope: `catalyst@xerilium` 0.3.0-dev was already installed on this machine. Skills present: blueprint, change, create, explore, fix, init, pr-loop, pr-review, pr-update, rollout, run, sitrep.
3. Project scope for Stack: `claude plugin install catalyst@xerilium --scope project`. Took 31 s. Result: `.claude/settings.json` with `enabledPlugins`.
4. Clean clone: `pnpm install --frozen-lockfile` then `build:core` and `build:cli` succeed. No Catalyst npm dependency is needed in Stack.

## What worked

- Plugin install at project scope (1 command).
- `.xe/config/catalyst.json` already present.
- Real drift found: `docs/cli.md` lacks 16 flags that `stack --help` lists (`asks put` x14, `email run --all`, and others). Existing test only checked command names.
- New test `documents every flag that stack --help lists` (tag `@req FR:deploy-docs/docs.cli`) failed before the docs fix and passes after. `tests/deploy`: 139 pass.

## What broke

- `claude -p "/catalyst:fix ..."`: "Failed to authenticate: OAuth session expired and could not be refreshed". Cost 0 tokens, 0.6 s. Cause: nested headless session has no valid login.
- `timeout` is not on macOS by default. Use `gtimeout` or the `--max-budget-usd` flag.

## Human steps still needed

1. Run `claude /login` (or set a valid token) so headless `claude -p` works.
2. Re-run: `claude -p "/catalyst:fix <bug>"` on a new bug, or `/catalyst:change` interactively. Then fill the metrics below.
3. Keep `traceability` at `warning` (`FR:flow.traceability`) until a real run passes.

## Metrics

| Item | Value |
| --- | --- |
| Install time | about 31 s |
| Catalyst run tokens | 0 (not run) |
| Catalyst run time | 0.6 s (auth fail) |
| Human touches | 1 required (login) |
| Manual work (tokens) | not measured |

## Not proven

`/catalyst:fix` and `/catalyst:change` end to end, `pr-loop`, rollout files, `@req` traceability checks.
