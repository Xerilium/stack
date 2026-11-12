# Agent instructions: pick up and reply

The owner messages the task's agent from the composer under the task on Now. Each instruction is an open entry in `tasks/inbox/<project>.md` (`kind: instruction`). A scheduled agent reads them with the CLI. No server and no model tokens are needed to find the work.

## Prompt snippet

Paste this into the scheduled agent's prompt. Replace `<project>` and `<agent>`.

```markdown
## Owner instructions (do this first, every run)

1. List open instructions for your project:
   `stack inbox list --project <project> --json`
2. For each item, oldest first:
   - The task is at `row` (where the row is now). Use `ref` only when `row` is missing (the row is gone: handle it with a note that says so).
   - Do what `text` asks (kind `instruction`; `reply` and `decision` entries are answers to your asks). Line breaks were folded to ` / `.
   - Reply on the task in one line so the owner sees it in the task thread:
     `stack inbox reply <row> --from <agent> --text "<what you did, or what you need>"`
   - Close the entry:
     `stack inbox handle <id> --from <agent> --note "<one line: result or PR link>"`
3. If you cannot act, still reply with what you need, and ask in Needs you (`stack asks put`). Do not handle the entry until the work is done or the owner withdraws it.
4. Never write an instruction yourself. Only the owner writes in the inbox (`POST /inbox` is owner only).
```

## Commands

- `stack inbox list [--project p] [--state open|handled|all] [--json]`: one line per entry: `<id> <kind> <project> <row> <text>`.
- `stack inbox reply tasks/<file>.md:<line> --from <agent> --text t`: the agent's reply on the task.
- `stack inbox handle <id> [--note t] [--from <agent>]`: prints `handled`, or `unchanged` when it was handled already.

## Delivery

The Stack host can run the agent for you on each new message. Turn it on in `.xe/config/stack.json`: `"inbox": { "delivery": "claude" }` (default `off`). Optional: `deliveryTimeoutSeconds` (default 300), `deliveryMaxUsd` (default 0.5), `reposRoot` (default the folder that holds the task repo).

- Needs `claude` signed in. When the login expires, messages show `Not delivered` with a Sign in button, and one ask says `Claude login expired: Sign in`. The one step: `claude auth login`.
- Each run is `claude -p` in safe mode, in the project's repo, with the agent's tools. Only Read, Grep and Glob run without asking; every other tool call the agent wanted becomes an ask. A run never merges, never sets labels, and never sends mail.
- `stack inbox run --once` does one pass by hand; `--watch` keeps going. Each run adds one line to `~/.stack/delivery.log` (ids, state, time, cost; never the text).

Over HTTP, the same steps are `GET /inbox?project=<p>`, `POST /inbox/reply` (agent token), and `POST /inbox/handled`.
