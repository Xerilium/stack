# Inbox sources

The Inbox page lists every source it reads and says how to connect each one. It says "Inbox zero" only when at least one source synced in the last 30 minutes. Stack never sends.

Check from a terminal: `stack inbox sources` (add `--json` for scripts). The page has the same list under **Inbox sources**, with **Check connection**.

## States

| State | Meaning |
| --- | --- |
| Connected (`ok`) | Synced within the freshness window |
| Behind (`stale`) | Signed in; the last sync is older than the window |
| First sync pending (`connecting`) | Signed in; no sync has run yet |
| Needs a fix (`error`) | The last sync failed: sign-in expired, Claude down, or another failure |
| Not connected (`not-connected`) | No sign-in found |

The window is `inbox.freshMinutes` in `.xe/config/stack.json` (default 30). List mailboxes you expect, so a missing sign-in shows as not connected:

```json
{ "inbox": { "freshMinutes": 30, "accounts": ["you@company.com", "you@outlook.com"] } }
```

## Email

One sign-in per mailbox. Work, school and Outlook.com accounts all work.

1. Read-only: `stack graph login --client-id <app id> --account you@outlook.com --with mail`.
2. To let Stack write reply drafts too: `--with mail,drafts`. Drafts stay in Outlook until you send them.
3. Run the first sync: `stack email run --account you@outlook.com`. Schedule every mailbox: `stack email schedule` (see `docs/email-runner.md`).

Each run writes a sync record to `.stack/inbox-sources.json` in your data repo: kind, account, time, ok, and an error code. No token and no mail text.

Sign-in expired: run the same `stack graph login` command again for that address.

## GitHub

Sign in to the GitHub CLI (`gh auth login`), or set `GITHUB_TOKEN` for the Stack host. Read only: Stack never posts. The page shows the sign-in now. GitHub counts as a source once a GitHub inbox sync runs; none is scheduled yet.

## Teams

Not wired yet. It will need a work or school account and the delegated `Chat.Read` permission on the Stack app registration. Personal Microsoft accounts have no Teams chat API. Read only.

## Slack

Not wired yet. It will need a Slack app with a user token (`xoxp-`) and these user scopes: `im:read`, `mpim:read`, `channels:read`, `groups:read`, and the matching `*:history`. Read only.
