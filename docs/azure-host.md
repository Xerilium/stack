# Azure host

`host/` is the deployable Azure Functions app (SWA managed functions, Node 22, programming model v4). `host/main.ts` registers one catch-all function; all wiring is in `src/host/`. Build: `pnpm build` writes `host/dist` (entry `host/dist/host/main.js`). Deploy with `host/` as the SWA `api_location`, prebuilt (`host/dist` plus production dependencies from `host/package.json`).

## Routes

| Path | What |
| --- | --- |
| `/api/health` | `{"status":"ok"}`, no auth, no data (`degraded` when settings are invalid) |
| `/api/mcp` | MCP streamable HTTP, bearer token ([MCP](mcp.md)) |
| `/api/bots/{slack,webhook,github,imessage}` | Chat bots, signed requests ([bots](bots/README.md)) |
| `/api/**` | REST API and token admin ([OpenAPI](api/openapi.yaml)) |

## Settings

Set as SWA app settings. Missing or invalid required settings make everything except health answer `503`.

| Name | Required | Purpose |
| --- | --- | --- |
| `STACK_REPO_URL` | yes | `https://` URL of the private task repo, no credentials in it |
| `STACK_REPO_TOKEN` | yes | GitHub token with contents write on that repo (sent only to the repo's origin, via env) |
| `STACK_REPO_BRANCH` | no | Branch to read and commit to, default `main` |
| `STACK_REPO_PATH` | no | Relative subfolder holding the tasks, default repo root |
| `STACK_OWNERS` | yes for browser access | `provider:userId` list, for example `github:12345`. Empty denies all sessions |
| `STACK_TOKEN_STORE` | no | Absolute path of the token file. Default is a temp file |
| `STACK_TOKEN_PEPPER` | recommended | Secret mixed into token hashes |
| `STACK_CONFIG` | no | Stack config as JSON (scoring, formats); defaults otherwise |
| `STACK_GIT_NAME`, `STACK_GIT_EMAIL` | no | Commit identity, default `Stack` and `stack@users.noreply.github.com` |
| `STACK_SLACK_SIGNING_SECRET`, `STACK_SLACK_ALLOW` | no | Slack channel on when the secret is set; allow-list of user ids |
| `STACK_WEBHOOK_SECRET`, `STACK_WEBHOOK_ALLOW` | no | Generic webhook |
| `STACK_IMESSAGE_SECRET`, `STACK_IMESSAGE_ALLOW` | no | iMessage bridge (use a different secret from the webhook) |
| `STACK_GITHUB_WEBHOOK_SECRET`, `STACK_GITHUB_WEBHOOK_ALLOW` | no | GitHub comments; allow-list of logins |

Allow lists are comma-separated. A channel without a secret is off; an empty allow-list denies every sender.

## Behavior to know

- Storage: on first authorized request per instance the repo is cloned (single branch) into a private temp folder. Every change is a direct commit pushed to the branch. Requests that fail auth never trigger a clone.
- Token store: managed SWA keeps only temp storage, so the default token file is lost when the instance restarts and tokens must be created again. Point `STACK_TOKEN_STORE` at a path that persists where one exists.
- Bots run through a separate in-process API gate that allows only `next`, add, start, complete, and skip. There is no service token.
- Logs hold auth and MCP event fields (kind, route, status, token id) and error class names only.
