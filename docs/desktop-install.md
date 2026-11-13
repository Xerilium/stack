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

One command builds Stack from the source checkout and puts it in `/Applications` (`FR:devops-installer/install`):

```sh
stack app install
```

The source checkout is `STACK_SOURCE`, else `~/.local/share/stack`. `--no-build` installs the build that is there. By hand:

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

```sh
stack app update            # pull, build, then install when Stack is closed
stack app update --check    # show installed and ready builds; change nothing
stack app update --install  # install now: quit Stack, swap, reopen
stack app status
```

- Stack never prompts or restarts at launch or while you work. A ready update shows as a small `Update ready` chip in the nav footer. `Later` hides it until a newer build.
- `Stack > Updates…` (or the chip) sets when updates install:
  - `When I quit Stack (recommended)`: the default. Quit commits pending edits, then a helper swaps the app after it exits. The next launch runs the new build.
  - `Only when I select Restart`: the dialog shows `Restart now`.
  - `When I'm away for <n> minutes`: restarts when the Mac is idle and the Stack window is closed (hidden in the menu bar).
  - `Never`.
- The app looks for builds in `update.source` (config), else `~/.local/share/stack`; a Finder launch does not see `STACK_SOURCE`.
- The setting is `update.mode` (`on-quit`, `ask`, `auto-idle`, `off`) and `update.idleMinutes` in `~/.config/stack/config.json`.
- The helper keeps the old app as `/Applications/.Stack.app.previous`. If the new app does not open, it puts the old one back and opens it. Every step goes to `~/.stack/update.log`; the result goes to `~/.stack/update-result.json`. A failed update shows in Needs you at the next launch.
- Roll back by hand: quit Stack, then `mv /Applications/Stack.app /tmp/Stack.bad.app && mv /Applications/.Stack.app.previous /Applications/Stack.app`.

## Limits

- Apple silicon only. Updates come from the local source checkout; no download from GitHub yet.
- Logs: run `/Applications/Stack.app/Contents/MacOS/Stack` from a terminal to see host lines.
- To see the `PATH` a Finder launch gets: `env -i HOME="$HOME" SHELL="$SHELL" PATH=/usr/bin:/bin:/usr/sbin:/sbin /Applications/Stack.app/Contents/MacOS/Stack`.
