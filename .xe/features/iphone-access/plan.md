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

## Slice 2: sender, trigger, install screen

1. `src/host/push-sender.ts`: RFC 8291 encrypt + RFC 8292 JWT on `node:crypto` (no `web-push` dependency; keeps NFR:security). Salt and sender key injectable for the RFC vector test. Transport injected; default `fetch`.
2. `src/api/push.ts`: `quiet` and `ledger` options; `createPushLedger(store)`; `skipped` count.
3. `src/host/push.ts`: `createPushCheck` (reads asks through the api, runs the notifier) and `withPush` (routes `POST /api/push/check`, runs the check after an ask write). `runtime.ts` wires it when the VAPID env is valid.
4. `authorize.ts`: `push.check` → `tasks:write`.
5. Web: `web/src/push.ts` (pure: platform, step, enable flow), `web/src/InstallView.tsx`, `main.tsx` renders it on `#/install`, `sw.js` `push` handler.

Decision: no-dependency sender over `web-push`. The RFC 8291 Appendix A vector proves the encryption; JWT and header shape are unit-tested. Cost: ~120 lines.
Decision: trigger = ask write + `POST /api/push/check`. Managed SWA functions have no timer, so a cron caller (human step) covers deadlines that move into the 1h window.

Tests (first, failing): `tests/host/push-sender.test.ts`, `tests/api/push.test.ts` (quiet, dedupe, ledger), `tests/host/push-wire.test.ts`, `web/tests/push.test.ts`, `web/e2e/install.spec.ts` (375 px).

## Next slices

1. Cron caller (GitHub Actions in the data repo) for `POST /api/push/check`.
2. Pairing UI (QR/link with fragment token) and `Notify me` subscribing the device.
3. Passkey login minting device tokens (after a device test).
4. Offline answer queue.
5. Tailscale Serve doc for the live Mac view.

## Risks

- Azure Functions has no timer in SWA managed functions; the due check needs a caller (GitHub Actions cron or the Mac host). Decide in slice 1.
