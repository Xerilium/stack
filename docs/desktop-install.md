# Install Stack on the Mac (unsigned build)

Stack ships as a real Mac app with no Apple Developer account. The app is ad-hoc signed, not notarized. macOS asks once on first launch. Spec: `FR:desktop-app/package`.

## Build

Needs macOS on Apple silicon, Node 22, pnpm, and the repo cloned.

```sh
pnpm install
pnpm desktop:package
```

Output in `desktop/out/`:

- `Stack-darwin-arm64/Stack.app`
- `Stack-<version>-arm64.dmg`
- `Stack-<version>-arm64.zip`

## Install

1. Open the `dmg`.
2. Drag `Stack` onto `Applications`.
3. Eject the `dmg`.

Or from the terminal: `ditto desktop/out/Stack-darwin-arm64/Stack.app /Applications/Stack.app`.

## First launch (one time)

- Built on this Mac: no prompt. Stack opens on double-click.
- Copied from another Mac or downloaded (quarantined): macOS blocks it once because it is not notarized.

macOS 15 or later:

1. Double-click `Stack` in `/Applications`. Select `Done` in the dialog.
2. Open System Settings > Privacy & Security.
3. Find "Stack was blocked", select `Open Anyway`, then confirm.

macOS 14 or earlier: Control-click (right-click) `Stack`, select `Open`, then `Open` again.

Any version, from the terminal: `xattr -dr com.apple.quarantine /Applications/Stack.app`.

After this, Stack opens like any app (Dock, Spotlight, Launchpad).

## How the app finds its repo and host

- The app runs the Stack host itself. You do not start `stack web`.
- The host listens on `http://127.0.0.1` on a free port. Only this Mac can reach it.
- The content repo comes from `STACK_REPO`, then `STACK_DIR`, then `repo` (or `dir`) in `~/.config/stack/config.json`.
- A Finder launch does not see your shell environment variables. Put the repo in `~/.config/stack/config.json`:

```json
{ "repo": "/Users/you/dev/todo", "mode": "live", "batch": 5 }
```

- Use an absolute path or a git URL. `~` is not expanded.
- `mode: "live"` edits the repo and commits in batches (`batch` minutes). Without it, the app uses a demo copy in `~/.config/stack/demo`.
- No repo: the app opens a short setup flow (repo, demo or live, then optional calendar, email, and iPhone steps). It saves your answers in this file. A repo that fails to start opens the flow at the repo step with the error.
- `PATH`: at start the app reads your login-shell `PATH` (`$SHELL -ilc`, 5 s timeout), so agents and `gh` find tools in Homebrew, nvm, and `~/.local/bin`. If the shell fails, the app adds `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.local/bin`. A terminal launch keeps its own `PATH`. The log shows `path: login shell`, `path: fallback (<reason>)`, or `path: unchanged (<reason>)`.

## Use

- Menu bar icon: open, hide, or quit Stack.
- `Cmd+Shift+Space`: show or hide the window.
- Closing the window hides it. Quit from the menu bar icon or `Cmd+Q`.

## Update

Pull, run `pnpm desktop:package` again, and replace `/Applications/Stack.app`. A copied build needs the first-launch step again.

## Limits

- Apple silicon only. No auto-update.
- Logs: run `/Applications/Stack.app/Contents/MacOS/Stack` from a terminal to see host lines.
- To see the `PATH` a Finder launch gets: `env -i HOME="$HOME" SHELL="$SHELL" PATH=/usr/bin:/bin:/usr/sbin:/sbin /Applications/Stack.app/Contents/MacOS/Stack`.
