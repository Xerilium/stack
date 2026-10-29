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
| `STACK_REPO_URL` | yes | `https://` URL of the private task repo, no credentials in it. The token is sent to this origin, so use only a host you trust |
| `STACK_REPO_TOKEN` | yes | GitHub token with contents write on that repo (sent only to the repo's origin, via env) |
| `STACK_REPO_BRANCH` | no | Branch to read and commit to, default `main` |
| `STACK_REPO_PATH` | no | Relative subfolder holding the tasks, default repo root |
| `STACK_OWNERS` | yes for browser access | `provider:userId` list, for example `github:12345`. Empty denies all sessions |
| `STACK_TOKEN_STORE` | no | Absolute path of a token file. Default: tokens live in the data repo at `.stack/tokens.json`. Requires `STACK_TOKEN_PEPPER` |
| `STACK_TOKEN_PEPPER` | recommended | Secret mixed into token hashes |
| `STACK_CONFIG` | no | Stack config as JSON (scoring, formats); defaults otherwise |
| `STACK_GIT_NAME`, `STACK_GIT_EMAIL` | no | Commit identity, default `Stack` and `stack@users.noreply.github.com` |
| `STACK_SLACK_SIGNING_SECRET`, `STACK_SLACK_ALLOW` | no | Slack channel on when the secret is set; allow-list of user ids |
| `STACK_WEBHOOK_SECRET`, `STACK_WEBHOOK_ALLOW` | no | Generic webhook |
| `STACK_IMESSAGE_SECRET`, `STACK_IMESSAGE_ALLOW` | no | iMessage bridge (use a different secret from the webhook) |
| `STACK_GITHUB_WEBHOOK_SECRET`, `STACK_GITHUB_WEBHOOK_ALLOW` | no | GitHub comments; allow-list of logins |

Allow lists are comma-separated. A channel without a secret is off; an empty allow-list denies every sender.

## Behavior to know

<!-- @req FR:azure-host/auth.swa -->

- Storage: a `https://github.com/<owner>/<repo>` URL uses the GitHub REST API (no git, no clone): reads come from a snapshot of the branch head (one tree read per new commit, ref re-checked at most every 5 s with an ETag), and every change is one commit with a fast-forward-only ref update ([hosting](hosting.md)). Any other host is cloned (single branch) into a private temp folder on first authorized request and every change is a direct commit pushed to the branch. Requests with no credential, and health, never open storage.
- Token store: hashes (never secrets) are committed to the data repo at `.stack/tokens.json` through the storage adapter, so tokens survive restarts. Keep the repo private. Another instance sees a revocation within about a minute. Set `STACK_TOKEN_STORE` to use a file instead: it needs `STACK_TOKEN_PEPPER`, the default path would be predictable in shared temp, and it is per instance, so a revocation on one instance does not reach the others.
- Reachability (hard requirement): owner sessions trust the `x-ms-client-principal` header SWA adds. The Function must be reachable only through the SWA: no bring-your-own backend, no public `*.azurewebsites.net` endpoint. Otherwise anyone can forge an owner.
- Repo safety: the clone uses `core.symlinks=false` and storage refuses symlinks, so repo content cannot read host files. Git runs with a minimal environment (no app secrets), no redirects, a 120s timeout per command, and a 30s cooldown after a failed clone.
- Health reports `degraded` without auth (no names or values).
- Bots run through a separate in-process API gate that allows only `next`, add, start, complete, and skip. There is no service token.
- Logs hold auth and MCP event fields (kind, route, status, token id) and error class names only.
