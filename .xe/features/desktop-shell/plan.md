# Plan: Desktop shell (Electron)

Follows `.xe/process/development.md`: spec, failing tests, code, validate.

## Slice 1 (this PR): shell without signing

1. Spec: `spec.md`. Decision in `.xe/features/design-decisions.md` ("Ship the Mac shell with Electron"). `desktop-app/spec.md` `FR:native` points here.
2. Package: `desktop/package.json` (`@xerilium/stack-desktop`, private, `electron` and `@types/node` as dev dependencies), `desktop/tsconfig.json` (`rootDir: ..`, like `host/`). Add `desktop` to `pnpm-workspace.yaml`. Keep `electron` out of `allowBuilds` so CI never downloads the binary.
3. Failing tests, one file at a time, each with `@req FR:desktop-shell/...`:
   - `desktop/tests/host.test.ts`: `hostPlan`, `startHost` with an injected `startWeb` fake
   - `desktop/tests/policy.test.ts`: web preferences, navigation guard, window-open handler, CSP fallback, permissions
   - `desktop/tests/shell.test.ts`: lock, window, tray, hotkey, toggle, second instance, quit
   - `desktop/tests/fakes.ts`: the fake `electron` (app, BrowserWindow, Tray, Menu, globalShortcut, shell, nativeImage)
4. Code: `desktop/src/electron-api.ts` (types), `desktop/src/host.ts`, `desktop/src/policy.ts`, `desktop/src/shell.ts`, `desktop/src/main.ts` (entry, imports `electron`), `desktop/assets/trayTemplate.png` and `@2x`, `desktop/scripts/smoke.mjs`.
5. Root scripts: `build:desktop`, `desktop` (smoke), `lint` adds `tsc --noEmit -p desktop/tsconfig.json`. Jest roots add `desktop/src` and `desktop/tests`.
6. Validate: targeted tests, `tsc --noEmit -p desktop/tsconfig.json`, `eslint desktop`, traceability for `desktop-shell`, one local smoke run on the Mac.

## Slice 2 (next)

Login item (`app.setLoginItemSettings`), notifications from the shell for asks while the window is hidden, `electron-builder` config for an unsigned `dmg`.

## Slice 3 (blocked on human steps)

Developer ID signing, notarization, auto-update feed. Needs: Apple Developer Program, Developer ID Application certificate, `APPLE_ID`, `APPLE_TEAM_ID`, app-specific password or API key in CI secrets.

## Risks

- `startWeb` reads `process.env` for GitHub and calendar settings. A Finder launch sees only the login environment. `FR:host.path` fixes `PATH` from the login shell; other settings come from user config (slice 2).
- Electron majors move every 8 weeks. Pinned to `45.3.0`; bump with the renovate flow.
- `web/dist` must exist. The smoke script builds it first.
