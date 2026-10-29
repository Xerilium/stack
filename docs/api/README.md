<!-- @req FR:deploy-docs/docs.api -->
# REST API

JSON only. Machine-readable spec: [openapi.yaml](openapi.yaml) (regenerate with `pnpm openapi`; a test fails if it drifts). Tasks are addressed by `ref` = `project:line`. Use `fields` to trim responses.

## Auth

Send `Authorization: Bearer stk_...` (or `X-Stack-Token` if a proxy rewrites Authorization), or sign in as the owner in the browser. Scopes: `read`, `write`, `tasks:read`, `tasks:write`, `projects:read`, `projects:write`, `summaries:read`. `read` and `write` cover the others. Every route denies by default.

## Routes

| Route | Purpose |
| --- | --- |
| `/next` | GET the top-ranked task |
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
| `/sync` | GET the repo revision (`rev`, head commit sha; `null` when the storage has none). Poll it and reload only when it changes |
| `/calendar` | GET calendar events for a range, read-only (owner session only) |
| `/tasks/resume` | POST unpark a task (owner session only) |
| `/tasks/suspend` | POST suspend for days or hours (owner session only) |
| `/tasks/set` | POST change task properties |
| `/tasks/edit` | POST replace the text of a task row (tokens need autonomy `assist`+ on an open, non-🙋, non-held row and cannot change any marker) |
| `/tasks/move` | POST move a task block before or after another task (owner session only; tokens get 403) |
| `/tasks/remove-completed` | POST delete checked tasks |
| `/projects` | GET list; POST create a project |
| `/projects/{name}` | GET one project |
| `/summaries` | GET generated summaries |

Token admin (`/auth/tokens`, `/auth/tokens/{id}/revoke`) is owner-session only and is not in the OpenAPI file. See the [threat model](../security/threat-model.md).

Errors: `{"error":{"code","message"}}` with the matching HTTP status.
