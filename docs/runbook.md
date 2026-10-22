# Runbook

Owner-only. Agents build the files here; they never deploy, create Azure resources, or hold secrets.

## Cost

Free tier: Azure Static Web Apps Free plan with managed Functions. No Key Vault, no paid resources. Secrets live in app settings. Check the current Free plan limits (bandwidth, storage, Functions) before heavy use.

## Prerequisites

- Azure subscription and a resource group
- `az` CLI and `bicep`
- A private GitHub repo for task data (the Function reads and writes it)
- The Functions host entry that wires storage, tokens, API, MCP, and bots from `src/` into `registerAzure` (not part of this repo yet; deploy needs it under `api/`)

## Deploy

1. Check the template offline: `bicep build infra/main.bicep` (lint only, no Azure calls).
2. Preview: `az deployment group what-if -g <rg> -f infra/main.bicep -p infra/main.parameters.json -p owners=... tokenPepper=... repoToken=...`
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
| `STACK_DIR` | Local project directory for `stack-mcp` (stdio only) |
| `STACK_MCP_SCOPES` | Scopes for `stack-mcp` (stdio only), default `read,write` |

## Owner allow-list

Sign-in is GitHub through SWA built-in auth. Find your numeric GitHub user id (`gh api user -q .id`), then set `STACK_OWNERS=github:<id>`. Update with `az staticwebapp appsettings set -n <name> --setting-names STACK_OWNERS=github:<id>`. Only people on the list get owner access; everyone else is denied.

## Tokens

Create, list, and revoke as the owner (signed in) through `POST /api/auth/tokens`, `GET /api/auth/tokens`, `POST /api/auth/tokens/{id}/revoke`. A secret (`stk_...`) is shown once. Default expiry 90 days, max 365, 50 active at most. Give each agent the narrowest scopes ([API](api/README.md), [MCP](mcp.md)).

Rotate: create a new token, update the client, revoke the old one. Rotate the pepper only if the token store leaks: set a new `STACK_TOKEN_PEPPER`, then recreate every token. Rotate `AZURE_STATIC_WEB_APPS_API_TOKEN` with `az staticwebapp secrets reset-api-key -n <name>` and update the GitHub secret.

The token store holds only hashes but also scopes and expiry; keep it in a private location (see the [threat model](security/threat-model.md)).

## Backup and restore

Tasks are markdown in git, so the git history is the backup. Clone the task repo anywhere for a copy (`git clone --mirror`). To restore, push the mirror to a new private repo and point `STACK_REPO_TOKEN` at it, or `git revert` a bad commit. Redeploying the app loses nothing: it holds no task data. Deploy settings can be rebuilt from `infra/`; keep your secret values in a password manager.

## Troubleshooting

- Deploy skipped: the secret is missing.
- 401 from `/api`: token missing, expired, or lacks the scope.
- 403 in the browser: your id is not in `STACK_OWNERS`.
- E2E skipped: `web/package.json` not present.
