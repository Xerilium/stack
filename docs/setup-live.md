<!-- @req FR:live-deploy/setup.doc -->
# Set up live Stack (owner only)

About 10 minutes, once. After this, Stack is always on at an `*.azurestaticapps.net` URL. It needs no server on your Mac, works on your phone, and reads and writes `flanakin/todo` on GitHub. Why this design: [hosting.md](hosting.md).

Agents never do these steps. They create a credential and an Azure resource.

## Go-do

1. **Create the repo token** (2 min)
   1. Open [this pre-filled form](https://github.com/settings/personal-access-tokens/new?name=Stack+live+app&description=Stack+web+app+reads+and+writes+tasks&target_name=flanakin&expires_in=366&contents=write). It sets name, owner, 366-day expiry, and Contents: Read and write.
   2. **Repository access**: pick **Only select repositories**, then **flanakin/todo**.
   3. Under **Permissions**, check that only **Contents: Read and write** and **Metadata: Read-only** (required, added automatically) are set.
   4. Click **Generate token**, then copy it. Don't paste it anywhere else.
2. **Run setup** (5 min). In a terminal in this repo:

   ```bash
   az login
   ```

   ```bash
   scripts/setup-azure.sh
   ```

   Paste the token at the hidden prompt. The script creates resource group `stack-rg` and the Free Static Web App `stack-app`. It sets the app settings and stores the deploy secret on Xerilium/stack, then starts the Deploy workflow and prints your URL.
3. **Sign in and claim it** (1 min). When the Deploy run is green, open the printed URL in Edge and sign in with GitHub. The first time, you'll see **Not on the allow-list** with a command like `scripts/setup-azure.sh --owner github:1a2b…`. Copy it, run it, and reload. From then on only your account gets in. Azure gives each app its own user id, so this step can't happen earlier.
4. **Install as an app** (30 s). In Edge, open the **…** menu, then **Apps**, then **Install this site as an app**, then **Install**. To keep it in the Dock, right-click its icon, then **Options**, then **Keep in Dock**. On iPhone, use Edge or Safari: **Share**, then **Add to Home Screen**.

## What you get

- Tasks and asks from `flanakin/todo` `main`. Agents keep committing ask files and pushing to `main`, and the page shows them within about 15 s.
- Every change you make in Stack is a commit on `main` by "Stack". Undo any change with `git revert`.
- The Asks view shows the sync state: **Synced 3:12 PM**, **Offline · retrying** with **Retry now**, or **Sign-in expired** with **Sign in**.

## Undo or rotate

| What | How |
| --- | --- |
| Rotate the repo token | Make a new token (step 1), re-run `scripts/setup-azure.sh`, paste the new one, then delete the old token at [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) |
| Re-run setup | Safe. Press Enter at the prompt to keep the current token. Only the settings it owns change; the pepper and every other setting are kept |
| Turn it all off | `az group delete -n stack-rg`, then delete the token and the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret on Xerilium/stack |

## If something is off

- Deploy run skipped: the deploy secret is missing. Re-run setup.
- **Not on the allow-list** after step 3: run the command that page shows, then reload. If it still shows, you signed in with a different GitHub account.
- Asks shows **Offline · retrying** while you're online: the token expired or lost access. Rotate it (above).
- Reference: [runbook](runbook.md), [Azure host settings](azure-host.md).
