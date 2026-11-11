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

macOS blocks apps that are not notarized.

1. In Finder, open `/Applications`.
2. Control-click (or right-click) `Stack`, then select `Open`.
3. Select `Open` in the dialog.

On macOS 15 or later, if no `Open` button shows: open System Settings > Privacy & Security, find "Stack was blocked", select `Open Anyway`.

Terminal option: `xattr -dr com.apple.quarantine /Applications/Stack.app`.

After this, Stack opens like any app (Dock, Spotlight, Launchpad).

## How the app finds its repo and host

- The app runs the Stack host itself. You do not start `stack web`.
- The host listens on `http://127.0.0.1` on a free port. Only this Mac can reach it.
- The content repo comes from `STACK_REPO`, then `STACK_DIR`, then `repo` (or `dir`) in `~/.config/stack/config.json`.
- A Finder launch does not see your shell environment. Put the repo in `~/.config/stack/config.json`:

```json
{ "repo": "/Users/you/dev/todo", "mode": "live", "batch": 5 }
```

- Use an absolute path or a git URL. `~` is not expanded.
- `mode: "live"` edits the repo and commits in batches (`batch` minutes). Without it, the app uses a demo copy in `~/.config/stack/demo`.
- No repo: the app logs `No content repo` and quits.

## Use

- Menu bar icon: open, hide, or quit Stack.
- `Cmd+Shift+Space`: show or hide the window.
- Closing the window hides it. Quit from the menu bar icon or `Cmd+Q`.

## Update

Pull, run `pnpm desktop:package` again, and replace `/Applications/Stack.app`. Each new build needs the first-launch step again.

## Limits

- Apple silicon only. No auto-update.
- A Finder launch gets the bare system `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), not your shell `PATH`. Agents that need Homebrew or `~/.local/bin` tools may not start. Workaround: launch from a terminal with `/Applications/Stack.app/Contents/MacOS/Stack`.
- Logs: run `/Applications/Stack.app/Contents/MacOS/Stack` from a terminal to see host lines.
