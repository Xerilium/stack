---
id: desktop-shell
title: Desktop shell (Electron)
author: flanakin
description: "Stack as a Mac app: an Electron shell that runs the Stack host on loopback, shows the web UI in one window, and lives in the menu bar"
dependencies: [cli, web-app, pwa, acp-driver]
---

<!-- markdownlint-disable single-title -->

# Feature: Desktop shell (Electron)

## Purpose

The Stack host must run on the owner's Mac to spawn agents (`.xe/features/stack-app/research-architecture.md`). A browser cannot own that process. The desktop shell does: it starts the host, shows the existing web UI in one window, and stays in the menu bar. The owner asked for a menu-bar icon and a global hotkey, which is the gate in `FR:desktop-app/native.gate`. Electron replaces the deferred Tauri choice (`design-decisions.md`, "Ship the Mac shell with Electron").

## Scope

- In (slice 1): `desktop/` package with the Electron main process: start the host on a loopback port, one window that loads the host, tray icon with a menu, global hotkey to show or hide, single-instance lock, clean host stop on quit, renderer hardening, a smoke script for a local run.
- Out: code signing, notarization, auto-update, installers (`dmg`, `pkg`), login item, Windows and Linux, a preload bridge or IPC, notifications from the shell (the page does them, `FR:pwa/notify.*`), Tailscale.
- Human-only: Apple Developer Program enrollment, the Developer ID certificate, notarization secrets in CI (`FR:desktop-app/native.human`).

## Architecture

- `desktop/src/main.ts` is the only file that imports `electron`. It builds the real adapters and calls `createShell`. It has no logic of its own.
- `desktop/src/shell.ts` owns the lifecycle. It takes an `electron`-shaped object (`ShellElectron`, `desktop/src/electron-api.ts`) and a host factory, so tests run it with fakes and never launch Electron.
- `desktop/src/host.ts` turns user config into host options and starts `startWeb` (`src/cli/web.ts`) in the main process, the same way `stack web` does. The host spawns agents with `child_process`; Electron's `utilityProcess` has no stdin and is not used.
- `desktop/src/policy.ts` holds the renderer rules: web preferences, navigation guard, window-open handler, CSP fallback, permission handler.
- `desktop/` compiles with `rootDir: ..` like `host/`, so it imports `src/` by relative path and never duplicates core code.
- CI type-checks and tests `desktop/` with `pnpm lint`, `pnpm test`, and `pnpm build`. The Electron binary is not downloaded in CI: build scripts for `electron` stay blocked in `pnpm-workspace.yaml`.

## Scenarios

### FR:host: The shell runs the Stack host

- **FR:host.plan** (P1): `hostPlan({cfg, env, home, cwd})` resolves the content repo like `stack web`: `STACK_REPO`, then `STACK_DIR`, then user config `repo` or `dir`. `live` is user config `mode: 'live'`; `batch` is user config `batch` (minutes, default 5, must be a number 0 or more). No repo is an error with the text `No content repo. Set "repo" in ~/.config/stack/config.json`
- **FR:host.start** (P1): `startHost(plan, deps)` prepares the repo (live: `prepareLive` with `BatchedGitStorage`; demo: `prepareDemo` into `~/.config/stack/demo`), then calls `startWeb` with `port: 0` so the OS picks a free loopback port. It returns `{url, close}` where `url` is `http://127.0.0.1:<port>` (never `localhost`, never another host)
- **FR:host.webdir** (P1): The web app comes from `web/dist` next to the repo root. A missing `web/dist/index.html` fails with `Web app not built. Run: pnpm build`
- **FR:host.stop** (P1): `close()` calls the host's `close()` once, which flushes batched edits (`FR:cli/web.batch.shutdown`). A second `close()` is a no-op
- **FR:host.fail** (P1): A host that fails to start (no repo, no web build, port error) logs `host: <message>` and the shell quits. No window and no tray are created

### FR:window: One window shows the web UI

- **FR:window.load** (P1): After the host starts, the shell creates one `BrowserWindow` and calls `loadURL` with the host url. It never calls `loadURL` or `loadFile` with any other url
- **FR:window.hide** (P1): Closing the window hides it; the host keeps running. The window shows again from the tray, the hotkey, the Dock, or a second launch
- **FR:window.toggle** (P1): `toggle()` hides the window when it is visible and focused; otherwise it shows and focuses it. A window that was never created is created first

### FR:tray: Menu-bar icon

- **FR:tray.icon** (P1): The shell creates one `Tray` from the template image `desktop/assets/trayTemplate.png` (with `@2x`) and sets the tooltip `Stack`
- **FR:tray.menu** (P1): The tray context menu has `Open Stack` (show and focus), `Hide Stack`, a separator, and `Quit Stack`. Clicking the icon toggles the window
- **FR:tray.appmenu** (P2): The application menu has the `Edit`, `View` (reload, zoom, no developer tools) and `Window` roles, so copy, paste, and the Mac shortcuts work

### FR:hotkey: Global hotkey

- **FR:hotkey.register** (P1): The shell registers `CommandOrControl+Shift+Space` with `globalShortcut` and binds it to `toggle()`. A failed registration logs `hotkey: CommandOrControl+Shift+Space is taken` and continues
- **FR:hotkey.release** (P1): All shortcuts are unregistered before quit

### FR:instance: One instance

- **FR:instance.lock** (P1): If `app.requestSingleInstanceLock()` is false, the shell calls `app.quit()` and does nothing else: no host, no window
- **FR:instance.second** (P1): `second-instance` shows and focuses the window of the running instance
- **FR:instance.early** (P1): `activate` or `second-instance` before the host has started MUST NOT crash. The shell waits and shows the window once the host is up. If the host fails, nothing shows

### FR:quit: Quit stops the host

- **FR:quit.stop** (P1): The first `before-quit` is prevented; the shell unregisters shortcuts, destroys the tray, closes the host (bounded by 15 s), then calls `app.quit()` again, which passes. `window-all-closed` never quits
- **FR:quit.once** (P1): Quit is idempotent: a second `before-quit` while the host closes does nothing extra, and a host that throws on close still lets the app quit

### FR:safe: Renderer hardening

- **FR:safe.prefs** (P1): Every window has `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, and no `preload`
- **FR:safe.navigate** (P1): `will-navigate` or `will-redirect` to an origin other than the host origin is prevented. An `http:` or `https:` target opens in the default browser with `shell.openExternal`; any other scheme is dropped. `setWindowOpenHandler` denies every new window and opens `http(s)` targets the same way
- **FR:safe.csp** (P1): Responses to the window without a `Content-Security-Policy` header get `default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (the same policy the host serves from `staticwebapp.config.json`). A header the host sent is kept
- **FR:safe.permissions** (P1): Permission requests and permission checks are denied except `notifications` from the host origin
- **FR:safe.remote** (P1): The shell never loads remote content: no `loadURL` to a non-loopback origin, no `webview`, no `<iframe>` from another origin (blocked by `default-src 'self'`), no auto-update feed

### FR:dev: Local run

- **FR:dev.smoke** (P2): `pnpm desktop` (root script) builds and launches the shell with the local Electron binary. It is not run in CI. When the Electron binary is missing (pnpm blocks build scripts), the script prints `Run: node desktop/node_modules/electron/install.js` and exits 1

## Non-functional

- **NFR:shell.test** (P1): Every rule above except `FR:dev.smoke` is tested in Jest with fake `electron` objects; the tests never import `electron` and never spawn a process
- **NFR:shell.log** (P1): The shell logs the host url, the repo path (redacted), and lifecycle lines. It never logs tokens, environment, or request bodies
