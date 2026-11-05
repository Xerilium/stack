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
- Non-goals (later): passkey login, pairing UI/QR, offline answer queue, real VAPID sender adapter, Tailscale/Cloudflare setup, native iOS app.

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
- **FR:notify.events** (P2): `onEvent` gets `{ sent, removed, failed }` counts only

### FR:queue: Offline answers (P3, design)

- **FR:queue.design** (P3): Answers made offline are kept in IndexedDB and replayed through `POST /api/asks/{key}/answer` when online and on every foreground. The host commits them to `main`; the Mac pulls. A refused replay (ask changed) is dropped with one toast. Not built in this release

### FR:passkey: Passkey login (P3, design)

- **FR:passkey.design** (P3): WebAuthn registration and assertion mint a device token (same model as `FR:device`). Verified only after a passkey ceremony works in the installed iOS app on the owner's device

### Non-functional Requirements

- **NFR:security** (P1): No new runtime dependency. Device and subscription data live in `.stack/devices.json` in the private data repo (written through the storage adapter, version-checked like tokens). A push endpoint alone cannot send: sending needs the VAPID private key, a host secret that is never stored in the repo
- **NFR:cost** (P1): $0. Push services are free; no paid provider

## Data Model

- **FR:$device** (P1): **`Device`** — `id` (16 hex), `name`, `tokenId`, `createdAt`, `revokedAt` (ISO or null), `push` (`{ endpoint, p256dh, auth, updatedAt }`, optional)

## Architecture Constraints

- Code in `src/api/auth/devices.ts` (service, store use) and `src/api/push.ts` (selection, notifier, sender interface). Endpoints live in `createAuth` so they reuse the owner-session and deny rules.
- The device store reuses the `TokenStore` interface; `GitTokenStore` takes a path.

## External Dependencies

Web Push services (Apple, Google, Mozilla), VAPID (RFC 8292). The real sender adapter is not part of this release.
