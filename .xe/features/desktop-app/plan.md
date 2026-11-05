# Plan: Desktop app

## Decision

Installed PWA. See [research.md](research.md).

## Slice 1 (this PR): PWA gaps

1. Tests first (fail): `web/tests/install.test.ts`
   - manifest has `shortcuts` for `/#/asks` and `/#/today`, and `categories`
   - install state: captures event, `prompt()` once, drops event; hides after `appinstalled` or standalone; no event means no command
2. Code: `web/src/install.ts` (pure state + thin browser layer), manifest edit, palette command in `App.tsx`
3. Run only `web/tests/install.test.ts`, `sw.test.ts`, `notify.test.ts`. Typecheck web.

Notifications: already built (`FR:pwa/notify.*`). No change.

## Slice 2 (P2): host at login

`stack web --install-login` / `--uninstall-login`. Generate launchd plist from a pure function (test the string), write to `~/Library/LaunchAgents`. Tests first. Needs no signing.

## Slice 3 (P3, only on request): native shell

Tauri 2 shell, tray, global hotkey, `pkg` Node sidecar, updater. About 80-150k tokens. Blocked on human steps below.

## Human-only

- Enroll in Apple Developer Program ($99/yr)
- Create Developer ID Application certificate (account holder only)
- Add `APPLE_CERTIFICATE`, `APPLE_ID`/API key, `APPLE_TEAM_ID`, updater private key to CI secrets
- Approve and publish each release
- Decide whether to revisit slice 3

## Risks

- Safari has no `beforeinstallprompt`: users use File > Add to Dock (no code)
- Chrome login start is a per-user setting; the app cannot enable it
