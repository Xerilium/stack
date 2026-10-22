---
id: chat-bots
title: Chat Bots Plan
---

# Plan: Chat Bots

## Approach

`src/bots/` is pure `(Request) => Promise<Response>`. Commands parse to a small union, run against an injected `Client`, and return plain text. `apiClient` adapts the api handler in-process (no network). Auth-security supplies the real `authorize`; the bot just forwards configured headers.

## Contracts

- `createBotHandler`, `BotDeps`, `parseCommand`, `runCommand`, `apiClient`, `Client`, `verifySlack`, `verifyWebhook`, `verifyGithub`

## Decisions

- Modules: `verify.ts` (HMAC, replay, timing-safe), `commands.ts`, `client.ts`, `handler.ts` (body reading, channels, allow-list, router)
- Order per request: method/route -> read capped raw body -> signature -> parse -> allow-list -> command
- Fixed error text; allow-list and signature failures never say which part failed
- Replies are response bodies; delivery is the bridge's or workflow's job
- Optional capture: not imported; `add` is the seam
- Build: `tsconfig.bots.json` added to `pnpm build` and lint
- Tests: `tests/bots/*.test.ts`, API handler over `MemoryStorage`, no network
