---
id: chat-bots
title: Chat Bots
author: flanakin
description: "Message in, task out: Slack, iMessage (local bridge), generic webhooks, and GitHub Actions hooks over the API, with signature checks and a deny-by-default sender allow-list."
dependencies: [api]
---

<!-- markdownlint-disable single-title -->

# Feature: Chat Bots

## Purpose

Ask "what's next" and add, start, complete, or skip tasks from chat or automation. Channel adapters are pure `Request -> Response` handlers over the API; they hold no state and call no network themselves.

## Scope

- In: command parsing, Slack slash commands, iMessage via a local bridge webhook, generic signed webhooks, GitHub webhooks (for Actions), signature checks, sender allow-list.
- Out: sending replies to channels (the reply is the HTTP response; a bridge or Action delivers it), new channels, Apple APIs, auth tokens (auth-security), quick capture (optional future dependency: capture input MAY later be routed through `add`).

## Scenarios

### FR:cmd: Commands

- **FR:cmd.parse** (P1): Text is trimmed and matched case-insensitively. `next`, `what's next`, `whats next`, `what next`, `?` -> next. `add <project> <text>`, `complete|done [ref] [summary]`, `start [ref]`, `skip [ref]`, `help`. An optional leading `/stack` is ignored. Anything else is `help`-style usage text, never an error
- **FR:cmd.limits** (P1): Text over 2000 characters, or containing CR/LF/U+0085/U+2028/U+2029 after trimming, is rejected with a fixed message
- **FR:cmd.ref** (P1): A ref is `project:line`; if the second word does not look like a ref it is part of the summary (complete) or invalid (start, skip)
- **FR:cmd.run** (P1): Commands call the API through an injected `Client` (`next`, `add`, `start`, `complete`, `skip`) and return a short plain-text reply: `Next: <text> (<project>) [<ref>]`, `Nothing active`, `Added <ref>`, `Started <ref>`, `Completed <ref>`, `Skipped <ref>`. API errors map to fixed text (`Not found`, `Invalid input`, `Failed`); core messages are never echoed; unexpected failures (no HTTP status, or 5xx) are reported to `onError` by class name only
- **FR:cmd.client** (P1): `apiClient(handler, headers)` builds a `Client` over a `(Request) => Promise<Response>` (the API handler), sending the supplied headers (for the API's `authorize` hook) to `https://bots.invalid/api`. No real network is used

### FR:sig: Signatures

- **FR:sig.slack** (P1): `X-Slack-Signature` is `v0=` + hex HMAC-SHA256 of `v0:{X-Slack-Request-Timestamp}:{raw body}` with the signing secret
- **FR:sig.replay** (P1): Timestamp MUST be an integer number of seconds within a replay window (default 300) of now; otherwise rejected. Applies to Slack and the generic webhook/iMessage signature
- **FR:sig.webhook** (P1): `X-Stack-Signature` is `sha256=` + hex HMAC-SHA256 of `{X-Stack-Timestamp}.{raw body}` with the shared secret
- **FR:sig.github** (P1): `X-Hub-Signature-256` is `sha256=` + hex HMAC-SHA256 of the raw body with the webhook secret
- **FR:sig.compare** (P1): Digests are compared with `crypto.timingSafeEqual` (length checked first); malformed headers fail closed
- **FR:sig.order** (P1): Signature is checked on the raw body before the body is parsed. A missing secret config denies (401)

### FR:allow: Sender allow-list

- **FR:allow.deny** (P1): Each channel has its own allow-list; empty or absent denies every sender (403). Slack matches `user_id`, iMessage and webhook match `sender` (compared case-insensitively after trimming; phone numbers as given), GitHub matches `sender.login`
- **FR:allow.order** (P1): The allow-list is checked before any command runs or any API call is made

### FR:slack: Slack

- **FR:slack.command** (P1): Slash command (`application/x-www-form-urlencoded`: `user_id`, `text`) answers `200 {"response_type":"ephemeral","text":reply}`
- **FR:slack.challenge** (P2): JSON `url_verification` bodies are answered with the challenge only after a valid signature

### FR:webhook: Generic webhook and iMessage

- **FR:webhook.contract** (P1): `POST /webhook` with JSON `{sender, text}` answers `200 {reply}`
- **FR:webhook.imessage** (P1): `POST /imessage` is the same contract with `{sender, text, guid?}` for a local bridge. The bridge runs on the user's Mac, signs requests as in FR:sig.webhook, posts them, and sends `reply` back via iMessage itself. Documented in `docs/bots/README.md`; no Apple API is called here
- **FR:webhook.shape** (P1): Unknown or non-string fields, bodies over 64 KiB (stream-capped), non-JSON, or wrong content type are rejected (400/413/415)

### FR:github: GitHub Actions hooks

- **FR:github.event** (P1): `X-GitHub-Event: issue_comment` with `action: created` runs a comment whose body starts with `/stack ` (the rest is the command) and answers `200 {reply}`; other events or comments answer `200 {"ignored":true}`. `ping` answers `200 {"pong":true}`
- **FR:github.deliver** (P2): The reply is returned for a workflow or app to post; this feature does not call GitHub

### FR:router: Handler

- **FR:router.@function** (P1): `createBotHandler(deps): (req) => Promise<Response>`; routes `POST {basePath}/slack|imessage|webhook|github` (default basePath `/bots`). `deps = { client, slack?: {signingSecret, allow}, imessage?, webhook?: {secret, allow}, github?: {secret, allow}, now?, replayWindowSeconds?, onError? }`; a channel with no config answers `404`
- **FR:router.errors** (P1): Failures use fixed JSON `{"error":{"code","message"}}`: 401 `unauthorized` (bad/missing signature or stale timestamp, all the same message), 403 `forbidden`, 404, 405, 400/413/415. Unexpected errors are `500 internal` with fixed text
- **FR:router.nolog** (P1): No message text, sender, ref, or task data is ever logged or passed to `onError`; `onError` gets only the error's class name
