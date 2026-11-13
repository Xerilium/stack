<!-- @req FR:deploy-docs/docs.api -->
# REST API

JSON only. Machine-readable spec: [openapi.yaml](openapi.yaml) (regenerate with `pnpm openapi`; a test fails if it drifts). Tasks are addressed by `ref` = `project:line`. Use `fields` to trim responses.

## Auth

Send `Authorization: Bearer stk_...` (or `X-Stack-Token` if a proxy rewrites Authorization), or sign in as the owner in the browser. Scopes: `read`, `write`, `tasks:read`, `tasks:write`, `projects:read`, `projects:write`, `summaries:read`. `read` and `write` cover the others. Every route denies by default.

## Routes

| Route | Purpose |
| --- | --- |
| `/next` | GET the top-ranked task (the first of `/rank`) |
| `/rank` | GET the ranked tasks (`limit` 1-200; `blocks=any` keeps tasks the current time block would hide, for My day): engine order plus the owner and CoS overrides in `.stack/priorities.json`; each has `rule` when an override applied and `root` when it sits under a parent. See [ranking.md](../ranking.md) |
| `/needs-you` | GET the Chief of Staff's open decisions and go-dos (`.stack/needs-you.json`), then report asks from the host's live store |
| `/needs-you/{id}/answer` | POST the owner's answer onto an item (`go`, `defer` with `until`, `reply` with `text`, or `undo`). Owner session only |
| `/reports` | POST an agent status report into the desktop host's live store (`~/.stack`, never git); 400 lists every issue. See [report.md](../report.md) |
| `/session-inventory` | GET (owner only) Claude app sessions: counts, ranked Needs you, archive candidates; read-only on the app store, cached in `~/.stack` |
| `/pr-priority` | GET (owner) the PR priority list view and open recommendations; POST (owner) one idempotent action `{rev, op, ref?, rank?, to?, note?, thread?}`. `/pr-priority/recommendations`: POST (agent token ok) recommend, GET decisions. `/pr-priority/recommendations/{id}`: POST (owner) accept, edit or reject. See [pr-priority.md](../pr-priority.md) |
| `/prs` | GET (owner only) the PR board: open PRs by group, each with its one next action, spec lines, pin, and details, plus the Summary (live validation, sign-off, ready for Autopilot, anything else); `refresh=1` polls GitHub first; renews a 3-minute poll lease; `{auth: {state, method}}` when signed out of GitHub (local host); `{off: true}` on a host with no board |
| `/prs/queue` | POST (owner only) change the priority queue through `stack pr-pri`: `top`, `up`, `down`, `move`, `add`, `pin` (adds the PR first when not queued), `unpin`, `remove`, `undo` |
| `/prs/label` | POST (owner only) add or remove the Autopilot label (no other label) |
| `/prs/ack` | POST (owner only) record an answer on a thread (`thread`, `note`); `post: true` first posts the `🤖 [AI]` text on GitHub |
| `/prs/recs/{id}` | POST (owner only) accept, edit, or reject a PR priority recommendation |
| `/prs/resolve` | POST (owner only) resolve or reopen a review thread (`thread` node id, `op`) of a PR on the board |
| `/prs/sign-in` | GET (owner only) the GitHub sign-in session (code and device link, never a token); POST starts `gh auth login --web`; 404 where the host has no sign-in |
| `/pris` | GET or POST (owner only) the owner priorities with sub-items, backlog and weekly progress; POST sends `{rev, pris}`, a stale rev is 409 |
| `/pr-review` | GET cached PR facts (`specLines`, `live`, head SHA) and agent briefs with `stale`. No GitHub call |
| `/live` | GET the live validation lane: state, the one live PR, its checklist, done PRs |
| `/live/items` | POST change one checklist item (`add`, `check`, `uncheck`, `fail`, `needs-fix`, `fixed`, `block`, `comment`, `edit`); owner calls are by owner, token calls by the token name. See [live-validation-agent.md](../live-validation-agent.md) |
| `/feedback` | POST (owner only) one feedback line to `~/.stack/feedback.jsonl` `{text, route?, viewport?, theme?, capture?, png?}`; see [feedback.md](../feedback.md) |
| `/tasks` | GET list tasks; POST add a task |
| `/tasks/{ref}` | GET one task |
| `/capture` | POST add a task from a phrase |
| `/tasks/start` | POST start a task (token: autonomy-gated) |
| `/tasks/complete` | POST complete a task (token: autonomy-gated) |
| `/tasks/skip` | POST park a task (owner session only) |
| `/tasks/triage` | POST apply a triage suggestion (autonomy-gated) |
| `/tasks/claim` | POST claim a task for an agent (autonomy-gated) |
| `/tasks/result` | POST log an agent result (autonomy-gated) |
| `/inbox` | GET inbox entries for agents; POST send a reply or decision to the task project agent inbox (owner session only) |
| `/inbox/handled` | POST mark an inbox entry handled |
| `/inbox/delivery` | GET (owner only) delivery state of the row's messages (`working`, `delivered`, `failed`, `not-delivered`), the mode, the Claude login, and a live session link; 404 where the host does not deliver. See [agent-instructions.md](../agent-instructions.md) |
| `/inbox/delivery/login` | POST (owner only) start the Claude sign-in (`claude auth login`) on this machine |
| `/inbox-items` | GET all mail, unread Teams, Slack and GitHub items with summaries and suggested actions, plus source status (Inbox page; owner session only) |
| `/connect` | GET whether the one-time Stack app registration exists, and each connected Microsoft account (type, mail, calendar, drafts, state). Local host only; never a token (owner session only) |
| `/connect/setup` | POST run the one-time app registration (Az PowerShell); returns a state code (owner session only) |
| `/connect/sign-in` | POST start a Microsoft sign-in: browser (PKCE, loopback) or device code; read-only scopes, drafts opt-in, never send (owner session only) |
| `/connect/sign-in/{id}` | GET a sign-in session: waiting, done, or error (owner session only) |
| `/connect/drafts` | POST turn reply drafts on (new sign-in) or off for an account (owner session only) |
| `/connect/remove` | POST disconnect an account: deletes its token file (owner session only) |
| `/inbox-sources` | GET each inbox source (every email account, GitHub, planned Teams and Slack): state, last sync, the exact step to connect it, and N of M connected. `fresh=1` re-probes the local host. Never a token (owner session only) |
| `/inbox-items/{id}/action` | POST run an inbox action; reply-draft makes a draft and never sends (owner session only) |
| `/brief/summary` | GET the AI daily brief (owner only; `refresh=1` bypasses the cache) |
| `/asks` | GET ranked asks for the owner (`state=open|answered|done|snoozed|all`) |
| `/asks/{key}` | POST create or update an ask (agents) |
| `/asks/{key}/answer` | POST the owner's answer (owner session only) |
| `/asks/{key}/handle` | POST close an ask after acting, or reopen it with a reply |
| `/sessions` | GET live agent sessions on this machine with state and cost; POST start a new session (owner only) |
| `/sessions/cost` | GET agent spend by day, project, model |
| `/sessions/{id}/messages` | GET the last turns of a session |
| `/sessions/{id}/prompt` | POST resume a session with a prompt (owner only; stream on `/sessions/{id}/events`) |
| `/sessions/{id}/cancel` | POST stop the run in flight (owner only) |
| `/agents` | GET what agents are doing (agent rows, result logs, inbox, PR state and checks) |
| `/version` | Desktop app only (404 elsewhere): GET the running and ready builds, whether an update is ready, the update mode, and the last update result |
| `/version/mode` | POST `{ mode, idleMinutes? }`: when updates install (`on-quit`, `ask`, `auto-idle`, `off`). Owner only |
| `/version/restart` | POST: commit pending edits, then quit, swap in the ready build, and relaunch. Owner only; 409 when nothing is ready |
| `/sync` | GET the repo revision (`rev`, head commit sha; `null` when the storage has none). Poll it and reload only when it changes |
| `/calendar` | GET calendar events for a range, read-only (owner session only) |
| `/meetings` | GET the weekly meeting rules from `.stack/meetings.md` (owner session only) |
| `/schedule` | GET the waking day (wake, bed, time blocks) that contains an instant (owner session only) |
| `/schedule/day` | POST change wake or bed for a date or its weekday; reset removes it (owner session only) |
| `/tasks/resume` | POST unpark a task (owner session only) |
| `/tasks/suspend` | POST suspend for days or hours (owner session only) |
| `/tasks/set` | POST change task properties |
| `/tasks/edit` | POST replace the text of a task row (tokens need autonomy `assist`+ on an open, non-🙋, non-held row and cannot change any marker) |
| `/tasks/move` | POST move a task block before or after another task (owner session only; tokens get 403) |
| `/tasks/remove-completed` | POST delete checked tasks |
| `/projects` | GET list; POST create a project |
| `/projects/{name}` | GET one project |
| `/summaries` | GET generated summaries |
| `/team` | GET agents defined per project folder (`project=` filters to the agents covering it, active first) |
| `/reviews` | GET every row's newest review in a project (`project=`) |
| `/inbox/reply` | POST an agent's reply on a task (tokens only; `from: agent`) |
| `/tasks/{ref}/thread` | GET one task's thread: owner messages, agent replies, its asks (`ref`), the review verdict, agent-owned subtasks, its newest session |
| `/tasks/{ref}/assign` | POST hand the task to its agent: claims the row and starts a session (owner only; 404 without a runner) |
| `/tasks/review` | POST ask the task's agent whether it can do it (owner only; 404 without a runner); the verdict lands in the result log and its needs become asks |

Token admin (`/auth/tokens`, `/auth/tokens/{id}/revoke`) is owner-session only and is not in the OpenAPI file. See the [threat model](../security/threat-model.md).

Errors: `{"error":{"code","message"}}` with the matching HTTP status.
