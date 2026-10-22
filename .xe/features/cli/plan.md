# Plan: cli

## Approach

- `src/cli/args.ts` parses argv (flags with values, booleans, `--`); `src/cli/run.ts` builds the context (GitStorage/FsStorage, config from `.xe/config/stack.json`), dispatches to one handler per command, formats output, maps errors to exit codes; `src/cli/index.ts` is the bin shim.
- Refs are 1-based at the CLI edge and converted to the core's 0-based `TaskRef`.
- `update` reads `tasks/*.md` plus previous README/projects through `Storage` and writes changed summary files through it. `storage.validatePath` additionally allows the four summary file names; `MemoryStorage.list` returns only `tasks/` paths.
- `tsconfig.cli.json` compiles `src/cli` and `src/core` together (rootDir `src`) so `dist/cli/index.js` can import `../core`.

## Tests (written first)

- `tests/cli/args.test.ts`: parser units.
- `tests/cli/e2e.test.ts`: builds the CLI once into a temp dir, then spawns `node <build>/cli/index.js` against temp git repos (real commits; `git log` asserted), covering every command, `--json`, exit codes, `--dir`, `--no-commit`, conflict via a stale second clone.
- `tests/parity/cli-parity.test.ts`: `STACK_LEGACY_DIR` check, skipped when unset.

## Decisions

- No-op results exit 0; only "no task to act on" exits 4.
- `update` does not sweep unless `--sweep` (parity with legacy summary generation).
- `update` makes one commit per changed summary file (storage commits per path). Follow-up: multi-path commit.
- Output carries no decoration (no emojis added by the CLI); task text is printed as stored.
