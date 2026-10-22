# MCP server

Tools: `next`, `list`, `add`, `complete`, `start`, `skip`, `resume`, `suspend`, `set`, `triage`, `claim`, `record-result`. Each maps to one API route and needs that route's scope (`tasks:read` for `next`/`list`; `tasks:write` for the rest; `read`/`write` also cover). Tools outside the token's scopes are hidden and denied.

## HTTP (Azure Functions)

```ts
import { createApiHandler, createAuth, registerAzure } from './api';
import { createMcpHandler } from './mcp';

const auth = createAuth({ owners, tokens });
const api = auth.wrap(createApiHandler({ storage, authorize: auth.authorize }));
registerAzure(app, createMcpHandler({ api, tokens }), 'mcp'); // route: /mcp
```

POST only, stateless JSON responses. Send `Authorization: Bearer stk_...` (or `X-Stack-Token`). Browser sessions are not accepted.

## stdio

`stack-mcp [--dir <path>] [--scopes read,write]` (env `STACK_DIR`, `STACK_MCP_SCOPES`). Runs against the local project; scopes default to `read,write`: any stdio client gets full read and write access to the project unless you narrow it with `--scopes` (which overrides `STACK_MCP_SCOPES`).

Replies are short text: refs for mutations (`added alpha:12`), JSON for `next` and `list`.

## Triage and autonomy

`triage`, `claim`, `record-result` need `tasks:write`. Each task has an autonomy level, a `🤖:triage|assist|full` marker in its row (inherited by subtasks; none when absent). Only the owner sets it (`stack triage <ref> --autonomy assist`); no tool can.

| Level | Agent may |
| --- | --- |
| none | read only |
| triage | `triage`, `record-result` (log) |
| assist | + `claim`, complete 🪄 subtasks |
| full | + complete the task |

The autonomy gate binds only `triage`, `claim`, and `record-result`. `start`, `complete`, `set`, and `skip` stay `tasks:write` and are not autonomy-gated: to bound a client, give it only those three tools or a narrower token.

Agents never merge or deploy and never complete beyond their level. When a person is needed, `record-result` (or `triage` with `human`) adds a 🙋 subtask and the agent moves on. A denied call returns `error forbidden`: skip the task. Results go to `tasks/logs/<project>.md` (append-only, secrets redacted, actor taken from the token; rolls to `<name>.2.md` etc. when full, max 5 files). The `add`, `complete`, and capture text may not contain `🤖`: only the owner sets autonomy.
