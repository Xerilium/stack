<!-- @req FR:live-deploy/setup.doc @req FR:deploy-stack-xerilium-com/domain.doc @req FR:deploy-stack-xerilium-com/branch.doc -->
# Set up live Stack (owner only)

About 15 minutes, once. After this, Stack is always on at `https://stack.xerilium.com`. It needs no server on your Mac, works on your phone, and reads and writes the `stack/live` branch of `flanakin/todo`. It never commits to `main`. Why this design: [hosting.md](hosting.md). Auth: [deploy-auth.md](deploy-auth.md).

Agents never do these steps. They create a credential and an Azure resource.

## Go-do

1. **Create the repo token** (2 min)
   1. Open [this pre-filled form](https://github.com/settings/personal-access-tokens/new?name=Stack+live+app&description=Stack+web+app+reads+and+writes+tasks&target_name=flanakin&expires_in=366&contents=write). It sets name, owner, 366-day expiry, and Contents: Read and write.
   2. **Repository access**: pick **Only select repositories**, then **flanakin/todo**.
   3. Under **Permissions**, check that only **Contents: Read and write** and **Metadata: Read-only** (required, added automatically) are set.
   4. Click **Generate token**, then copy it. Don't paste it anywhere else.
2. **Run setup** (5 min). In PowerShell 7 in this repo:

   ```powershell
   Connect-AzAccount
   ```

   ```powershell
   scripts/setup-azure.ps1
   ```

   Pick the Stack subscription from the list (not the FH one), or pass `-Subscription <name or id>`. Paste the token at the hidden prompt. The script creates branch `stack/live` from `main` if it is missing, resource group `stack-rg`, and the Free Static Web App `stack-app`. It sets the app settings, prints the DNS record for step 3, stores the deploy secret on Xerilium/stack, then starts the Deploy workflow and prints your URL.
3. **Point the domain** (2 min, then wait for DNS). At the DNS host for `xerilium.com`, add one record:

   | Type | Host | Value | TTL |
   | --- | --- | --- | --- |
   | `CNAME` | `stack` | `<app>.azurestaticapps.net` (the default hostname the script printed) | default |

   Wait until `dig +short stack.xerilium.com` shows that hostname, then re-run `scripts/setup-azure.ps1` and press Enter at the token prompt. It adds the domain. The free certificate is ready within about an hour.
4. **Sign in and claim it** (1 min). When the Deploy run is green, open `https://stack.xerilium.com` (or the printed URL) in Edge and sign in with GitHub. The first time, you'll see **Not on the allow-list** with a command like `scripts/setup-azure.ps1 -Owner github:1a2b…`. Copy it, run it, and reload. From then on only your account gets in. Azure gives each app its own user id, so this step can't happen earlier.
5. **Install as an app** (30 s). In Edge, open the **…** menu, then **Apps**, then **Install this site as an app**, then **Install**. To keep it in the Dock, right-click its icon, then **Options**, then **Keep in Dock**. On iPhone, use Edge or Safari: **Share**, then **Add to Home Screen**.

## What you get

- Live data is the `stack/live` branch of `flanakin/todo`. Every change you make in Stack is a commit there by "Stack", never on `main`. Undo any change with `git revert` on `stack/live`.
- Agents that push ask files to `main` do not show until `main` is merged into `stack/live` (follow-up). Agents that use `POST /api/asks/<key>` with a token show within about 15 s.
- To bring app edits to `main`, open a PR from `stack/live` to `main` when you want them there.
- The Asks view shows the sync state: **Synced 3:12 PM**, **Offline · retrying** with **Retry now**, or **Sign-in expired** with **Sign in**.

## Undo or rotate

| What | How |
| --- | --- |
| Rotate the repo token | Make a new token (step 1), re-run `scripts/setup-azure.ps1`, paste the new one, then delete the old token at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) |
| Re-run setup | Safe. Press Enter at the prompt to keep the current token. Only the settings it owns change; the pepper and every other setting are kept |
| Move the live branch | `scripts/setup-azure.ps1 -Branch <new name>`. It creates the branch from the current live branch, so tokens, devices, and revocations move with it. A branch that already exists is refused |
| Remove the domain | Delete the `stack` CNAME, then `Remove-AzStaticWebAppCustomDomain -ResourceGroupName stack-rg -Name stack-app -DomainName stack.xerilium.com` |
| Turn it all off | `Remove-AzResourceGroup -Name stack-rg`, then delete the `stack` CNAME, delete the token and the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret on Xerilium/stack |

## If something is off

- Deploy run skipped: the deploy secret is missing. Re-run setup.
- Script says it could not add the domain: the CNAME is missing or DNS has not spread yet. Check `dig +short stack.xerilium.com`, then re-run.
- **Not on the allow-list** after step 4: run the command that page shows, then reload. `-Owner` replaces the owner, so run it only when that page is signed in as you. If Stack already worked before, you are signed in with a different GitHub account: sign out and sign in as yourself instead.
- Asks shows **Offline · retrying** while you're online: the token expired or lost access. Rotate it (above).
- Reference: [runbook](runbook.md), [Azure host settings](azure-host.md).
