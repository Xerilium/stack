<!-- @req FR:deploy-docs/docs.runbook @req FR:deploy-docs/docs.env -->
# Runbook

Owner-only. Agents build the files here; they never deploy, create Azure resources, or hold secrets.

## Cost

Free tier: Azure Static Web Apps Free plan with managed Functions. No Key Vault, no paid resources. Secrets live in app settings. Check the current Free plan limits (bandwidth, storage, Functions) before heavy use.

## Prerequisites

- Azure subscription and a resource group
- `az` CLI and `bicep`
- A private GitHub repo for task data (the Function reads and writes it)
- The Functions host in `host/` ships with this repo ([Azure host](azure-host.md))

## Deploy

1. Check the template offline: `bicep build infra/main.bicep` (lint only, no Azure calls).
2. Preview: `az deployment group what-if -g <rg> -f infra/main.bicep -p infra/main.parameters.json -p owners=... tokenPepper=... repoToken=... repoUrl=https://github.com/<you>/<tasks>.git`
3. Create: same command with `create` instead of `what-if`. Secrets come from the command line or your shell, never from a file in git.
4. Get the deployment token: `az staticwebapp secrets list -n <name> --query properties.apiKey -o tsv`.
5. Add it to GitHub: repo Settings, Secrets and variables, Actions, new secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
6. Push to `main`. `.github/workflows/deploy.yml` builds and uploads. With no secret it logs a skip and passes.

## Settings

| Name | Purpose |
| --- | --- |
| `STACK_OWNERS` | Owner allow-list, comma-separated `provider:userId` (for example `github:12345`). Empty denies everyone |
| `STACK_TOKEN_PEPPER` | Secret mixed into API token hashes. Changing it invalidates all tokens |
| `STACK_REPO_TOKEN` | Credential for the private task repo |
| `STACK_REPO_URL` | https URL of the private task repo (no credentials in it). More settings: [Azure host](azure-host.md) |
| `STACK_TOKEN_STORE` | Optional file path for the token store (needs `STACK_TOKEN_PEPPER`). Default: the data repo (`.stack/tokens.json`) |
| `STACK_REPO_BRANCH`, `STACK_REPO_PATH` | Branch (default `main`) and optional subfolder of the task repo |
| `STACK_CONFIG` | Optional Stack config as JSON |
| `STACK_GIT_NAME`, `STACK_GIT_EMAIL` | Commit identity |
| `STACK_SLACK_SIGNING_SECRET`, `STACK_SLACK_ALLOW` | Slack bot secret and allowed user ids |
| `STACK_WEBHOOK_SECRET`, `STACK_WEBHOOK_ALLOW` | Webhook bot secret and allowed senders |
| `STACK_IMESSAGE_SECRET`, `STACK_IMESSAGE_ALLOW` | iMessage bridge secret and allowed senders |
| `STACK_GITHUB_WEBHOOK_SECRET`, `STACK_GITHUB_WEBHOOK_ALLOW` | GitHub comment bot secret and allowed logins |
| `STACK_REPO`, `STACK_DIR` | Local content repo for the CLI, `stack web`, and `stack-mcp` (when none is found by walking up from the current folder). Content never lives in the Stack repo; see the README "Two repos" |
| `STACK_MCP_SCOPES` | Scopes for `stack-mcp` (stdio only), default `read,write` |

## Owner allow-list

Sign-in is GitHub through SWA built-in auth. Find your numeric GitHub user id (`gh api user -q .id`), then set `STACK_OWNERS=github:<id>`. Update with `az staticwebapp appsettings set -n <name> --setting-names STACK_OWNERS=github:<id>`. Only people on the list get owner access; everyone else is denied.

## Tokens

Create, list, and revoke as the owner (signed in) through `POST /api/auth/tokens`, `GET /api/auth/tokens`, `POST /api/auth/tokens/{id}/revoke`. A secret (`stk_...`) is shown once. Default expiry 90 days, max 365, 50 active at most. Give each agent the narrowest scopes ([API](api/README.md), [MCP](mcp.md)).

Rotate: create a new token, update the client, revoke the old one. Rotate the pepper only if the token store leaks: set a new `STACK_TOKEN_PEPPER`, then recreate every token. Rotate `AZURE_STATIC_WEB_APPS_API_TOKEN` with `az staticwebapp secrets reset-api-key -n <name>` and update the GitHub secret.

The token store holds only hashes (never secrets) plus scopes and expiry. By default it is committed to the private data repo as `.stack/tokens.json`, so tokens survive restarts; keep that repo private (see the [threat model](security/threat-model.md)). Revoking on one instance reaches others within about a minute.

## Backup and restore

Tasks are markdown in git, so the git history is the backup. Clone the task repo anywhere for a copy (`git clone --mirror`). To restore, push the mirror to a new private repo and point `STACK_REPO_TOKEN` at it, or `git revert` a bad commit. Redeploying the app loses nothing: it holds no task data. Deploy settings can be rebuilt from `infra/`; keep your secret values in a password manager.

## Troubleshooting

- Deploy skipped: the secret is missing.
- 401 from `/api`: token missing, expired, or lacks the scope.
- 403 in the browser: your id is not in `STACK_OWNERS`.
- E2E skipped: `web/package.json` not present.
