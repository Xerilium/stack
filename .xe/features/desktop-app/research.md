# Research: Stack as a desktop app

Question: ship `stack web --live` (Node host, serves the repo) as a desktop app?
Date: 2026-11-05. "Verified" = read in the cited source. "Est." = not verified; test before relying.

## Options

| Need | Installed PWA | Tauri 2 | Electron |
| --- | --- | --- | --- |
| Install | Chrome/Edge install from a secure origin. `localhost` counts as secure. Custom button via `beforeinstallprompt` (Chrome-family only) [1] | `.dmg` / `.app` | `.dmg` / `.app` |
| Runs the Node host | No. Host must run apart (CLI, launchd) | Only as a sidecar: compile Node to one binary with `pkg` [2] | Yes. Main process is Node; host runs in-process |
| Menu-bar / tray | No | Yes (tray API, est.) | Yes (`Tray`, est.) |
| Notifications | Yes. Already built (`FR:pwa/notify.*`) | Plugin (est.) | Native `Notification` (est.) |
| Global hotkey | No | Plugin; desktop only [3] | `globalShortcut`; fails silently if the key is taken [4] |
| Autostart | Chrome/Edge 91+ "Start app when you sign in" [5] | Plugin (est.) | `setLoginItemSettings` (est.) |
| Auto-update | Free: user opens the site, new service worker | Built-in updater; signed artifacts; losing the key blocks updates [6] | `autoUpdater`; free service needs public GitHub repo + signed macOS build [7] |
| macOS signing + notarize | None | Required to avoid warnings. Paid account $99/yr; free account cannot notarize [8] | Required. Paid Apple Developer Program, Xcode, certs [9] |
| Size (minimal app) | 0 MB | about 3 to 9 MB. Uses system WebKit [10][11] | about 85 to 244 MB. Ships Chromium [11] |
| Memory | Browser process | About half of Electron in one test [11] | Higher [11] |
| Build tokens (est., this repo) | ~5k. Finish gaps | ~80-150k. New Rust toolchain, sidecar build, CI signing | ~60-120k. All JS; CI signing |
| New toolchain | None | Rust | None (JS) |
| Human-only steps | None | Apple account, cert, notarize secrets, updater key | Apple account, cert, notarize secrets |

## Findings

- Stack already ships manifest, icons, service worker, offline cache, opt-in notifications (`pwa/spec.md`). Hosting doc already chose an installed PWA; the local tray option was rejected there (`docs/hosting.md`).
- Local `stack web` on `http://localhost` is a secure context, so install and notifications work. Live Azure host is HTTPS.
- Real gaps for a "feels like an app" Mac setup: (1) no install button, (2) no manifest shortcuts, (3) nothing starts the local host at login, (4) no menu-bar icon, (5) no global hotkey.
- Gaps 4 and 5 need a native shell. They are P3 convenience, not blockers: Mac Dock badge/notification and `Cmd+K` in the app cover most use.
- Tauri and Electron both need the Node host bundled, so the host is the hard part, not the window.
- Signing is a human gate for any native shell. A PWA has no such gate.

## Recommendation

PWA now. Finish PWA gaps (install button, manifest shortcuts). Start the local host at login with a launchd agent (later slice). Revisit a native shell only if the menu-bar icon or global hotkey is wanted. If so: Tauri (size, memory), host as `pkg` sidecar; Electron if the Node host must stay unbundled.

## Sources

1. web.dev, Customize install: https://web.dev/articles/customize-install
2. Tauri, Node.js as a sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
3. Tauri, global shortcut plugin: https://v2.tauri.app/plugin/global-shortcut/
4. Electron, globalShortcut: https://www.electronjs.org/docs/latest/api/global-shortcut
5. Chrome, run on login: https://developer.chrome.com/blog/run-on-login
6. Tauri, updater: https://v2.tauri.app/plugin/updater/
7. Electron, updates: https://www.electronjs.org/docs/latest/tutorial/updates
8. Tauri, macOS signing: https://v2.tauri.app/distribute/sign/macos/
9. Electron, code signing: https://www.electronjs.org/docs/latest/tutorial/code-signing
10. Tauri, start: https://tauri.app/start/
11. Size and memory (blog benchmarks, varied method): https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4 and https://www.levminer.com/blog/tauri-vs-electron
