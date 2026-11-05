# Plan: Inbox Page

## Slices

1. Core `src/inbox/`: types, action catalog, `fromTriage`, `order`, `runAction`, `requestAction`. Tests first.
2. Connectors: `src/inbox/chat.ts` interfaces, Teams and Slack mappers, guards, fixtures.
3. API: `GET /inbox`, `POST /inbox/{id}/action`. Store is `.stack/inbox-items.json` in the owner's data repo.
4. Web: `InboxView`, nav entry `g i`, e2e at 1280 and 375 px.

## Not in this slice (human-only)

- Teams: Entra app permission `Chat.Read` (delegated, work account), sign in with `stack graph login`.
- Slack: create a Slack app, add user scopes, install to the workspace, store the `xoxp-` token in the local secret store.
- Real runner writes items after each email pass.
