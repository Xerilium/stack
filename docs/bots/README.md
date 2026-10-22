# Chat bots

`createBotHandler` (src/bots) is a `(Request) => Promise<Response>` handler. It calls the Stack API in process through `apiClient(apiHandler, headers)`; the headers satisfy the API's `authorize` hook. Replies are the HTTP response body. Nothing here calls Slack, GitHub, or Apple.

Commands: `next` (also `what's next`, `?`), `add <project> <text>`, `start [ref]`, `done [ref] [summary]`, `skip [ref]`, `help`. Refs look like `project:12`.

All channels: `POST {basePath}/{channel}` (default `/bots`), body max 64 KiB, deny by default (no secret means the channel is off; empty allow-list means every sender gets 403). Sender match is case-insensitive. Signatures are verified over the body decoded as UTF-8, so a validly signed non-UTF-8 body is rejected (fails closed, never bypassed). Failures are fixed JSON errors; no message or task data is logged.

| Channel | Path | Signature | Sender |
| --- | --- | --- | --- |
| Slack slash command | `/slack` | `X-Slack-Signature` = `v0=` + HMAC-SHA256(`v0:{X-Slack-Request-Timestamp}:{body}`), 5 min replay window | `user_id` |
| Generic webhook | `/webhook` | see below | `sender` |
| iMessage bridge | `/imessage` | see below | `sender` |
| GitHub webhook | `/github` | `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(body) | `sender.login` |

## Webhook and iMessage bridge contract

Request: `Content-Type: application/json`, body `{"sender": "...", "text": "...", "guid"?: "..."}` (no other fields).

Headers: `X-Stack-Timestamp` (integer epoch seconds, within 300 s of server time) and `X-Stack-Signature: sha256=<hex HMAC-SHA256 of "{timestamp}.{raw body}" with the shared secret>`.

Response `200 {"reply": "..."}`. The bridge sends `reply` back to the sender; Stack never contacts Apple.

The bridge is a small local process on the user's Mac that reads new messages (for example from an allow-listed number), signs and posts them to `/imessage`, and sends the reply with iMessage. Use a separate secret and allow-list from `/webhook`. Sender is the phone number or Apple ID exactly as the bridge sends it.

## GitHub Actions

Point a repository webhook (content type JSON, event: Issue comments) at `/github`. A new comment starting with `/stack ` runs the rest as a command if the commenter is in the allow-list; the response is `{"reply": "..."}` for a workflow to post.

**Warning:** the reply to `next` contains private task text. A workflow that posts it as a public issue comment leaks it. Use private repositories only, or post the reply nowhere public. GitHub sends no timestamp, so there is no replay protection beyond the secret. Other events return `{"ignored": true}`; `ping` returns `{"pong": true}`.

## Wiring

```ts
const api = createApiHandler({ storage, authorize });
const bots = createBotHandler({
  client: apiClient(api, { authorization: 'Bearer <service token>' }),
  slack: { signingSecret, allow: ['U123'] },
  webhook: { secret, allow: ['ci-bot'] },
  imessage: { secret: other, allow: ['+15551234567'] },
  github: { secret: ghSecret, allow: ['octocat'] },
});
```

Deploy notes: bot secrets are app settings like the others; see the [runbook](../runbook.md).
