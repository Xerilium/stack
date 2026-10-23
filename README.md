# stack

Stack 'em up. Burn 'em down. Simple, multi-project task management and prioritization.

Stack keeps your tasks as markdown files in a git repo, scores them, and tells you what to do next. You use it from a CLI, a REST API, an MCP server for AI agents, chat bots, or the web app.

## Quick start

```sh
pnpm install && pnpm build && pnpm link --global   # installs `stack`
stack web --repo ~/path/to/your-content-repo        # DEMO: serves a scratch COPY
# open http://localhost:4173
```

## Two repos

1. Stack (this repo) is code only. It never holds tasks.
2. Your content repo is a separate git repo with `tasks/*.md`. Point Stack at it: `--repo <path-or-git-url>`, `$STACK_REPO`, or `repo` in `~/.config/stack/config.json`.
3. DEMO (default): works on a scratch copy in `~/.config/stack/demo`; nothing touches your repo. `--reset` re-copies.
4. LIVE (`--live`): reads and writes your real repo, committing to branch `stack-web` (`--branch` to change) in a git worktree; your checkout and `main` stay untouched until you merge.
5. The page header always shows mode, repo path, and branch.

If `stack` is not found, run `pnpm setup` and reopen the shell. Needs Node 22 and pnpm. CLI commands find the repo by walking up from the current folder, then `$STACK_REPO`/`$STACK_DIR`, then user config; `--dir` overrides.

## Commands

`web`, `init`, `add-project`, `add`, `capture`, `next`, `start`, `complete`, `skip`, `resume`, `suspend`, `set`, `remove-completed`, `update`. Global flags: `--dir`, `--json`, `--no-commit`, `--remote`, `--branch`, `--now`. Details: [docs/cli.md](docs/cli.md).

Repo scripts: `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm openapi` (regenerates [the OpenAPI file](docs/api/openapi.yaml)), `pnpm bakeoff`.

## Formats

Task files are `tasks/<project>.md`. The `emoji` format (default) carries priority, effort, and impact as emoji; `clean` writes plain text. `alsoWrite` in the config writes extra formats. Parse and write round-trip byte for byte.

## Config

`.xe/config/stack.json` (created by `init`, `{}` means defaults). Keys: `format`, `alsoWrite`, `timezone`, `startOfDay`, `shiftWeekends`, `timeBlocks`, `taskScoring` (`emojiWeights`, `effortHours`). See `src/core/config.ts` for defaults.

## Interfaces

- CLI: [docs/cli.md](docs/cli.md)
- REST API: [docs/api/README.md](docs/api/README.md)
- MCP server: [docs/mcp.md](docs/mcp.md)
- Chat bots: [docs/bots/README.md](docs/bots/README.md)
- Security: [docs/security/threat-model.md](docs/security/threat-model.md)
- Deploy and operate: [docs/runbook.md](docs/runbook.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
