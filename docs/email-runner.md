# Email runner runbook

The runner reads your inboxes and writes reply drafts and asks. It cannot send mail. Only you can do the steps marked **Human**.

## Safety limits

- The app asks for `Mail.Read` or `Mail.ReadWrite`. It never asks for `Mail.Send`. Sign-in refuses it.
- Every Graph request passes an allowlist. Send, forward, reply, reply-all, delete and copy are refused.
- The only writes: a category tag, a reply draft (`createReply`), and a move to Archive or Junk that you approved.
- You send every draft yourself from Outlook.

## Try it with no network

1. Run: `stack email run --dry-run --offline`.
2. Add mail from a file: `--fixture messages.json`. The file is a JSON array of Graph message objects (`id`, `conversationId`, `subject`, `from.emailAddress`, `receivedDateTime`, `bodyPreview`).
3. Nothing leaves the machine. No sign-in, no `claude`, no Graph. State and asks stay in memory.

## Human: register the Azure app (once)

1. Open Entra ID > App registrations > New registration.
2. Pick "Accounts in any organizational directory and personal Microsoft accounts".
3. Leave the redirect URI empty.
4. Open Authentication. Set **Allow public client flows** to Yes.
5. Open API permissions > Add > Microsoft Graph > Delegated: `Mail.ReadWrite` and `offline_access` (add `Calendars.Read` if you use the calendar).
6. Do not add `Mail.Send`.
7. Copy the Application (client) ID.

## Human: sign in to each inbox

Repeat for every inbox. The cache is one file per address in `~/.config/stack/`, mode 0600.

1. Work or school inbox: `stack graph login --client-id <app id> --account you@company.com --with mail,drafts`.
2. Personal inbox (outlook.com, hotmail.com, live.com, msn.com): use the same command with the personal address. Stack picks the `consumers` tenant for these domains. Add `--tenant consumers` to force it.
3. Open the printed URL, enter the code, and sign in as that address. Approve the permissions.
4. Run `stack graph status --account <address>`. Check the scopes: `Mail.ReadWrite`, no send.
5. If login says `unsafe_scope`, remove the named permission from the app and revoke the consent already granted (Entra ID > Enterprise applications > the app > Permissions). Then log in again.

## Human: first pass, then voice

1. `stack email run --all --dry-run`. This reads each inbox and writes nothing.
2. `stack email voice --account <address>` for each inbox. It learns your tone from Sent Items.
3. `stack email run --all` once, by hand. Check the asks and drafts in Outlook.

## Human: install the schedule (macOS)

1. Print the plist: `stack email schedule --dir <content repo> --remote origin > ~/Library/LaunchAgents/com.xerilium.stack-email.plist`.
2. Read the file. It runs `email run --all` every 15 minutes with absolute paths.
3. Install: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.xerilium.stack-email.plist`.
4. Check: `stack email status --all`. Logs are in `$STACK_DATA_DIR/email/<account>/run.log`.
5. Stop: `launchctl bootout gui/$(id -u)/com.xerilium.stack-email`.

## Fixes

- Exit 4, "not signed in": run `stack graph login` again for that address.
- Exit 4, "a pass is already running": wait. A lock older than 30 minutes is taken over.
- Exit 4, over `--max`: rerun with a higher `--max`.
- One inbox fails: the others still run. `--all` lists each result.
