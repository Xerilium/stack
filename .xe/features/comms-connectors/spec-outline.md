# Spec Outline: Comms Connectors

Not a spec. Headings for the spec that follows approval.

## Purpose

One connector contract. Any source yields `InboxItem`s. Stack ranks them by the signal the owner must act on.

## Contract

- Extend the existing contract in `src/inbox/types.ts`. Do not add a parallel type.
- `Source`: add `github | calendar | youtube | gmail | instagram | x | imessage`.
- `InboxItem` already has `id`, `source`, `account`, `from`, `subject`, `receivedAt`, `unread`, `urgency`, `summary`, `suggested`, `actions`, `link`, `kind`. Add `signal`, `due?` and `accountKind: personal|work`.
- Connector: generalize `ChatConnector.unread()` to `poll(cursor) -> {items, cursor}` with `capabilities{read, draft, send}`. Keep `unread()` working for Teams and Slack.
- `signal`: `reply | mention | deadline | approval | fyi`. See research.md.
- `send` is false for every connector in v1. Drafts only.

## Scenarios

1. Poll: a connector run reads from its cursor, stores the new cursor atomically.
2. Classify: deterministic rules first (GitHub `reason`, calendar RSVP state), a small model only for free text.
3. Rank: signals feed the Chief-of-Staff list and the inbox page (`inbox-page`).
4. Draft: a bigger model drafts replies for `reply` items. Human reviews. Nothing posts.
5. Accounts: personal and work stay separate. Each has its own token and state file.
6. Failure: auth expiry (Gmail 7-day token) raises an ask, not a silent gap.
7. Cost cap: a per-connector monthly cap (X, models). Over cap -> pause + ask.

## Safety

- No send, forward or post code paths. Tests prove it, as in `FR:cli.nosend`.
- Inbound text is fenced as data. No tool access for classifier models.
- Tokens at mode 0600. Never logged.
- Local Mac agent (iMessage) is opt-in and read-only.

## Out of scope

LinkedIn inbox scraping. Unofficial WhatsApp clients. Auto-posting to any public surface.

## Dependencies

`email-runner`, `inbox-page`, `day-inputs`, `graph-signin`, `auto-priority`, `desktop-app` (iMessage).
