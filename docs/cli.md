<!-- @req FR:deploy-docs/docs.cli -->
# CLI

`stack <command> [args] [flags]`. Refs are `<project>:<line>` (1-based), for example `alpha:12`; without a ref, commands act on the next task. Exit codes: 0 ok (including no-ops), 1 failure, 2 usage, 3 conflict, 4 no task to act on.

Global flags: `--dir <path>` (optional; default: found by walking up from the current folder, then `$STACK_DIR`, then `dir` in `~/.config/stack/config.json`), `--json`, `--no-commit`, `--remote <name>`, `--branch <name>`, `--now <ISO>`, `--help`, `--version`.

- `web`: serve the web app on localhost (default port 4173) over a content repo (`--repo path-or-git-url`, else discovery). DEMO by default (scratch copy in `~/.config/stack/demo`, `--reset` re-copies); `--live` edits `tasks/` in your real checkout on its current branch (`--branch` asserts which), committed in batches after `--batch` minutes idle (default 5, `0` = every edit), on `POST /api/sync`, and on shutdown; pushed to `origin` when present. `web [--repo path-or-url] [--live] [--branch name] [--remote name] [--batch minutes] [--port n] [--reset]`. User config `~/.config/stack/config.json` keys: `repo`, `mode` (`live`), `branch`, `remote`, `batch` (minutes), `ics` (published calendar link), `onboarding` (setup progress). With no repo, `stack web` serves a first-run setup flow instead of failing; `--repo`, `--live`, the current folder and `STACK_REPO` still win, and the flow shows them as fixed
- `graph`: one-time Microsoft Graph sign-in (device code) so `stack web` shows the live calendar. Read scopes only (`--with calendar,mail,drafts`); `Mail.Send` is refused. The token stays in `~/.config/stack/graph-token.json` (`--cache`, mode 0600). `graph login --client-id <id> [--tenant t] [--account addr] [--with calendar,mail,drafts] [--cache path] | status | logout` (`--account` keeps a separate token per mailbox)
- `email`: one triage pass on the signed-in mailbox: rules first, Haiku classifies, Sonnet drafts in your voice (drafts only, never sends), archive/spam/unsubscribe asks act only after you answer. Runs where Claude Code runs (launchd or a scheduled task). `run` takes a lock and stops before any model call when one delta exceeds `--max` (default 200); `--dry-run` writes nothing; `--dry-run --offline [--fixture f.json]` also needs no network, sign-in or `claude`. Setup steps: `docs/email-runner.md`. `voice` learns your style from Sent items (plus `--extra file.json` from elsewhere) into `$STACK_DATA_DIR`. `email run [--all] [--mode observe|drafts] [--max n] [--dry-run] [--project p] | voice [--extra file.json] | status [--account a] | schedule [--remote origin]`
- `init`: create repo, tasks/, and config. `init`
- `add-project`: create a project file. `add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force] [--queries] [--no-update]`
- `add`: add a task. `add <project> <text...> [--section name] [--parent ref]`
- `capture`: add a task from a phrase (e.g. "call dentist tomorrow 30m #alpha"). `capture <text...> [--project name] [--section name] [--dry-run]`
- `next`: print the top task, or the first n ranked tasks (the same order as the web Home and `GET /api/rank`; overrides in [ranking.md](ranking.md)). `next [--top n]`
- `start`: mark in progress. `start [ref] [--expect t] [--queries] [--no-update]`
- `complete`: check off (rolls recurring rows). `complete [ref] [--summary t] [--remove] [--expect t] [--queries] [--no-update]`
- `skip`: park a task (alias: park). `skip [ref] [--expect t] [--queries] [--no-update]`
- `triage`: show/set autonomy, add 🪄/🙋 subtasks. `triage <ref> [--autonomy none|triage|assist|full] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]`
- `park`: same as skip. `park [ref] [--expect t] [--queries] [--no-update]`
- `resume`: unpark the first parked task. `resume [ref] [--expect t] [--queries] [--no-update]`
- `suspend`: hide until later. `suspend [ref] [--days n | --hours n] [--expect t] [--queries] [--no-update]`
- `set`: set emojis and checkbox. `set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis] [--expect t]`
- `tag`: set the 🔓 unblocker and 📅 due tags the autopri engine reads. `tag <ref> [--unblocker yes|no] [--due "MMM d"|none] [--expect t]`
- `rank`: ranked tasks; `--explain` (autopri) shows score parts; `--truth` lists ground-truth items to tag or add. `rank [--engine autopri|stack] [--top n] [--explain [--truth file]]`
- `asks`: ask queue for the owner; agents `put` and `handle` asks, read answers with `list`. See [docs/asks.md](asks.md). `asks put <key> --ask t --kind k --from agent [--project --why --recommend --options "A|B" --default --by --reversible yes|no --link --priority --effort --blocks --detail-file p --reopen --flow slug --seq n --ref project:line --apply "<action>" --applies "a|b"] | list [--state s] | handle <key> --outcome o [--note --reply] | archive [--days n]`
- `report`: send an agent status report (top 3, asks on the owner, blockers, progress) to the desktop host, or write `~/.stack/reports.json` when no host runs; never git; its asks show in Needs you. See [docs/report.md](report.md). `report --agent <name> --project <p> [--file report.json] [--json]` (JSON on stdin when no `--file`)
- `sessions`: Claude app sessions on this machine. Read-only on the app store; facts cached by mtime in `~/.stack/sessions.json`. Prints counts, the ranked Needs-you list (waiting, stuck) with `claude://` links, and the number of archive candidates (`--json` lists them). `sessions [--json]`
- `pris`: the owner priorities in order (`~/.stack/pris.json`, never git). `pris [--json] | pris seed --file <md>` (seed runs once; later runs change nothing)
- `remove-completed`: delete checked rows. `remove-completed [--project name] [--queries] [--no-update]`
- `inbox`: reply on a task as an agent. `inbox reply <ref> --from <agent> --text t [--expect t]`
- `agent`: run one prompt on an ACP agent over stdio (e.g. `gemini -- --acp`). Each permission request becomes an ask (`tasks/asks/perm-*.md`); nothing is auto-allowed. The agent gets an allow-listed environment, never Stack tokens. `agent run <command> [args...] --prompt t [--cwd dir] [--timeout s]` (default 600 s; put `--` before an agent argument that starts with `--`)
- `agents`: agents per project folder. `agents list [--project p --section s] | add <slug> --name n --scope a,b [--role r --reports-to a --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]`
- `update`: regenerate README, stack, projects, my-day (legacy scorer by default; `--engine stack` scores and orders like `stack next`, see [ranking.md](ranking.md)). `update [--sweep] [--queries] [--engine legacy|stack]`

After `start`, `complete`, `skip`/`park`, `resume`, `suspend`, `remove-completed`, and `add-project` change a file, the CLI runs `update --sweep` (like the legacy scripts). `--queries` also refreshes GitHub query rows; `--no-update` skips the refresh.

## Agents

- `stack inbox reply tasks/<file>.md:<line> --from <agent> --text "..."`: an agent's reply on a task (`tasks/inbox/<project>.md`, `from: agent`); the owner reads it in the task thread. `stack asks put ... --ref tasks/<file>.md:<line>` ties an ask to a task the same way.
- `stack agents list [--project p --section s] [--json]`: the team (files in `tasks/agents/` and `.claude/agents/`, plus agents named in a project's `Agents` metadata); with `--project`, the agents whose scope covers it, the roll-up first, then most specific first.
- `stack agents add <slug> --name n --scope a,b [--role r --reports-to a --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]`: write or update `tasks/agents/<slug>.md`. Scope entries are `project`, `project/section`, or `*`; `--reports-to` names the manager (default: the narrowest agent covering the same projects, else the roll-up). `.claude/agents/<slug>.md` files are read into the team too, never written.
