<!-- @req FR:deploy-docs/docs.runbook @req FR:deploy-docs/docs.env -->
# Runbook

Owner-only. Agents build the files here; they never deploy, create Azure resources, or hold secrets.

## Cost

Free tier: Azure Static Web Apps Free plan with managed Functions. No Key Vault, no paid resources. Secrets live in app settings. Check the current Free plan limits (bandwidth, storage, Functions) before heavy use.

Fastest path: [setup-live.md](setup-live.md) (one script). The steps below are the manual equivalent.

## Prerequisites

- Azure subscription and a resource group
- PowerShell 7 with Az PowerShell (`Install-Module Az`), `bicep`, and `gh`. Never the `az` CLI
- A private GitHub repo for task data (the Function reads and writes it)
- The Functions host in `host/` ships with this repo ([Azure host](azure-host.md))

## Deploy

1. Check the template offline: `bicep build infra/main.bicep` (lint only, no Azure calls).
2. Preview: `$p = @{ owners = ''; tokenPepper = '<random hex>'; repoToken = '<token>'; repoUrl = 'https://github.com/<you>/<tasks>' }`, then `New-AzResourceGroupDeployment -WhatIf -ResourceGroupName <rg> -TemplateFile infra/main.bicep -TemplateParameterObject $p` (`repoBranch` defaults to `stack/live`; set `customDomain` only after its CNAME exists). Type the values in your shell, never in a file in git.
3. Create: same command without `-WhatIf`. **First run only:** the template replaces every app setting, so never run it against a live site. Re-runs go through `scripts/setup-azure.ps1`, which merges.
4. Store the deployment token without printing it: `(Invoke-AzRestMethod -Method POST -Path "$((Get-AzStaticWebApp -ResourceGroupName <rg> -Name <name>).Id)/listSecrets?api-version=2023-12-01").Content | ConvertFrom-Json | % { $_.properties.apiKey } | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R Xerilium/stack`.
5. Check it exists: `gh secret list -R Xerilium/stack`.
6. Push to `main`. `.github/workflows/deploy.yml` builds and uploads. With no secret it logs a skip and passes.

## Settings

| Name | Purpose |
| --- | --- |
| `STACK_OWNERS` | Owner allow-list, comma-separated `provider:userId` (for example `github:12345`). Empty denies everyone |
| `STACK_TOKEN_PEPPER` | Secret mixed into API token hashes. Changing it invalidates all tokens |
| `STACK_REPO_TOKEN` | Credential for the private task repo |
| `STACK_REPO_URL` | https URL of the private task repo (no credentials in it). More settings: [Azure host](azure-host.md) |
| `STACK_CALENDAR_FIXTURE` | `stack web` only: JSON file of calendar events for Today (demo and screenshots); wins over Graph and ICS |
| `STACK_GRAPH_CLIENT_ID` | `stack web` and the desktop app: the Stack app registration id for in-app Connect. Default `graph.clientId` in `~/.config/stack/config.json`, written by Run setup (see `docs/connect-accounts.md`) |
| `STACK_GRAPH_CACHE` | `stack graph`, `stack email` and `stack web` only: path of the Graph token file. Default `~/.config/stack/graph-token.json` (mode 0600; never inside a task repo) |
| `STACK_CALENDAR_ICS` | Published calendar links (ICS), separated by spaces or commas; `stack web` and the Azure host. Outlook on the web: Settings, Calendar, Shared calendars, Publish a calendar, ICS link. Google: Settings, your calendar, Secret address in iCal format. Treat as a secret: anyone with the link reads the calendar. Order: `STACK_CALENDAR_FIXTURE`, then a Graph sign-in, then these feeds |
| `STACK_TOKEN_STORE` | Optional file path for the token store (needs `STACK_TOKEN_PEPPER`). Default: the data repo (`.stack/tokens.json`) |
| `STACK_REPO_BRANCH`, `STACK_REPO_PATH` | Branch (default `main`) and optional subfolder of the task repo |
| `STACK_HOME` | Local live state for `stack web`, the desktop host, and `stack report` (default `~/.stack`): `reports.json`, `host.json`, `sessions.json`, `pris.json`, `pr-priority.json`, `pr-priority-state.json`, `pr-priority.config.json`, `pr-facts.json`, `pr-briefs.json`, `live-lane.json`, `live.config.json`. Never in git. See [report.md](report.md) |
| `STACK_GH` | `stack pr-pri list --refresh`, `stack prs`, `stack pr-pri brief --refresh` and `stack live next`: the `gh` binary for GitHub reads (default `gh`). Reads only: PR, PR files, and search. Facts cache in `pr-facts.json`; the lane in `live-lane.json`; briefs in `pr-briefs.json`; lane settings in `live.config.json` (all under `STACK_HOME`) |
| `STACK_SESSIONS_DIR` | `stack sessions` and the desktop host: the Claude app session store to read (default `~/Library/Application Support/Claude/claude-code-sessions`). Read-only |
| `STACK_TRANSCRIPTS_DIR` | `stack sessions`: the Claude Code transcripts folder for the last-event kind (default `~/.claude/projects`). Read-only; no text is kept |
| `STACK_CONFIG` | Optional Stack config as JSON |
| `STACK_GIT_NAME`, `STACK_GIT_EMAIL` | Commit identity |
| `STACK_SLACK_SIGNING_SECRET`, `STACK_SLACK_ALLOW` | Slack bot secret and allowed user ids |
| `STACK_WEBHOOK_SECRET`, `STACK_WEBHOOK_ALLOW` | Webhook bot secret and allowed senders |
| `STACK_IMESSAGE_SECRET`, `STACK_IMESSAGE_ALLOW` | iMessage bridge secret and allowed senders |
| `STACK_GITHUB_WEBHOOK_SECRET`, `STACK_GITHUB_WEBHOOK_ALLOW` | GitHub comment bot secret and allowed logins |
| `GITHUB_TOKEN` | Azure host: GitHub token for pull request state and the PR page. `stack web`, the desktop app, and `stack prs` use it when set, else the `gh` CLI sign-in (`gh auth token`), so no setup is needed; signed out, the PR page offers one-tap Sign in to GitHub (`gh auth login --web`). Sent only to `api.github.com`, never logged |
| `STACK_GH_AUTH` | `off` stops the local host and `stack prs` from reading the `gh` sign-in (tests set it). Unset: on |
| `STACK_GITHUB_REPOS` | Optional comma list of `owner` or `owner/repo`. When set, only PRs in these repos get status, so an agent token cannot read other PRs through `GET /agents`. Unset: every repo the token can see. On the local host the token may be the `gh` sign-in (every repo you can see); the local host takes no agent tokens (loopback, owner only), and the Azure host never reads `gh` |
| `STACK_VAPID_PUBLIC_KEY`, `STACK_VAPID_PRIVATE_KEY`, `STACK_VAPID_SUBJECT` | Optional Web Push VAPID keys (base64url) and contact (`mailto:you@example.com` or an `https:` URL); see [iPhone push](#iphone-push). The public key is served to devices at `GET /api/auth/devices/me/push-key`. The private key is a host secret only: never in a repo, never logged. Push is off unless all three are set and valid |
| `STACK_PUSH_QUIET` | Optional quiet hours `<start>-<end>` in the config `timezone`, default `21-8`; only `crit` asks push inside them. `off` turns them off |
| `STACK_REPO`, `STACK_DIR` | Local content repo for the CLI, `stack web`, and `stack-mcp` (when none is found by walking up from the current folder). Content never lives in the Stack repo; see the README "Two repos" |
| `STACK_SOURCE` | `stack app install|update` and the desktop app: the Stack source checkout that builds `Stack.app`, default `~/.local/share/stack` ([desktop-install.md](desktop-install.md#update)) |
| `STACK_UPDATE_SOURCE`, `STACK_UPDATE_TARGET`, `STACK_UPDATE_PID`, `STACK_UPDATE_QUIT`, `STACK_UPDATE_RELAUNCH`, `STACK_UPDATE_LOG`, `STACK_UPDATE_RESULT`, `STACK_UPDATE_OPEN`, `STACK_UPDATE_WAIT_S`, `STACK_UPDATE_SHA`, `STACK_UPDATE_BUILT`, `STACK_UPDATE_QUITTER` | Internal: inputs the installer passes to its swap helper (`~/.stack/app/update.sh`). Do not set them yourself |
| `STACK_MCP_SCOPES` | Scopes for `stack-mcp` (stdio only), default `read,write` |
| `STACK_DATA_DIR` | Owner-only local data (email voice profile and mail state), default `~/Library/Application Support/stack`. Never inside a repo: it holds learned writing samples |
| `STACK_CLAUDE_BIN` | `stack email` only: the Claude Code binary used for model calls (`claude -p`, no tools), default `claude`. Model calls use your Claude login |

## Owner allow-list

Sign-in is GitHub through SWA built-in auth. SWA's `userId` is generated per app, not your GitHub id ([user information](https://learn.microsoft.com/azure/static-web-apps/user-information)): sign in once, and the "Not on the allow-list" page shows your `github:<id>` and the command `scripts/setup-azure.ps1 -Owner github:<id>`. Run that; it merges the change and keeps every other setting. Only people on the list get owner access; everyone else is denied.

## Tokens

Create, list, and revoke as the owner (signed in) through `POST /api/auth/tokens`, `GET /api/auth/tokens`, `POST /api/auth/tokens/{id}/revoke`. A secret (`stk_...`) is shown once. Default expiry 90 days, max 365, 50 active at most. Give each agent the narrowest scopes ([API](api/README.md), [MCP](mcp.md)).

Rotate: create a new token, update the client, revoke the old one. Rotate the pepper only if the token store leaks: set a new `STACK_TOKEN_PEPPER`, then recreate every token. Rotate `AZURE_STATIC_WEB_APPS_API_TOKEN` in the portal (Static Web App, Overview, Manage deployment token, Reset), then re-run `scripts/setup-azure.ps1`.

The token store holds only hashes (never secrets) plus scopes and expiry. By default it is committed to the private data repo as `.stack/tokens.json`, so tokens survive restarts; keep that repo private (see the [threat model](security/threat-model.md)). Revoking on one instance reaches others within about a minute.

## iPhone push

The host pushes an ask to each paired phone when the ask is due within 1 hour. Human-only steps:

1. Make VAPID keys once: `npx web-push generate-vapid-keys --json`. Set `STACK_VAPID_PUBLIC_KEY`, `STACK_VAPID_PRIVATE_KEY` and `STACK_VAPID_SUBJECT` as host secrets (portal: Static Web App, Environment variables; the setup script keeps them on re-run). Keep the private key in a password manager.
2. Add a cron caller. Something must call `POST /api/push/check` (body `{}`) every 5 minutes with a `tasks:write` token, for example a GitHub Actions `schedule` workflow in the data repo with the token in a repo secret. Without it, only ask writes (`POST /api/asks/{key}`) start a check.
3. Pair the phone (iOS 16.4 or later): create a device as the owner (`POST /api/auth/devices`), open `/#/install?device=<token>` in Safari, Add to Home Screen, open Stack from the Home Screen, then tap `Turn on notifications`.
4. Optional, for the live Mac view only: use Tailscale Serve (tailnet only). Phone push uses the Azure host and needs no tunnel. Cloudflare Tunnel is not recommended (public hostname, extra account).

`.stack/push-sent.json` in the data repo keeps one push per device, ask and deadline. A `404` or `410` from the push service removes that phone's subscription; pair again to restore it.

## Backup and restore

Tasks are markdown in git, so the git history is the backup. Clone the task repo anywhere for a copy (`git clone --mirror`). To restore, push the mirror to a new private repo and point `STACK_REPO_TOKEN` at it, or `git revert` a bad commit. Redeploying the app loses nothing: it holds no task data. Deploy settings can be rebuilt from `infra/`; keep your secret values in a password manager.

## Troubleshooting

- Deploy skipped: the secret is missing.
- 401 from `/api`: token missing, expired, or lacks the scope.
- 403 in the browser: your id is not in `STACK_OWNERS`.
- E2E skipped: `web/package.json` not present.

## Live calendar and mail (Microsoft Graph, one time)

1. Register an app in Entra ID: single tenant or "Accounts in any organizational directory", no redirect URI, **Allow public client flows: Yes**. Delegated permissions: `Calendars.Read` (and `Mail.Read` or `Mail.ReadWrite` when the email module runs). Never add `Mail.Send`; Stack refuses it.
2. `stack graph login --client-id <app id> --with calendar` and follow the printed code. The token stays in `~/.config/stack/graph-token.json`, never in a repo.
3. If login says `unsafe_scope`, remove the named permissions from the app registration **and** revoke the consent already granted (Entra ID > Enterprise applications > the app > Permissions, or myapps.microsoft.com); removing a permission alone does not revoke consent.
4. `stack web` now shows your meetings (it logs `calendar: Graph`). `stack graph status` checks it; `stack graph logout` removes it.

## Email assistant (drafts only, one time)

Runs where Claude Code runs; the Stack host has no timers. Model calls use your Claude login (`claude -p`, no tools).

1. Sign in with mail: `stack graph login --client-id <app id> --with calendar,mail,drafts` (`Mail.ReadWrite` makes drafts and approved moves possible; it cannot send).
2. Learn your voice: `stack email voice` (add `--extra file.json` with writing from elsewhere when Sent Items is thin). The profile and style guide stay in `$STACK_DATA_DIR/email/<account>/`, mode 0600, never in a repo.
3. Try one pass without writing anything: `stack email run --dry-run`. Then `stack email run` writes asks to your content repo (and pushes when `--remote` is set).
4. Schedule it every 15 minutes: `stack email schedule --dir <content repo> --remote origin > ~/Library/LaunchAgents/com.xerilium.stack-email.plist`, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xerilium.stack-email.plist`. The plist uses absolute paths (launchd has no PATH) and logs to `$STACK_DATA_DIR/email/<account>/run.log`. `stack email status` shows the last pass.
   - Pushing asks needs a **private** content repo: asks carry sender names, subjects, short summaries and draft text (never message bodies).
   - Optional `rules.json` beside the state adds VIP, sensitive and receipt rules (same keys as the triage rules).
5. Nothing moves, unsubscribes, or sends on its own: archive, spam and unsubscribe asks act only after you answer them in Stack.

## Autopilot merges (`.github/workflows/autopilot.yml`)

Label a PR `Status: 🤖 Autopilot` and an agent can drive it to merge. The workflow squash-merges it only while all of these hold on the current head commit:

- `Status: ☑️ Finalized` is on the PR **and** a comment from you or a collaborator certifies this exact head SHA. A new push clears `Finalized`; the agent re-certifies.
- `Status: ✅ Ready` (set by the workflow: not a draft, no changes requested, and `Autopilot` or a non-author approval).
- Every review thread is resolved, every check on the head commit has finished green, and GitHub reports the PR `CLEAN`.
- The head contains the current tip of `main`. If `main` moved, update the PR branch, then re-certify (the push clears `Finalized`).
- No `Status: ⏸️ Paused`, `🚧 WIP`, or `⛔ Blocked` label.

To certify, an agent posts the comment **first**, then adds `Finalized`:

```bash
sha=$(gh pr view <n> --json headRefOid -q .headRefOid)
gh pr comment <n> --body $'<!-- stack:finalized-head-sha -->\nFinalized certification: head SHA `'"$sha"$'`.'
gh pr edit <n> --add-label 'Status: ☑️ Finalized'
```

Resolving a thread or approving a review starts no workflow, so a 10-minute sweep picks those up. Pause one PR with `Status: ⏸️ Paused`. After a merge the workflow dispatches `deploy.yml`, because pushes made with `GITHUB_TOKEN` start no `push` workflow. Missing labels are created on first use. A merge that fails (for example a PR that edits `.github/workflows/*`, which `GITHUB_TOKEN` cannot merge) fails the run so it shows up; merge those yourself.
