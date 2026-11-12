---
id: devops-installer
title: DevOps Installer
author: flanakin
description: Install, update, and roll back Stack.app on the Mac with no Apple account. Updates never interrupt work; by default they install when you quit.
dependencies: [desktop-app, desktop-shell, cli, api, status-ingest, web-shell]
---

<!-- markdownlint-disable single-title -->

# Feature: DevOps Installer

## Purpose

Put Stack.app on the Mac and keep it current without the manual steps (`git pull`, `pnpm build`, `pnpm desktop:package`, quit, replace `/Applications/Stack.app`, relaunch). The app is ad-hoc signed (`FR:desktop-app/package.sign`), so Electron's built-in macOS updater (it needs a Developer ID) is not an option. A small helper swaps the bundle after the app exits. An update never starts or prompts while the owner works: by default it installs when he quits.

## Scope

- In (this slice): build stamp, `stack app install`, `stack app update [--check|--install]`, `stack app status`, the swap helper with rollback, `GET /api/version`, the update mode setting, install on quit, restart when idle, the quiet `Update ready` indicator, the Updates dialog and the `Stack > Updates…` menu item, the failure note at next launch.
- Follow-ups (P3, not built): `FR:uninstall`, `FR:source.release` (GitHub Release asset), `FR:crash` (crash-loop guard), `FR:web-only` (reload the web bundle without a swap).
- Out: Developer ID signing, notarization, Electron `autoUpdater`, Squirrel, the Mac App Store, Intel builds, Windows and Linux.

## Scenarios

### FR:stamp: Stamp every build

Owner needs each build to say what it is, so the app and the CLI can tell an old build from a new one.

- **FR:stamp.write** (P1): The package step MUST write `stackBuild` into the app manifest (`Stack.app/Contents/Resources/app/package.json`) as a build stamp (@req FR:$build-stamp)
  > - @req FR:desktop-app/package.stage
- **FR:stamp.read** (P1): The installer MUST read a stamp from a bundle path; a missing or broken manifest, or one with no `stackBuild`, reads as no stamp
- **FR:stamp.newer** (P1): A build is newer when it has a stamp and the other has none, or the shas differ and its `builtAt` is later. Same sha is never newer

### FR:source: Where a build comes from

- **FR:source.local** (P1): The source checkout MUST be `STACK_SOURCE`, else `~/.local/share/stack`. Its build is `<source>/desktop/out/Stack-darwin-arm64/Stack.app`
- **FR:source.release** (P3, follow-up): The installer MAY fetch the `Stack-<version>-arm64.zip` asset of the newest GitHub Release of `Xerilium/stack`, check its sha256 against the release notes, and unzip it with `ditto -x -k` into a scratch folder. The quarantine flag is cleared after the check passes

### FR:install: First install

Owner needs one command that puts Stack in `/Applications` and opens it, so a new Mac needs no manual steps.

- **FR:install.@cli** (P1): Interface: `stack app install [--no-build] [--source dir] [--json]`
- **FR:install.mac** (P1): Every `stack app` action except `status` MUST fail with `Stack.app is macOS only` (exit 1) on other platforms
- **FR:install.build** (P1): Without `--no-build` the CLI MUST build in the source checkout (`FR:build`) first
- **FR:install.nobuild** (P1): With no build in the source, the CLI MUST fail with `No build at <path>. Run: stack app install` (exit 1) and change nothing
- **FR:install.place** (P1): The CLI MUST place the build at `/Applications/Stack.app` through the helper (`FR:swap`) and launch it, also when no app was there before, and also when the installed build is the same
- **FR:install.config** (P2): When the user config has no `repo` or `dir`, the CLI MUST say `First launch opens setup` (`FR:first-run-onboarding/host.setup`)
- **FR:install.output** (P2):
  - Install result (@req FR:$install-result)

### FR:update: Update from the CLI

Owner (or an agent that just merged a change) needs one command that builds and updates the app without breaking his flow.

- **FR:update.@cli** (P1): Interface: `stack app update [--check | --install] [--no-build] [--source dir] [--json]`
- **FR:update.check** (P1): `--check` MUST build nothing and change nothing. It prints the installed and available stamps and exits 0 when an update is ready, 4 when not
- **FR:update.build** (P1): Without `--check` or `--no-build` the CLI MUST build first (`FR:build`)
- **FR:update.current** (P1): When the build is not newer than the installed app, the CLI MUST print `Up to date (<sha>)`, change nothing, and exit 4
- **FR:update.closed** (P1): When the app is not running, the CLI MUST swap now through the helper and not launch the app
- **FR:update.running** (P1): When the app is running, the CLI MUST NOT quit it. It prints how the update lands for the current mode (`FR:mode`): `on-quit`: `Update ready: installs when you quit Stack`; `ask`: `Update ready: select Restart in Stack`; `auto-idle`: `Update ready: installs when Stack is idle`; `off`: `Update built; updates are off. Run: stack app update --install`
- **FR:update.install** (P1): `--install` MUST install now: the helper quits a running app, swaps, and relaunches it
- **FR:update.output** (P2):
  - Install result (@req FR:$install-result)

### FR:status: Show what is installed

- **FR:status.@cli** (P1): Interface: `stack app status [--source dir] [--json]`
- **FR:status.show** (P1): The CLI MUST print the installed stamp, the available stamp, whether an update is ready, the mode, and the last helper result. It changes nothing and exits 0

### FR:build: Build from the source checkout

- **FR:build.steps** (P1): A build MUST run, in the source, `git pull --ff-only`, `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm desktop:package`, in order, and stop at the first failure with `Build failed: <step>` (exit 1). Nothing is installed after a failed build

### FR:swap: Swap the bundle safely

Owner needs the bundle replaced only after the app has exited, with the old one back if anything fails, so an update can never leave him without a working app.

- **FR:swap.@script** (P1): Interface: a fixed bash script the installer writes to `~/.stack/app/update.sh` and runs with `/bin/bash`. It takes every input from environment variables, never from its own text
- **FR:swap.wait** (P1): The helper MUST wait for the app to exit before it changes anything: for the given pid, else for any process running the target bundle (it asks a running app to quit first when told to). After 60 s it gives up, changes nothing, and records step `wait`
- **FR:swap.stage** (P1): The helper MUST copy the new bundle next to the target (same volume) with `ditto` (else `cp -R`), then clear `com.apple.quarantine` on the copy
- **FR:swap.verify** (P1): A staged copy with no executable `Contents/MacOS/Stack` MUST be removed; the target is unchanged (step `verify`)
- **FR:swap.atomic** (P1): The helper MUST move the target aside to `.Stack.app.previous` and rename the staged copy into place. When the rename fails, it MUST move the previous bundle back (step `swap`)
- **FR:swap.launch** (P1): When told to relaunch, the helper MUST open the target. When that fails, it MUST put the previous bundle back, open it, and record step `launch`
- **FR:swap.keep** (P2): After a good swap the previous bundle MUST stay at `.Stack.app.previous` until the next swap (rollback by hand: quit, swap the two names back)
- **FR:swap.log** (P1): Every step MUST append one timestamped line to `~/.stack/update.log`
- **FR:swap.result** (P1): The helper MUST write the update result (@req FR:$update-result) to `~/.stack/update-result.json` and exit 0 on success, 1 on failure
- **FR:swap.detached** (P1): From the app the helper MUST run detached (own process group, no stdio), so it outlives the app

### FR:mode: Choose when updates install

Owner needs updates to land when they do not cost him focus.

- **FR:mode.setting** (P1): The mode MUST be `update.mode` in `~/.config/stack/config.json`, one of the update modes (@req FR:$update-mode). Missing or unknown reads as `on-quit`
- **FR:mode.idle-minutes** (P2): `update.idleMinutes` (integer 5-240, default 30) MUST set the idle wait for `auto-idle`
- **FR:mode.never-launch** (P1): The app MUST NOT prompt, open a dialog, show a toast, or restart at launch or while the owner works, in any mode

### FR:quit: Install when the owner quits (default)

- **FR:quit.flush** (P1): Quit MUST stop the host first, which commits the live batch (`FR:desktop-shell/quit.stop`)
- **FR:quit.spawn** (P1): Then, when the mode is `on-quit`, an update is ready, and the app runs from a bundle, the shell MUST start the helper detached with the app's pid and no relaunch, then quit
- **FR:quit.fast** (P1): The quit path MUST NOT wait for the helper. Starting it is the only added work. A helper that fails to start logs `update: <message>` and quit goes on
- **FR:quit.next** (P1): The next launch runs the new build

### FR:restart: Restart now

- **FR:restart.@api** (P1): Interface: `POST /api/version/restart`
- **FR:restart.owner** (P1): Owner session only (403 otherwise)
- **FR:restart.ready** (P1): The route MUST answer 409 `No update ready` when no update is ready, and 409 `Restart is not available on this host` when the host cannot restart (not a bundle, or not the desktop app)
- **FR:restart.flush** (P1): The route MUST commit the live batch before it restarts; a failed commit answers like `POST /api/sync` (`FR:live-deploy/sync.flush.error`) and nothing restarts
- **FR:restart.spawn** (P1): Then the host MUST start the helper detached with its pid and relaunch on, answer `{ restarting: true }`, and quit the app

### FR:idle: Restart when idle

- **FR:idle.check** (P1): In `auto-idle` mode the shell MUST check once a minute and restart (`FR:restart.spawn`) when an update is ready, the system idle time is at least `update.idleMinutes`, and the window is not focused

### FR:version: Version probe

- **FR:version.@api** (P1): Interface: `GET /api/version`, `POST /api/version/mode`
- **FR:version.get** (P1): `GET /api/version` MUST answer the version state (@req FR:$version-state) with `Cache-Control: no-store`. A host with no installer (`stack web`, the hosted app) answers 404
- **FR:version.cheap** (P1): The probe MUST read only the two stamps, the mode, and the result file: no git, no network, no build
- **FR:version.mode** (P1): `POST /api/version/mode` (owner only) with `{ mode, idleMinutes? }` MUST save the setting and answer the version state. A bad mode or minutes value is 422 (`FR:api/errors.shape`)

### FR:notice: Quiet indicator and Updates dialog

Owner needs to see an update is ready without being stopped by it.

- **FR:notice.poll** (P1): The page MUST read `GET /api/version` once after load and then every 10 minutes while visible. A 404 stops the polling and shows nothing
- **FR:notice.chip** (P1): When an update is ready, the nav footer (and the phone brand bar) MUST show a small `Update ready` chip; when the last helper run failed, `Update failed`. Nothing shows otherwise. No toast, no modal, no focus change
- **FR:notice.dismiss** (P2): The chip MUST have a `Later` control that hides it until a different build is ready. It lasts while the window is open; the page keeps no browser storage
- **FR:notice.dialog** (P1): Selecting the chip MUST open the Updates dialog: the four modes in plain words, the installed and ready builds, and `Restart now` when an update is ready and the host can restart
- **FR:notice.words** (P1): The modes MUST read: `When I quit Stack (recommended)`, `Only when I select Restart`, `When I'm away for <n> minutes`, `Never`
- **FR:notice.menu** (P1): The app menu MUST have `Stack > Updates…`, which shows the window and loads `<host url>/#/updates`; the page opens the Updates dialog for that hash
- **FR:notice.restart** (P1): `Restart now` MUST post `POST /api/version/restart` and then show `Restarting…`; an error shows as a toast

### FR:fail: Tell the owner when an update failed

- **FR:fail.note** (P1): At launch, when the last update result failed, the live host MUST put a report from agent `installer`, project `stack`, with one `go-do` ask `Stack update failed at <step> and was rolled back. See ~/.stack/update.log`, so it shows in Needs you
  > - @req FR:status-ingest/store.replace
- **FR:fail.clear** (P1): At launch, when the last result succeeded, the host MUST put the same report with no asks, which clears the note

### FR:uninstall: Remove the app (P3, follow-up)

- **FR:uninstall.@cli** (P3): Interface: `stack app uninstall [--keep-data]`
- **FR:uninstall.remove** (P3): MUST quit the app (flush first), remove `/Applications/Stack.app` and `.Stack.app.previous`, and keep `~/.config/stack` and `~/.stack` unless asked
- **FR:uninstall.rollback** (P3): `stack app rollback` MUST swap `.Stack.app.previous` back through the helper

### FR:crash: Crash-loop guard (P3, follow-up)

- **FR:crash.guard** (P3): When a new build fails to reach a started host twice in a row, the helper MUST put the previous bundle back, relaunch it, and raise the `FR:fail.note` ask

### FR:web-only: Web-only updates (P3, follow-up)

- **FR:web-only.reload** (P3): When only `web/dist` changed between two builds, the app MAY serve the new web bundle and reload the page without a swap or restart

## Data Model

- **FR:$build-stamp** (P1): **`BuildStamp`** — What one build is.
  - `version` (string) — the desktop package version
  - `sha` (string) — 12-character git commit of the source
  - `dirty` (boolean) — the source had uncommitted changes
  - `builtAt` (string) — ISO time of the build
- **FR:$update-mode** (P1): **`UpdateMode`** — When an update installs.
  - Allowed: `on-quit`, `ask`, `auto-idle`, `off`
- **FR:$update-result** (P1): **`UpdateResult`** — What the last helper run did.
  - `ok` (boolean)
  - `step` (string) — `done`, or the step that failed: `wait`, `stage`, `verify`, `swap`, `launch`
  - `at` (string) — ISO time
- **FR:$version-state** (P1): **`VersionState`** — `GET /api/version`.
  - `running` (BuildStamp?) — this app; null outside a stamped bundle
  - `available` (BuildStamp?) — the source build; null when none
  - `ready` (boolean) — `available` is newer than `running`
  - `mode` (UpdateMode), `idleMinutes` (integer)
  - `canRestart` (boolean) — this host can swap and relaunch itself
  - `last` (UpdateResult?) — the last helper result
- **FR:$install-result** (P2): **`InstallResult`** — CLI `--json` output.
  - `action` (string) — `install`, `update`, `status`
  - `installed`, `available` (BuildStamp?), `ready` (boolean), `mode` (UpdateMode)
  - `outcome` (string) — `installed`, `staged`, `current`, `checked`
  - `result` (UpdateResult?) — when the helper ran

## Architecture Constraints

- **FR:arch.core** (P1): Stamps, mode, the helper script, and the updater live in `src/core/app-update.ts`. The CLI (`src/cli/app.ts`) and the desktop shell (`desktop/src/update.ts`) only wire real file, process, and Electron calls into it
- **FR:arch.inject** (P1): Every file, process, clock, and quit call MUST be injectable, so tests never replace a real app, never quit a real process, and never touch `/Applications`
- **FR:arch.no-apple** (P1): No step may need a Developer ID, notarization, or any Apple account (`FR:desktop-app/native.human`)

## External Dependencies

- **macOS tools** — `ditto`, `xattr`, `open`, `pgrep`, `osascript` (helper)
- **git, pnpm** — the source build (`FR:build`)
