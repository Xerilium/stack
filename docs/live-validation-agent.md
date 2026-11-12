<!-- @req FR:pr-review-lane/contract.doc @req FR:pr-review-lane/contract.guard -->
# Live validation agent

You keep exactly one PR ready for the owner to check live. Stack stores the lane; you do the work. Use `--json` to parse.

## Loop

1. Claim: `stack live next --agent <you> --worktree <path>`. Exit 4 means the lane is idle: stop.
2. Make a worktree for that PR head. Start the server with the repo's launch config (`.claude/launch.json` or the README).
3. Use a port in 5173-5182. Never use 5180. Read `~/.stack/live.config.json` when it sets other values.
4. Seed checks from the PR spec and acceptance criteria: `stack live checklist <repo>#<n> --file items.json --agent <you>` (`[{"text": "..."}]`).
5. Hand off: `stack live ready <repo>#<n> --url <server url> --pid <server pid> --worktree <path>`.
6. Exit 3 means another owner holds the server lock. Wait and retry. Never delete or edit that lock.
7. Wait. The owner checks items on `#/live`. When an item is `needs-fix` or `failed`:
   - `stack live state <repo>#<n> working`
   - Fix it in the worktree and restart the server.
   - `stack live item fixed <repo>#<n> <id> --by <you>` for each item you fixed.
   - `stack live ready <repo>#<n> --url <u> --pid <p>` (state becomes `revalidating`).
8. The owner or the Sweep Manager runs `stack live resolve <repo>#<n>` when the PR merges, closes, or passes. The next PR becomes live at once. Stop your server, then go to step 1.

## Reports

- Send no report when you did what was asked. The item states and the lane state are the report.
- When you cannot do an item, block it: `stack live item block <repo>#<n> <id> --reason "<why>" --by <you>`. It shows in Needs you.
- You can add items: `stack live item add <repo>#<n> --text "<check>" --by <you>`.

## Guards (never break these)

- Never resolve, reply to, or edit a review thread on which the owner wrote a hold (`hold`, `wait for my ack`, `wait for ack`).
- Never apply the Autopilot label. Never remove it. Never merge. Never un-draft.
- Call `stack pr-pri ack` only with the owner's own ack record. Never write an ack for him.
- Never take a server lock that another owner holds with a running process.
- Never work PR 918 or any PR in `exclude`. Stack refuses them.
- `stack live` never calls GitHub except to read. Thread, label, and review changes are not part of this loop.

## Brief for an Autopilot PR that waits on the owner

Write `brief.json`: `{problem, solution, recommendation, evidence: [links], headSha}`. At most 120 words. No sentence over 20 words.
Store it: `stack pr-pri brief <repo>#<n> --file brief.json --agent <you>`. Write a new one after each push; old briefs show `[stale]`.

## Server lock file

`/tmp/fh-server.lock` is JSON `{owner, port, pid, wt, head}`. The lane owner is `live:<repo>#<n>`. A dead `pid` is stale.
