# Research: Inbox Page

## Actions needed

| Action | Status | Source |
| --- | --- | --- |
| reply-draft | ready | email-triage `createReply` (PR 79 and main) |
| mark-done, snooze, ask-me-later | ready | ask-queue `handleAsk`, `answerAsk` defer |
| create-task | ready | task-lifecycle add |
| archive | missing as 1-click | exists only as an approved batch (email-inbox-zero `FR:batch.archive`) |
| unsubscribe | missing as 1-click | exists as sub ask, RFC 8058 (email-inbox-zero `FR:sub.unsubscribe`) |
| delegate to agent | missing | agent-inbox |
| schedule/calendar | missing | calendar feature is read only |
| forward-draft | missing | Graph `createForward` is on the guard deny list |

## Teams unread

- `GET /me/chats?$expand=lastMessagePreview`: compare `lastMessagePreview.createdDateTime` to `viewpoint.lastMessageReadDateTime`. Docs: https://learn.microsoft.com/en-us/graph/api/chat-list (example 4 states this method).
- Delegated scopes: `Chat.ReadBasic`, `Chat.Read`, `Chat.ReadWrite`. Personal Microsoft account: "Not supported". Same page.
- `$top` max 50; follow `@odata.nextLink`.
- Application permissions need admin consent and are out of scope.

## Slack unread

- `users.conversations` lists the user's channels. User scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`. Tier 3. https://docs.slack.dev/reference/methods/users.conversations
- `conversations.info`: `unread_count` and `unread_count_display` appear for DMs only. Use `last_read` plus `conversations.history` with `oldest=last_read` for channels. https://docs.slack.dev/reference/methods/conversations.info
- `conversations.history`: user scopes `channels:history`, `groups:history`, `im:history`, `mpim:history`. Tier 3. https://docs.slack.dev/reference/methods/conversations.history
- Unverified: whether `last_read` is returned for channels with a user token. Check on first live run.
- Unverified: Slack's 2025 rate limit cut for non-Marketplace apps. Internal apps are said to be exempt. Check before first live run.

## Reuse

PR 76 (all inboxes, per-account token cache, `listCachePaths`) and PR 79 (top asks home) are open. This slice builds on main only and uses `TriageResult`, `toAsk`, `MailProvider`.
