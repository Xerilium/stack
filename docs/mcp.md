# MCP server

Tools: `next`, `list`, `add`, `complete`, `start`, `skip`, `resume`, `suspend`, `set`. Each maps to one API route and needs that route's scope (`tasks:read` for `next`/`list`; `tasks:write` for the rest; `read`/`write` also cover). Tools outside the token's scopes are hidden and denied.

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

`stack-mcp [--dir <path>] [--scopes read,write]` (env `STACK_DIR`, `STACK_MCP_SCOPES`). Runs against the local project; scopes default to `read,write`.

Replies are short text: refs for mutations (`added alpha:12`), JSON for `next` and `list`.
