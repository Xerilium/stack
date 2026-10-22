# MCP server

Tools: `next`, `list`, `add`, `complete`, `start`, `skip`, `resume`, `suspend`, `set`, `triage`, `claim`, `record-result`. Each maps to one API route and needs that route's scope; tools outside the token's scopes are hidden and denied.

| Tool | Route | Scope |
| --- | --- | --- |
| `next` | `GET /next` | `tasks:read` |
| `list` | `GET /tasks` | `tasks:read` |
| `add` | `POST /tasks` | `tasks:write` |
| `complete` | `POST /tasks/complete` | `tasks:write` |
| `start` | `POST /tasks/start` | `tasks:write` |
| `skip` | `POST /tasks/skip` | `tasks:write` |
| `resume` | `POST /tasks/resume` | `tasks:write` |
| `suspend` | `POST /tasks/suspend` | `tasks:write` |
| `set` | `POST /tasks/set` | `tasks:write` |
| `triage` | `POST /tasks/triage` | `tasks:write` |
| `claim` | `POST /tasks/claim` | `tasks:write` |
| `record-result` | `POST /tasks/result` | `tasks:write` |

`read` and `write` also cover these. Mint a token as the owner (see [runbook](runbook.md)); give agents only the scopes they need.

## HTTP (Azure Functions)

```ts
import { createApiHandler, createAuth, registerAzure } from "./api";
import { createMcpHandler } from "./mcp";

const auth = createAuth({ owners, tokens });
const api = auth.wrap(createApiHandler({ storage, authorize: auth.authorize }));
const mcp = createMcpHandler({ api, tokens, basePath: "/api/mcp" });
// registerAzure registers one catch-all route (`{*route}`); the 3rd arg is only the function name.
// Register once and dispatch, or a second catch-all collides with the API's.
registerAzure(app, (req) => new URL(req.url).pathname.replace(/\/+$/, "") === "/api/mcp" ? mcp(req) : api(req));
```

Under Static Web Apps the request path keeps the `/api` prefix, so the endpoint is `/api/mcp` and `basePath` must be `"/api/mcp"` (the default is `/mcp`). The API handler defaults to `/api`.

POST only, stateless JSON responses. Send `Authorization: Bearer stk_...` (or `X-Stack-Token`). Browser sessions are not accepted.

## stdio

`stack-mcp [--dir <path>] [--scopes read,write]` (env `STACK_DIR`, `STACK_MCP_SCOPES`). Runs against the local project; scopes default to `read,write`: any stdio client gets full read and write access to the project unless you narrow it with `--scopes` (which overrides `STACK_MCP_SCOPES`).

Replies are short text: refs for mutations (`added alpha:12`), JSON for `next` and `list`.

## Client config

Local (Claude Desktop, Claude Code `.mcp.json`, Cursor):

```json
{
  "mcpServers": {
    "stack": {
      "command": "stack-mcp",
      "args": ["--dir", "/path/to/my-tasks", "--scopes", "tasks:read,tasks:write"]
    }
  }
}
```

Remote (Claude Code):

```sh
claude mcp add --transport http stack https://<your-app>.azurestaticapps.net/api/mcp \
  --header "Authorization: Bearer stk_..."
```

If the host strips `Authorization`, use `--header "X-Stack-Token: stk_..."`.

## Triage and autonomy

`triage`, `claim`, `record-result` need `tasks:write`. Each task has an autonomy level, a `🤖:triage|assist|full` marker in its row (inherited by subtasks; none when absent). Only the owner sets it (`stack triage <ref> --autonomy assist`); no tool can.

| Level | Agent may |
| --- | --- |
| none | read only |
| triage | `triage`, `record-result` (log) |
| assist | + `claim`, complete 🪄 subtasks |
| full | + complete the task |

The autonomy gate binds every token call that changes a task. The owner session and the CLI skip it.

| Tool | Token may |
| --- | --- |
| `start` | `assist`+, `ref` required, not a 🙋 or held row |
| `complete` | `assist` for a 🪄 subtask, `full` otherwise; none when unset (denied); `409` if the task has an open 🙋 subtask |
| `set` | `triage` for priority, effort, impact; `assist` for status; the complete level for `checkbox`; never changes gate marks or `clearEmojis` |
| `skip`, `suspend`, `resume` | owner session only (they move hold marks) |

Denied calls return `error forbidden` (or `error conflict`) with fixed text: skip the task. `remove-completed` is API owner-session only. Chat-bot service tokens are agents too: bot `start`/`done` need an autonomy level and a ref.

Agents never merge or deploy and never complete beyond their level. When a person is needed, `record-result` (or `triage` with `human`) adds a 🙋 subtask and the agent moves on. A denied call returns `error forbidden`: skip the task. Results go to `tasks/logs/<project>.md` (append-only, secrets redacted, actor taken from the token; rolls to `<name>.2.md` etc. when full, max 5 files; when all 5 are full the oldest is dropped, so a token cannot fill the log and block `claim` or `record-result`; storage history keeps dropped entries). The `add`, `complete`, and capture text may not contain `🤖`: only the owner sets autonomy. Tokens cannot move rows (`/tasks/move` is owner-session only) and cannot add or remove gate markers (🪄 🙋 🤖 and hold marks) via `/tasks/edit`.
