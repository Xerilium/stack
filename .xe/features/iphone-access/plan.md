---
id: iphone-access
title: iPhone access Plan
---

# Plan: iPhone access

## Approach

Add devices beside tokens. A device is a record bound to one API token, so login, scopes, expiry and revoke reuse `auth-security`. Push is an interface plus a pure notifier; the real sender is injected later.

## Steps

1. `src/api/auth/devices.ts`: `createDeviceService({ store, tokens, now })` with create, list, revoke, byToken, setPush, subscriptions, removePush. JSON file `{version:1, devices}` over `TokenStore`, retry on `StoreConflict`.
2. `src/api/auth/authorize.ts`: optional `devices` and `vapidPublicKey` options; route `/auth/devices*` in `wrap`.
3. `src/api/push.ts`: `dueWithin`, `PushSender`, `createPushNotifier`.
4. `src/host/token-store.ts`: `GitTokenStore` gets a `path` option; `runtime.ts` wires `.stack/devices.json` and `STACK_VAPID_PUBLIC_KEY`.
5. Docs: threat model row, pwa spec pointer, design decision.

## Tests (first, failing)

- `tests/security/devices.test.ts`: FR:device.*, FR:sub.*
- `tests/api/push.test.ts`: FR:notify.*
- `tests/host/devices-wire.test.ts`: host serves device create and sub put

## Next slices

1. Real VAPID sender adapter (`web-push` or a small RFC 8292/8291 implementation) + a timer/trigger that calls `notify`.
2. Pairing UI (QR/link with fragment token) and `Notify me` subscribing the device.
3. Passkey login minting device tokens (after a device test).
4. Offline answer queue.
5. Tailscale Serve doc for the live Mac view.

## Risks

- Azure Functions has no timer in SWA managed functions; the due check needs a caller (GitHub Actions cron or the Mac host). Decide in slice 1.
