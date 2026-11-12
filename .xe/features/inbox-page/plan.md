# Plan: Inbox Page

## Slices

1. Core `src/inbox/`: types, action catalog, `fromTriage`, `order`, `runAction`, `requestAction`. Tests first.
2. Connectors: `src/inbox/chat.ts` interfaces, Teams and Slack mappers, guards, fixtures.
3. API: `GET /inbox`, `POST /inbox/{id}/action`. Store is `.stack/inbox-items.json` in the owner's data repo.
4. Web: `InboxView`, nav entry `g i`, e2e at 1280 and 375 px.

5. Runner (`src/inbox/runner.ts`): `syncInbox`, `runInbox`; email pass hook `onResults`.
6. Live transports (`src/inbox/live.ts`): Teams and Slack over injected HTTP.
7. Host: `HostDeps.issues`, default `ghIssueFiler()`.

## Not in this slice (human-only)

- Teams: Entra app permission `Chat.Read` (delegated, work account), sign in with `stack graph login`.
- Slack: create a Slack app, add user scopes, install to the workspace, store the `xoxp-` token in the local secret store.

8. Source status (`src/inbox/sources.ts` pure, `src/inbox/probe.ts` local): records, probe, state, summary, help. `stack email run` writes records.
9. API: `sources` and `summary` on `GET /inbox-items`, `GET /inbox-sources`. Local host passes the probe.
10. CLI: `stack inbox sources [--json]`.
11. Web: sources panel, empty state from the headline, Check connection, rail and More dot. e2e and axe at 1280 and 375 px.
