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
| `/tasks/start` | POST start a task |
| `/tasks/complete` | POST complete a task |
| `/tasks/skip` | POST park a task |
| `/tasks/resume` | POST unpark a task |
| `/tasks/suspend` | POST suspend for days or hours |
| `/tasks/set` | POST change task properties |
| `/tasks/remove-completed` | POST delete checked tasks |
| `/projects` | GET list; POST create a project |
| `/projects/{name}` | GET one project |
| `/summaries` | GET generated summaries |

Token admin (`/auth/tokens`, `/auth/tokens/{id}/revoke`) is owner-session only and is not in the OpenAPI file. See the [threat model](../security/threat-model.md).

Errors: `{"error":{"code","message"}}` with the matching HTTP status.
