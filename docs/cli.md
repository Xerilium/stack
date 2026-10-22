<!-- @req FR:deploy-docs/docs.cli -->
# CLI

`stack <command> [args] [flags]`. Refs are `<project>:<line>` (1-based), for example `alpha:12`; without a ref, commands act on the next task. Exit codes: 0 ok (including no-ops), 1 failure, 2 usage, 3 conflict, 4 no task to act on.

Global flags: `--dir <path>` (project dir), `--json`, `--no-commit`, `--remote <name>`, `--branch <name>`, `--now <ISO>`, `--help`, `--version`.

- `init`: create repo, tasks/, and config. `init`
- `add-project`: create a project file. `add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force]`
- `add`: add a task. `add <project> <text...> [--section name] [--parent ref]`
- `capture`: add a task from a phrase (e.g. "call dentist tomorrow 30m #alpha"). `capture <text...> [--project name] [--section name] [--dry-run]`
- `next`: print the top task. `next`
- `start`: mark in progress. `start [ref] [--expect t]`
- `complete`: check off (rolls recurring rows). `complete [ref] [--summary t] [--remove] [--expect t]`
- `skip`: park a task (alias: park). `skip [ref] [--expect t]`
- `triage`: show/set autonomy, add 🪄/🙋 subtasks. `triage <ref> [--autonomy none|triage|assist|full] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]`
- `park`: same as skip. `park [ref] [--expect t]`
- `resume`: unpark the first parked task. `resume [ref] [--expect t]`
- `suspend`: hide until later. `suspend [ref] [--days n | --hours n] [--expect t]`
- `set`: set emojis and checkbox. `set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis] [--expect t]`
- `remove-completed`: delete checked rows. `remove-completed [--project name]`
- `update`: regenerate README, stack, projects, my-day. `update [--sweep] [--queries]`
