<!-- @req FR:deploy-docs/docs.cli -->
# CLI

`stack <command> [args] [flags]`. Refs are `<project>:<line>` (1-based), for example `alpha:12`; without a ref, commands act on the next task. Exit codes: 0 ok (including no-ops), 1 failure, 2 usage, 3 conflict, 4 no task to act on.

Global flags: `--dir <path>` (optional; default: found by walking up from the current folder, then `$STACK_DIR`, then `dir` in `~/.config/stack/config.json`), `--json`, `--no-commit`, `--remote <name>`, `--branch <name>`, `--now <ISO>`, `--help`, `--version`.

- `web`: serve the web app on localhost (default port 4173) over a content repo (`--repo path-or-git-url`, else discovery). DEMO by default (scratch copy in `~/.config/stack/demo`, `--reset` re-copies); `--live` edits the real repo on branch `stack-web` (`--branch`) via a worktree. `web [--repo path-or-url] [--live] [--branch name] [--port n] [--reset]`
- `graph`: one-time Microsoft Graph sign-in (device code) so `stack web` shows the live calendar. Read scopes only (`--with calendar,mail,drafts`); `Mail.Send` is refused. The token stays in `~/.config/stack/graph-token.json` (`--cache`, mode 0600). `graph login --client-id <id> [--tenant t] [--with calendar,mail,drafts] [--cache path] | status | logout`
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
- `asks`: ask queue for the owner; agents `put` and `handle` asks, read answers with `list`. See [docs/asks.md](asks.md). `asks put <key> --ask t --kind k --from agent [...] | list [--state s] | handle <key> --outcome o [--note --reply] | archive [--days n]`
- `remove-completed`: delete checked rows. `remove-completed [--project name]`
- `agents`: agents per project folder. `agents list [--project p --section s] | add <slug> --name n --scope a,b [--role r --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]`
- `update`: regenerate README, stack, projects, my-day. `update [--sweep] [--queries]`

## Agents

- `stack agents list [--project p --section s] [--json]`: the team (files in `tasks/agents/` plus agents named in a project's `Agents` metadata); with `--project`, the agents whose scope covers it, active first.
- `stack agents add <slug> --name n --scope a,b [--role r --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]`: write or update `tasks/agents/<slug>.md`. Scope entries are `project`, `project/section`, or `*`.
