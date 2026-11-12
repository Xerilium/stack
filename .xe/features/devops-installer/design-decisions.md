# Design Decisions: DevOps Installer

---

## Swap the bundle with a detached helper, not Electron's updater

**Date**: 2026-11-12

**Decision**: A fixed bash script swaps `/Applications/Stack.app` after the app exits. It stages the copy next to the target, renames it into place, and keeps the old bundle as `.Stack.app.previous`.

**Why**: Electron's macOS `autoUpdater` (Squirrel.Mac) needs a Developer ID signature. The owner has no Apple account and will not pay for one. A running app cannot safely replace its own bundle, so the swap must run in another process after the app exits.

**Rejected**:

- _Electron `autoUpdater` or `electron-updater`._ Both need a Developer ID on macOS.
- _A Node helper inside the bundle._ It runs from the bundle it replaces.
- _Paths in the script text._ Inputs come from environment variables only, so no path can inject shell code.

---

## Install on quit by default

**Date**: 2026-11-12

**Decision**: The default mode is `on-quit`. The app never prompts or restarts at launch or while the owner works. A ready update shows as a small chip only.

**Why**: The owner opens Stack with a goal in mind. A prompt at launch costs focus. Quit is the one moment he has already chosen to stop.

**Rejected**:

- _Toast or banner at launch._ The owner called this annoying.
- _Auto-restart by default._ It can restart mid-thought, even with a flush first.

---

## Never kill a running app from the CLI by default

**Date**: 2026-11-12

**Decision**: `stack app update` builds, then swaps only when the app is closed. When it runs, the update waits for the mode (quit, Restart, idle). `--install` forces quit, swap, and relaunch.

**Why**: Agents run the update after a merge. They must not quit the owner's app under him.

---

## Report a failed update through the report store

**Date**: 2026-11-12

**Decision**: The helper writes `~/.stack/update-result.json`. At launch the host puts an `installer/stack` report with one `go-do` ask when the last run failed, and an empty report when it succeeded.

**Why**: Needs you already shows report asks. No new surface, and the next good update clears the note.

**Limits**: The ask link must be https, so it points at the install doc, not the local log.

---

## Local source first, GitHub Release later

**Date**: 2026-11-12

**Decision**: The slice builds from the local source checkout (`~/.local/share/stack`). A GitHub Release asset is a follow-up.

**Why**: The owner deploys from that checkout today. A release source needs a release workflow and a checksum check first.
