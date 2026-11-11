---
id: desktop-app
title: Desktop app
author: flanakin
description: "Stack as an installed app on the Mac: PWA first, native shell only if proven needed"
dependencies: [pwa, web-shell, live-deploy, cli]
---

<!-- markdownlint-disable single-title -->

# Feature: Desktop app

## Purpose

Stack opens like a Mac app: own window, Dock icon, starts at login, taps you for asks. Decision and data: [research.md](research.md). Decision: the installed PWA meets the need; a native shell is deferred.

## Scope

- In: install button, manifest shortcuts, login start for the local host (P2), the criteria to revisit a native shell, an unsigned Mac build of the Electron shell (P2).
- Non-goals: Tauri, Developer ID signing and notarization, auto-update, Mac App Store, Intel Mac builds, Windows or Linux installers, offline writes.

## Scenarios

### FR:install: Install from the app

- **FR:install.prompt** (P1): When the browser offers install (`beforeinstallprompt`) and Stack is not installed, the command palette MUST list `Install Stack as an app`. Running it MUST show the browser install dialog once; the saved event MUST then be dropped
  - **FR:install.prompt.done** (P1): After `appinstalled`, or in standalone display, the command MUST NOT show
  - **FR:install.prompt.none** (P1): Browsers without the event (Safari, Firefox) MUST show no command and raise no error
- **FR:install.shortcuts** (P1): The manifest MUST list `shortcuts` for `Needs you` (`/#/asks`) and `My day` (`/#/today`), each with the 192 px icon, and `categories` `productivity`
  > - @req FR:pwa/install.manifest

### FR:host: Local host at login (P2)

- **FR:host.login** (P2): `stack web --install-login` MUST write a launchd agent that starts `stack web` at login on macOS; `--uninstall-login` MUST remove it. Other platforms MUST print `Login start is macOS only` and exit non-zero
- **FR:host.login.safe** (P2): The agent MUST bind loopback only, keep the existing flags, and log to `~/Library/Logs/stack-web.log`. It MUST NOT store tokens

### FR:native: Native shell (deferred, P3)

- **FR:native.gate** (P3): Build a native shell only when the owner asks for a menu-bar icon or a global hotkey. The owner asked; the shell is Electron and lives in [desktop-shell](../desktop-shell/spec.md)
- **FR:native.human** (P3): These steps MUST stay human-only, and the unsigned build (`FR:package`) MUST NOT need them: enroll in the Apple Developer Program, create the Developer ID certificate, add notarization and updater signing secrets to CI, publish a release

### FR:package: Unsigned Mac build (no Apple account)

- **FR:package.build** (P2): `pnpm --filter @xerilium/stack-desktop package` (root alias `pnpm desktop:package`) MUST build `web/dist` and `desktop/dist`, then write `desktop/out/Stack-darwin-arm64/Stack.app`, `desktop/out/Stack-<version>-arm64.zip`, and `desktop/out/Stack-<version>-arm64.dmg`. It MUST run on macOS only; other platforms print `Packaging is macOS only` and exit 1
- **FR:package.stage** (P2): The app folder MUST hold `desktop/dist`, `desktop/assets`, `web/dist`, and a `package.json` with `main` `desktop/dist/desktop/src/main.js` and the root `dependencies` (one source of truth). Production dependencies MUST install flat, without dev dependencies and without the workspace
- **FR:package.app** (P2): The bundle MUST be `arm64`, name `Stack`, bundle id `com.xerilium.stack`, category `public.app-category.productivity`, `asar` off, and the Stack icon from `web/public/icons/icon-512.png`
- **FR:package.sign** (P2): The bundle MUST be ad-hoc signed (`codesign --force --deep --sign -`) so Apple silicon runs it. It MUST NOT use a Developer ID, notarization, or any Apple account secret
- **FR:package.dmg** (P2): The `dmg` MUST show `Stack.app` next to an `Applications` link so the owner drags to install. The `zip` MUST keep the bundle intact (`ditto --keepParent`)
- **FR:package.docs** (P2): `docs/desktop-install.md` MUST give the build command, the install steps, the one-time first launch (right-click, `Open`), and how the app finds its repo and host

## Non-functional

- **NFR:desktop-app/csp** (P1): No inline script or style is added; CSP stays `default-src 'self'`
