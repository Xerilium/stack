/**
 * Install and update Stack.app with no Apple account: build stamps, the update mode, the swap helper, and the updater the app and the CLI share.
 * Every file, process, and quit call is injected, so tests never replace a real app. @req FR:devops-installer/arch.core @req FR:devops-installer/arch.inject
 * @req FR:devops-installer/arch.no-apple
 */
import { spawn, spawnSync } from 'child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

/** @req FR:devops-installer/$update-mode */
export const UPDATE_MODES = ['on-quit', 'ask', 'auto-idle', 'off'] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];
export const IDLE_MINUTES = { min: 5, max: 240, default: 30 } as const;
export const APP_TARGET = '/Applications/Stack.app';
const BUILD_REL = 'desktop/out/Stack-darwin-arm64/Stack.app';

/** @req FR:devops-installer/$build-stamp */
export interface BuildStamp { version: string; sha: string; dirty: boolean; builtAt: string }
/** @req FR:devops-installer/$update-result */
export interface UpdateResult { ok: boolean; step: string; at: string }
export interface UpdateSettings { mode: UpdateMode; idleMinutes: number }
/** @req FR:devops-installer/$version-state */
export interface VersionState {
  running: BuildStamp | null; available: BuildStamp | null; ready: boolean;
  mode: UpdateMode; idleMinutes: number; canRestart: boolean; last: UpdateResult | null;
}
/** One helper run. `pid`: wait for this process; `quit`: ask a running app to quit first; `relaunch`: open the app after the swap. */
export interface HelperJob { source: string; target: string; stateDir: string; pid?: number; relaunch: boolean; quit: boolean; /** The build sha the copy must carry. */ sha?: string }

export class UpdateRefused extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** @req FR:devops-installer/source.local */
export const sourceDir = (env: NodeJS.ProcessEnv, home: string, cfg: unknown = {}): string => {
  const u = isObj(cfg) && isObj(cfg.update) ? cfg.update : {};
  return env.STACK_SOURCE || (typeof u.source === 'string' && u.source ? u.source : join(home, '.local/share/stack'));
};
/** @req FR:devops-installer/source.local */
export const buildPath = (source: string): string => join(source, BUILD_REL);
/** The app manifest inside a bundle. @req FR:devops-installer/stamp.read */
export const manifestPath = (app: string): string => join(app, 'Contents/Resources/app/package.json');
/** The `.app` bundle an executable runs from, or null outside one (a dev run). */
export function bundleOf(execPath: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return m ? m[1] : null;
}

/** @req FR:devops-installer/stamp.read */
export function parseStamp(text: string | null): BuildStamp | null {
  if (text === null) return null;
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  const s = isObj(j) ? j.stackBuild : undefined;
  if (!isObj(s) || typeof s.version !== 'string' || typeof s.sha !== 'string' || typeof s.builtAt !== 'string' || typeof s.dirty !== 'boolean') return null;
  return { version: s.version, sha: s.sha, dirty: s.dirty, builtAt: s.builtAt };
}

/** @req FR:devops-installer/stamp.newer */
export function isNewer(a: BuildStamp | null, b: BuildStamp | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return (a.sha !== b.sha || a.dirty || b.dirty) && Date.parse(a.builtAt) > Date.parse(b.builtAt);
}

/** @req FR:devops-installer/mode.setting @req FR:devops-installer/mode.idle-minutes */
export function readSettings(cfg: unknown): UpdateSettings {
  const u = isObj(cfg) && isObj(cfg.update) ? cfg.update : {};
  const mode = (UPDATE_MODES as readonly unknown[]).includes(u.mode) ? u.mode as UpdateMode : 'on-quit';
  const n = u.idleMinutes;
  const idleMinutes = typeof n === 'number' && Number.isInteger(n) && n >= IDLE_MINUTES.min && n <= IDLE_MINUTES.max ? n : IDLE_MINUTES.default;
  return { mode, idleMinutes };
}

/** @req FR:devops-installer/$update-result */
export function parseResult(text: string | null): UpdateResult | null {
  if (text === null) return null;
  try {
    const j = JSON.parse(text) as unknown;
    return isObj(j) && typeof j.ok === 'boolean' && typeof j.step === 'string' && typeof j.at === 'string' ? { ok: j.ok, step: j.step, at: j.at } : null;
  } catch { return null; }
}

export const helperPaths = (stateDir: string) => ({
  script: join(stateDir, 'app/update.sh'), log: join(stateDir, 'update.log'), result: join(stateDir, 'update-result.json'),
});

/**
 * The swap helper. Fixed text: every input comes from the environment, so no path can inject shell code.
 * @req FR:devops-installer/swap.@script @req FR:devops-installer/swap.wait @req FR:devops-installer/swap.stage @req FR:devops-installer/swap.verify
 * @req FR:devops-installer/swap.lock @req FR:devops-installer/swap.atomic @req FR:devops-installer/swap.launch @req FR:devops-installer/swap.keep @req FR:devops-installer/swap.log @req FR:devops-installer/swap.result
 */
export const HELPER_SCRIPT = `#!/bin/bash
# Stack.app swap helper (devops-installer FR:swap). Inputs come from the environment only.
set -u
SRC="$STACK_UPDATE_SOURCE"; DST="$STACK_UPDATE_TARGET"; LOG="$STACK_UPDATE_LOG"; RES="$STACK_UPDATE_RESULT"
PID="\${STACK_UPDATE_PID:-}"; QUIT="\${STACK_UPDATE_QUIT:-0}"; RELAUNCH="\${STACK_UPDATE_RELAUNCH:-0}"; SHA="\${STACK_UPDATE_SHA:-}"
OPEN="\${STACK_UPDATE_OPEN:-open}"; QUITTER="\${STACK_UPDATE_QUITTER:-}"; WAIT="\${STACK_UPDATE_WAIT_S:-60}"
DIR="$(dirname "$DST")"; NAME="$(basename "$DST")"; EXE="\${NAME%.app}"
STAGE="$DIR/.$NAME.staging"; PREV="$DIR/.$NAME.previous"; LOCK="$DIR/.$NAME.updating"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
mkdir -p "$(dirname "$LOG")" "$(dirname "$RES")"
log() { printf '%s %s\\n' "$(now)" "$1" >> "$LOG"; }
finish() {
  printf '{"ok":%s,"step":"%s","at":"%s"}\\n' "$1" "$2" "$(now)" > "$RES.tmp" && mv -f "$RES.tmp" "$RES"
  log "result: $2"; rm -rf "$LOCK"
  if [ "$1" = true ]; then exit 0; else exit 1; fi
}
# The app runs while its pid lives or any process runs from the target bundle (a copy opened by hand counts).
running() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then return 0; fi
  pgrep -f "$DST/Contents/MacOS/" >/dev/null 2>&1
}
quit_app() {
  if [ -n "$QUITTER" ]; then "$QUITTER" "$DST" >/dev/null 2>&1 || true
  else osascript -e 'tell application id "com.xerilium.stack" to quit' >/dev/null 2>&1 || true; fi
}
copy() { if command -v ditto >/dev/null 2>&1; then ditto "$1" "$2"; else cp -R "$1" "$2"; fi; }
log "start: $SRC -> $DST"
# One helper at a time. A lock whose owner died (killed at logout) is taken over.
if ! mkdir "$LOCK" 2>/dev/null; then
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then log "busy: another update is running"; exit 1; fi
  log "lock: taking over a stale lock"; rm -rf "$LOCK"; mkdir "$LOCK" || { log "busy: cannot take the lock"; exit 1; }
fi
echo $$ > "$LOCK/pid"
# A helper killed between the two renames left no app: put the previous one back first.
if [ ! -e "$DST" ] && [ -d "$PREV" ]; then mv "$PREV" "$DST" && log "recover: put the previous app back"; fi
if [ "$QUIT" = 1 ] && running; then log "quit: asking Stack to quit"; quit_app; fi
waitgone() {
  n=0
  while running; do
    if [ "$n" -ge "$((WAIT * 5))" ]; then log "wait: app still running after \${WAIT}s"; finish false wait; fi
    sleep 0.2; n=$((n + 1))
  done
}
waitgone
log "wait: app is not running"
rm -rf "$STAGE"
if [ ! -d "$SRC" ] || ! copy "$SRC" "$STAGE"; then log "stage: cannot copy $SRC"; rm -rf "$STAGE"; finish false stage; fi
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true
log "stage: copied"
if [ ! -x "$STAGE/Contents/MacOS/$EXE" ]; then log "verify: no executable Contents/MacOS/$EXE"; rm -rf "$STAGE"; finish false verify; fi
# The copy must be the build that was chosen, not one a rebuild changed meanwhile.
if [ -n "$SHA" ] && ! grep -qE '"sha": *"'"$SHA"'"' "$STAGE/Contents/Resources/app/package.json" 2>/dev/null; then
  log "verify: the copy is not build $SHA"; rm -rf "$STAGE"; finish false verify
fi
# Stack may have opened again while we copied: never move a running app.
if running; then log "wait: Stack opened again; not swapping"; rm -rf "$STAGE"; finish false wait; fi
had=0
if [ -e "$DST" ]; then
  rm -rf "$PREV"
  if ! mv "$DST" "$PREV"; then log "swap: cannot move the old app aside"; rm -rf "$STAGE"; finish false swap; fi
  had=1
fi
if ! mv "$STAGE" "$DST"; then
  log "swap: rename failed, restoring the old app"
  if [ "$had" = 1 ]; then mv "$PREV" "$DST"; fi
  rm -rf "$STAGE"; finish false swap
fi
log "swap: done"
if [ "$RELAUNCH" = 1 ]; then
  if ! "$OPEN" "$DST" >/dev/null 2>&1; then
    log "launch: failed, rolling back"
    if [ "$had" = 1 ]; then
      mv "$DST" "$STAGE" && mv "$PREV" "$DST" && rm -rf "$STAGE"
      "$OPEN" "$DST" >/dev/null 2>&1 || log "launch: the old app did not open either"
    fi
    finish false launch
  fi
  log "launch: opened"
fi
finish true done
`;

/** @req FR:devops-installer/swap.@script */
export function helperEnv(j: HelperJob): Record<string, string> {
  const p = helperPaths(j.stateDir);
  return {
    STACK_UPDATE_SOURCE: j.source, STACK_UPDATE_TARGET: j.target, STACK_UPDATE_LOG: p.log, STACK_UPDATE_RESULT: p.result,
    STACK_UPDATE_PID: j.pid === undefined ? '' : String(j.pid), STACK_UPDATE_RELAUNCH: j.relaunch ? '1' : '0', STACK_UPDATE_QUIT: j.quit ? '1' : '0',
    STACK_UPDATE_SHA: j.sha ?? '',
  };
}

/** Writes the helper to `<stateDir>/app/update.sh` and returns its path. */
export function writeHelper(stateDir: string): string {
  const { script } = helperPaths(stateDir);
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, HELPER_SCRIPT, { mode: 0o700 });
  chmodSync(script, 0o700);
  return script;
}

const helperProcessEnv = (j: HelperJob): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '', ...helperEnv(j) });

/** Starts the helper detached (own process group, no stdio), so it outlives the app. @req FR:devops-installer/swap.detached */
export function spawnHelperDetached(j: HelperJob, spawnFn: typeof spawn = spawn): void {
  const child = spawnFn('/bin/bash', [writeHelper(j.stateDir)], { detached: true, stdio: 'ignore', env: helperProcessEnv(j) });
  child.unref();
}

/** Runs the helper and waits (the CLI); answers what it recorded. */
export function runHelperSync(j: HelperJob): UpdateResult {
  const { result } = helperPaths(j.stateDir);
  // A stale result from an earlier run must never read as this run's. @req FR:devops-installer/swap.result
  rmSync(result, { force: true });
  const r = spawnSync('/bin/bash', [writeHelper(j.stateDir)], { stdio: 'ignore', env: helperProcessEnv(j) });
  const got = parseResult(readText(result));
  if (r.status === 0 && got?.ok) return got;
  return got && !got.ok ? got : { ok: false, step: 'start', at: new Date().toISOString() };
}

/** A file's text, or null when it cannot be read. */
export function readText(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

export interface UpdaterDeps {
  /** This app's stamp; null outside a stamped bundle. */
  running: BuildStamp | null;
  /** The bundle this app runs from; null when it cannot swap itself. */
  target: string | null;
  /** The available build (a bundle path). */
  source: string;
  stateDir: string;
  pid: number;
  readText(p: string): string | null;
  settings(): UpdateSettings;
  saveSettings(s: UpdateSettings): void;
  spawnHelper(j: HelperJob): void;
  quit(): void;
  log?(line: string): void;
}

export interface AppUpdater {
  state(): VersionState;
  setMode(mode: UpdateMode, idleMinutes?: number): VersionState;
  /** Starts the helper (relaunch on) and quits. Throws `UpdateRefused`. */
  restart(): void;
  /** The quit hook: in `on-quit` mode starts the helper with no relaunch. Never throws; true when it started one. */
  onQuit(): boolean;
  /** The idle hook: in `auto-idle` mode restarts when idle long enough and the window is hidden (`shown` false). True when it restarted. */
  idleCheck(idleSeconds: number, shown: boolean): boolean;
}

export function createAppUpdater(d: UpdaterDeps): AppUpdater {
  const log = d.log ?? ((l: string) => console.log(l));
  /** One helper per app run: a restart in flight wins over the quit hook. */
  let started = false;
  const state = (): VersionState => {
    const available = parseStamp(d.readText(manifestPath(d.source)));
    const s = d.settings();
    return {
      running: d.running, available, ready: isNewer(available, d.running), mode: s.mode, idleMinutes: s.idleMinutes,
      canRestart: d.target !== null, last: parseResult(d.readText(helperPaths(d.stateDir).result)),
    };
  };
  const job = (relaunch: boolean, sha: string | undefined): HelperJob => ({ source: d.source, target: d.target!, stateDir: d.stateDir, pid: d.pid, relaunch, quit: false, ...(sha ? { sha } : {}) });
  /** @req FR:devops-installer/restart.ready @req FR:devops-installer/restart.spawn */
  const restart = () => {
    const s = state();
    if (!s.ready) throw new UpdateRefused('No update ready');
    if (!s.canRestart) throw new UpdateRefused('Restart is not available on this host');
    if (!started) { d.spawnHelper(job(true, s.available?.sha)); started = true; }
    d.quit();
  };
  return {
    state,
    /** @req FR:devops-installer/version.mode */
    setMode: (mode, idleMinutes) => { d.saveSettings({ ...d.settings(), mode, ...(idleMinutes !== undefined ? { idleMinutes } : {}) }); return state(); },
    restart,
    /** @req FR:devops-installer/quit.spawn @req FR:devops-installer/quit.fast @req FR:devops-installer/quit.next */
    onQuit: () => {
      try {
        if (started || d.target === null) return false;
        const s = state();
        if (s.mode !== 'on-quit' || !s.ready) return false;
        d.spawnHelper(job(false, s.available?.sha));
        started = true;
        log('update: installs after quit');
        return true;
      } catch (e) { log(`update: ${e instanceof Error ? e.message : String(e)}`); return false; }
    },
    /** @req FR:devops-installer/idle.check @req FR:devops-installer/mode.never-launch */
    idleCheck: (idleSeconds, shown) => {
      if (started || shown) return false;
      const s = state();
      if (s.mode !== 'auto-idle' || !s.ready || !s.canRestart || idleSeconds < s.idleMinutes * 60) return false;
      try { restart(); return true; } catch (e) { log(`update: ${e instanceof Error ? e.message : String(e)}`); return false; }
    },
  };
}

const INSTALL_DOC = 'https://github.com/Xerilium/stack/blob/main/docs/desktop-install.md#update';

/**
 * At launch: a failed last update becomes a Needs-you ask; a good one clears it. Best effort.
 * @req FR:devops-installer/fail.note @req FR:devops-installer/fail.clear
 */
export async function noteUpdateResult(last: UpdateResult | null, reports: { put(body: unknown): Promise<unknown> }, now = new Date()): Promise<void> {
  if (!last) return;
  const asks = last.ok ? [] : [{
    id: 'update-failed', kind: 'go-do', by: now.toISOString().slice(0, 10), link: INSTALL_DOC,
    ask: `Stack update failed at ${basename(last.step).replace(/[^a-z-]/g, '')} and was rolled back. See ~/.stack/update.log`,
  }];
  await reports.put({ agent: 'installer', project: 'stack', top: [], asks, blockers: [], progress: [] });
}
