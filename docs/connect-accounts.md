# Connect Microsoft accounts

Stack reads mail and calendar from Outlook.com and from work or school (Microsoft 365) accounts. You connect each account in the app. No terminal. Stack never sends.

## The one-time step (once, for all accounts)

Stack needs its own sign-in app in Entra ID. You create it once:

1. Open PowerShell 7 and run `Connect-AzAccount`. Sign in with the Azure account that should own the Stack app.
2. In Stack, open Inbox (or Now › Calendar › Connect) and click **Run setup**.

That is all. Stack runs `scripts/register-stack-app.ps1` for you. The script never takes a password.

The script (Az PowerShell only):

- Creates or reuses one app named `Stack (Xerilium)`.
- Lets personal Microsoft accounts and work or school accounts sign in (`AzureADandPersonalMicrosoftAccount`).
- Is a public client with the loopback redirect `http://localhost`. It has no secret.
- Asks only for delegated Microsoft Graph permissions: `Mail.Read`, `Calendars.Read`, `offline_access`, `openid`, `profile`, and `Mail.ReadWrite` (asked for only when you turn on reply drafts for an account). Never `Mail.Send`.
- Saves the app id to `~/.config/stack/config.json` as `graph.clientId`.

Without PowerShell 7 and the Az module: install them (`brew install powershell`, then `Install-Module Az -Scope CurrentUser`), then click Run setup again.

You can also run it yourself: `pwsh -File scripts/register-stack-app.ps1`. Add `-WhatIf` to see what it would change.

## Connect an account

1. Click **Connect a Microsoft account** (or **Add another account**).
2. Your browser opens the Microsoft sign-in page. Pick the account and accept.
3. Stack shows the account as Connected. Its mail shows in Inbox and its calendar in Now and My day.

If the browser cannot open, Stack shows a code in the page. Open microsoft.com/devicelogin, enter the code, and sign in. Stack checks every 2 seconds.

Repeat for each account. Outlook.com, Hotmail and Live accounts are personal; Microsoft 365 accounts are work or school.

## Reply drafts

Each account is read-only by default. Turn on **Reply drafts** to let Stack save reply drafts in that mailbox. Microsoft asks you to accept once. Stack never sends: you send each draft yourself from Outlook. Turn it off to go back to read scopes. Turning it off does not remove the consent you gave Microsoft: to remove it, see account.live.com/consent/Manage (personal) or myapps.microsoft.com (work or school).

## Live calendar

When an account with a calendar is connected, Now and My day read your events from Microsoft Graph. Stack keeps a copy for 3 minutes and an open page reads again every 5 minutes. Events from all your accounts show together; the same meeting on two calendars shows once. A published ICS link stays as the fallback when no account is connected.

## Where tokens live

Each account has one token file: `~/.config/stack/graph-token-<address>.json`, mode `0600`. Stack never logs a token and never shows it in the page. **Disconnect** deletes the file. To remove Stack's access in Microsoft too, see account.live.com/consent/Manage (personal) or myapps.microsoft.com (work or school).

## When an account says Sign-in expired

Click **Sign in again**. Microsoft can end a sign-in after a password change or long inactivity.
