---
id: iphone-access
title: iPhone access
author: flanakin
description: "Per-device login and Web Push subscriptions so the owner's iPhone reaches Stack signed in and gets only time-critical pings."
dependencies: [auth-security, api, ask-queue, pwa, azure-host]
---

<!-- markdownlint-disable single-title -->

# Feature: iPhone access

## Purpose

Owner opens the installed Stack app on an iPhone, signed in as himself, and gets a push only when an ask is due within one hour. Each phone is a device the owner can revoke alone. Research: [research.md](research.md).

## Scope

- In: device records bound to API tokens, device admin endpoints, per-device push subscription storage and endpoints, push sender interface and a due-within-1h notifier (sender injected), host wiring.
- In (slice 2): real Web Push sender (RFC 8291 + RFC 8292 on `node:crypto`, transport injected), quiet hours, per-device dedupe, a check trigger on ask writes and on `POST /api/push/check`, the iOS install screen with a gesture-only permission request, and a service worker `push` handler.
- Non-goals (later): passkey login, pairing UI/QR (the install screen only reads a pairing link), offline answer queue, Tailscale/Cloudflare setup, the cron caller, native iOS app.

## Scenarios

### FR:device: Device login

Owner needs one revocable login per phone so that a lost phone is cut off alone.

- **FR:device.@http** (P1): Interface: `POST /api/auth/devices`, `GET /api/auth/devices`, `POST /api/auth/devices/{id}/revoke`, served by `auth.wrap(apiHandler)`
- **FR:device.session** (P1): These endpoints MUST be served to an owner session only; tokens MUST get `403` and unauthenticated callers `401`, with the same CSRF rule as token admin
- **FR:device.create** (P1): Create takes `{ name }` (1 to 80 single-line characters, strict fields) and answers `201` with the device and a one-time token. The token is an API token with scopes `tasks:read`, `tasks:write`, `projects:read` and 90 days of life, named `device:<name>`
  - **FR:device.create.once** (P1): The token MUST appear only in the create response
  - **FR:device.create.limit** (P1): Service MUST refuse more than 10 active devices (`409`)
  - **FR:device.create.atomic** (P1): When the device record cannot be saved, the new token MUST be revoked
- **FR:device.list** (P1): List returns `id`, `name`, `createdAt`, `revokedAt`, `status` (`active`/`revoked`) and `push` (boolean). It MUST NOT return the token id, hash, or subscription endpoint
- **FR:device.revoke** (P1): Revoke MUST revoke the bound token, drop the saved subscription, and mark the device revoked. A repeat changes no device state; an unknown id is `404`
  - **FR:device.revoke.retry** (P1): A repeat revoke MUST revoke the bound token again, so a failed first token revoke never leaves a live token
- **FR:device.login** (P1): A device token authenticates through the existing `authorize` hook with its scopes. After revoke it MUST answer `401` on the next request

### FR:sub: Push subscription

Phone needs to save its Web Push subscription so that the host can reach it.

- **FR:sub.@http** (P1): Interface: `PUT /api/auth/devices/me/push`, `DELETE /api/auth/devices/me/push`, `GET /api/auth/devices/me/push-key`
- **FR:sub.auth** (P1): These endpoints MUST accept a device token bound to an active device only. Owner sessions, unbound tokens and revoked devices MUST be denied (`401`/`403`)
- **FR:sub.put** (P1): Put takes `{ endpoint, keys: { p256dh, auth } }` (strict fields) and replaces the device's subscription. A device has at most one
  - **FR:sub.put.endpoint** (P1): Endpoint MUST be an `https` URL without credentials, at most 2048 characters, with a host from the push-service allow-list: `web.push.apple.com`, `*.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`. Anything else is `422`. This stops the host from posting to an arbitrary URL
  - **FR:sub.put.keys** (P1): `p256dh` and `auth` MUST be base64url strings of at most 128 characters
- **FR:sub.delete** (P1): Delete removes the subscription (`204`); a repeat is a no-op
- **FR:sub.key** (P1): Key answers `{ key }` with the VAPID public key from `STACK_VAPID_PUBLIC_KEY`, or `404` when unset. Never the private key
- **FR:sub.private** (P1): Subscriptions MUST NOT appear in any response, event or log

### FR:notify: Due-within-1h notifier

Owner needs a ping only for asks that are due soon so that every push is worth reading.

- **FR:notify.@function** (P1): Interface: `dueWithin(asks, now, ms?)` and `createPushNotifier({ devices, sender, now?, onEvent? }).notify(asks)`
- **FR:notify.select** (P1): `dueWithin` MUST return open asks whose `by` is after `now` and at most 60 minutes ahead (default), sorted earliest first. Past-due, later, no-deadline, snoozed and non-open asks are excluded
- **FR:notify.payload** (P1): One due ask sends `{ key, title }`; several send `{ key: <earliest>, title: "<n> asks due within 1h" }`. Titles lose control characters and are cut to 120 characters. No other task text
- **FR:notify.send** (P1): Notifier sends the payload to every active device's subscription through the injected `PushSender`. It MUST NOT import a network library; the host supplies the sender
- **FR:notify.prune** (P1): A `404` or `410` from the sender MUST remove that subscription; other failures keep it and are counted
- **FR:notify.isolate** (P1): A throwing sender MUST NOT stop delivery to other devices
- **FR:notify.none** (P1): With nothing due, or no subscriptions, the notifier MUST send nothing
- **FR:notify.events** (P2): `onEvent` gets `{ sent, removed, failed }` counts only (plus `skipped` from slice 2)
- **FR:notify.quiet** (P1): With `quiet` set (`{ start, end, timeZone }`, hours 0-23; host: `STACK_PUSH_QUIET` `21-8` default or `off`, in the config `timezone`), the notifier MUST send only `crit` asks while the local hour is in `[start, end)`. Other asks are not marked sent, so they push after quiet hours if they are still due. This replaces research §5 ("no quiet hours"): a 1h deadline set by an agent must not wake the owner unless it is `crit`
- **FR:notify.dedupe** (P1): With a `ledger`, a device MUST get at most one push per ask key and `by` value. Only a `2xx` marks the pair sent. A changed `by` is a new pair. Each device gets a payload built from its own unsent asks; a device with none gets nothing (`skipped`)
  - **FR:notify.dedupe.store** (P1): `createPushLedger(store)` keeps `{ version: 1, sent: { <deviceId>: { <askKey>: <by> } } }` over the `TokenStore` interface (version-checked, retried). Pairs whose `by` is more than 1h past are dropped on write. The host file is `.stack/push-sent.json` in the private data repo. It holds device ids, ask keys and times only
  - **FR:notify.serial** (P1): One notifier MUST run one check at a time. A check that starts while another runs waits for it, so two checks never read the same ledger state and push the same pair twice. Two host processes on one ledger are out of scope (the host is one process)

### FR:send: Web Push sender

Host needs to deliver the payload to Apple, Google and Mozilla push services so that the phone gets it with the app closed.

- **FR:send.@function** (P1): Interface: `createWebPushSender({ vapid: { publicKey, privateKey, subject }, transport?, now?, ttl? })` in `src/host/push-sender.ts`, returning a `PushSender`. `transport(req: { url, headers, body }) => Promise<{ status }>`; the default uses global `fetch` with `redirect: 'error'`
- **FR:send.encrypt** (P1): The body MUST be RFC 8291 `aes128gcm` (one record, record size 4096, padding delimiter `0x02`), keyed to the subscription's `p256dh` and `auth`. Output MUST match the RFC 8291 Appendix A vector when the salt and sender key are fixed
- **FR:send.vapid** (P1): Requests MUST carry `Authorization: vapid t=<ES256 JWT>, k=<public key>` (RFC 8292). Claims: `aud` = the endpoint origin, `exp` = now + 12h, `sub` = the subject (`mailto:` or `https:`). Headers also carry `TTL` (default 3600), `Urgency: high`, `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`
- **FR:send.keys** (P1): Keys are base64url: public 65 bytes (uncompressed P-256), private 32 bytes. Creation MUST fail with a value-free `PushConfigError` when a key is malformed, the private key does not match the public key, or the subject is not `mailto:`/`https:`
- **FR:send.allow** (P1): The sender MUST refuse (throw, no request) an endpoint outside the push-service allow-list (`FR:sub.put.endpoint`), so a bad stored record never makes the host post elsewhere
- **FR:send.size** (P1): A payload over 3993 bytes MUST throw before any request
- **FR:send.status** (P1): The sender resolves with the push service's status. `404`/`410` then prune the subscription through `FR:notify.prune`
- **FR:send.private** (P1): Keys, JWTs, endpoints and payloads MUST NOT appear in any log or event

### FR:check: Check trigger

Host needs a caller for the notifier so that a deadline that comes within 1h is pushed without the owner opening the app.

- **FR:check.@http** (P1): Interface: `POST /api/push/check` (body `{}` or empty), route name `push.check`, scope `tasks:write` or an owner session (CSRF rule applies). Answers `200` with `{ sent, removed, failed, skipped }` only, or `404` when push is not configured
- **FR:check.asks** (P1): A successful `POST /api/asks/{key}` (an ask write) MUST start the check and MUST NOT wait for it: the response returns at once. The check runs in the background, bounded by 30 s (`PushCheckTimeout`). A failed or timed-out check is logged through `onError` and MUST NOT change the ask response
- **FR:check.config** (P1): Push is configured when `STACK_VAPID_PUBLIC_KEY`, `STACK_VAPID_PRIVATE_KEY` and `STACK_VAPID_SUBJECT` are set and valid. A bad value logs `host: STACK_VAPID_* invalid` (no values) and leaves push off. The host also passes the storage ask listing through, so the host api lists asks
- **FR:check.read** (P1): The check reads open asks through the api handler (`asks.list`, limit 200), so it sees what the owner sees
- **FR:check.cron** (P2, human): A scheduler (GitHub Actions cron or the Mac host) calls `POST /api/push/check` every 5 minutes with a token. Not built here

### FR:install: iOS install and permission screen

Owner needs plain steps on the iPhone so that Stack lands on the Home Screen and push is turned on from the installed app.

- **FR:install.@ui** (P1): Screen at `/#/install`, rendered in place of the app shell, max 480 px wide, safe-area padded, no sideways scroll at 320 px
- **FR:install.detect** (P1): `platformOf({ userAgent, maxTouchPoints, standalone, push })` MUST report `ios` for iPhone/iPod/iPad user agents and for iPadOS (Mac user agent with more than 1 touch point), `safari` when no `CriOS`/`FxiOS`/`EdgiOS`/`OPiOS` token is present, and `standalone` from `display-mode: standalone` or `navigator.standalone`
- **FR:install.steps** (P1): The screen shows one step: iOS Safari in a tab → Add to Home Screen steps (Share, Add to Home Screen, open Stack from the Home Screen); iOS other browser → `Open this page in Safari`; standalone with push → `Turn on notifications`; standalone without `PushManager` → `Update to iOS 16.4 or later`; not iOS → `Install from your browser menu`, or `You are set` when standalone
- **FR:install.gesture** (P1): `Notification.requestPermission` MUST be called only from the `Turn on notifications` click. Rendering, focus and reloads MUST NOT call it
- **FR:install.subscribe** (P1): After `granted`, the page gets the key (`GET /api/auth/devices/me/push-key`), calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, and saves it (`PUT /api/auth/devices/me/push`) with the device token. `denied` shows `Blocked: allow notifications for Stack in Settings > Notifications`; no subscribe
- **FR:install.pair** (P2): `/#/install?device=<token>` stores the token in browser storage under `stack.device` and replaces the hash with `#/install` at once. The token goes only to `/api/auth/devices/me/*`. Without a token the enable step says `Pair this phone first` and stays disabled
- **FR:install.sw** (P1): The service worker shows each `push` as a notification (title from the payload, tag = ask key, data url `/#/asks`), so iOS never sees a silent push. A malformed payload shows `Stack: an ask is due soon`

### FR:queue: Offline answers (P3, design)

- **FR:queue.design** (P3): Answers made offline are kept in IndexedDB and replayed through `POST /api/asks/{key}/answer` when online and on every foreground. The host commits them to `main`; the Mac pulls. A refused replay (ask changed) is dropped with one toast. Not built in this release

### FR:passkey: Passkey login (P3, design)

- **FR:passkey.design** (P3): WebAuthn registration and assertion mint a device token (same model as `FR:device`). Verified only after a passkey ceremony works in the installed iOS app on the owner's device

### Non-functional Requirements

- **NFR:security** (P1): No new runtime dependency (the sender uses `node:crypto`, not `web-push`). Device and subscription data live in `.stack/devices.json` in the private data repo (written through the storage adapter, version-checked like tokens). A push endpoint alone cannot send: sending needs the VAPID private key, a host secret that is never stored in the repo
- **NFR:cost** (P1): $0. Push services are free; no paid provider

## Data Model

- **FR:$device** (P1): **`Device`** — `id` (16 hex), `name`, `tokenId`, `createdAt`, `revokedAt` (ISO or null), `push` (`{ endpoint, p256dh, auth, updatedAt }`, optional)

## Architecture Constraints

- Code in `src/api/auth/devices.ts` (service, store use) and `src/api/push.ts` (selection, notifier, sender interface). Endpoints live in `createAuth` so they reuse the owner-session and deny rules.
- The device store reuses the `TokenStore` interface; `GitTokenStore` takes a path.

## External Dependencies

Web Push services (Apple, Google, Mozilla), Web Push encryption (RFC 8291), VAPID (RFC 8292). Human steps: VAPID keys, host secrets, the cron caller, and the tunnel choice (see the PR).
