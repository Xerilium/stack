/**
 * Desktop app updates on the page: a quiet chip and the Updates dialog. Never a toast, modal, or restart on its own.
 * @req FR:devops-installer/notice.poll @req FR:devops-installer/notice.chip @req FR:devops-installer/mode.never-launch
 */
import { useCallback, useEffect, useState } from 'preact/hooks';

export type UpdateMode = 'on-quit' | 'ask' | 'auto-idle' | 'off';
export interface BuildStamp { version: string; sha: string; dirty: boolean; builtAt: string }
/** `GET /api/version`. @req FR:devops-installer/$version-state */
export interface VersionState {
  running: BuildStamp | null; available: BuildStamp | null; ready: boolean; mode: UpdateMode; idleMinutes: number; canRestart: boolean;
  last: { ok: boolean; step: string; at: string } | null;
}

export const UPDATE_POLL_MS = 10 * 60_000;
export const UPDATE_MODES: readonly UpdateMode[] = ['on-quit', 'ask', 'auto-idle', 'off'];

/** The modes in plain words. @req FR:devops-installer/notice.words */
export const MODE_WORDS: Record<UpdateMode, (idleMinutes: number) => string> = {
  'on-quit': () => 'When I quit Stack (recommended)',
  ask: () => 'Only when I select Restart',
  'auto-idle': (n) => `When I'm away for ${n} minutes`,
  off: () => 'Never',
};

/** @req FR:devops-installer/notice.menu */
export const isUpdatesHash = (hash: string): boolean => hash === '#/updates';

/** What `Later` remembers: the build it hid. @req FR:devops-installer/notice.dismiss */
export const dismissKey = (s: VersionState): string | null => (s.available ? `${s.available.sha}@${s.available.builtAt}` : null);

/** `Update ready`, `Update failed`, or nothing. @req FR:devops-installer/notice.chip @req FR:devops-installer/notice.dismiss */
export function updateChip(s: VersionState | null, dismissed: string | null): string | null {
  if (!s) return null;
  if (s.ready) return dismissed !== null && dismissKey(s) === dismissed ? null : 'Update ready';
  return s.last && !s.last.ok ? 'Update failed' : null;
}

export interface UpdateWatchOpts {
  get: () => Promise<VersionState>;
  onState: (s: VersionState | null) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  visible?: () => boolean;
}

/** Reads once, then every 10 minutes while visible; a 404 (no installer on this host) stops for good. @req FR:devops-installer/notice.poll */
export function createUpdateWatch(o: UpdateWatchOpts) {
  const every = o.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const stopTimer = o.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let timer: unknown = null; let dead = false;
  const stop = () => { if (timer !== null) stopTimer(timer); timer = null; };
  const read = async () => {
    if (dead) return;
    try { o.onState(await o.get()); } catch (e) {
      if ((e as { status?: number }).status === 404) { dead = true; stop(); o.onState(null); }
    }
  };
  return {
    read,
    start: () => { void read().then(() => { if (!dead && timer === null) timer = every(() => { if (visible()) void read(); }, UPDATE_POLL_MS); }); },
    stop,
  };
}

/** `Later` lives for this window only: the client keeps no browser storage (web host guard). */
let laterBuild: string | null = null;
const loadLater = (): string | null => laterBuild;
const saveLater = (v: string | null) => { laterBuild = v; };

export interface UpdateApi {
  version: () => Promise<VersionState>;
  setUpdateMode: (mode: UpdateMode, idleMinutes?: number) => Promise<VersionState>;
  restartForUpdate: () => Promise<{ restarting: boolean }>;
}

/** The page's update state: chip text, the dialog, and its actions. Off on hosts with no installer. */
export function useUpdates(api: UpdateApi, onError: (m: string) => void, enabled: boolean) {
  const [state, setState] = useState<VersionState | null>(null);
  const [later, setLater] = useState<string | null>(loadLater);
  // Read during render, before the app rewrites the hash for its own view.
  const [open, setOpen] = useState(() => typeof location !== 'undefined' && isUpdatesHash(location.hash));
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const w = createUpdateWatch({ get: api.version, onState: setState });
    w.start();
    return w.stop;
  }, [enabled]);
  // `Stack > Updates…` loads #/updates. @req FR:devops-installer/notice.menu
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const on = () => { if (isUpdatesHash(location.hash)) setOpen(true); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [enabled]);
  const dismiss = useCallback(() => { const k = state ? dismissKey(state) : null; setLater(k); saveLater(k); }, [state]);
  const setMode = useCallback(async (mode: UpdateMode) => {
    try { setState(await api.setUpdateMode(mode)); } catch (e) { onError(e instanceof Error ? e.message : 'Could not save'); }
  }, [api]);
  /** @req FR:devops-installer/notice.restart */
  const restart = useCallback(async () => {
    setRestarting(true);
    try { await api.restartForUpdate(); } catch (e) { setRestarting(false); onError(e instanceof Error ? e.message : 'Restart failed'); }
  }, [api]);
  return { state, chip: updateChip(state, later), open, setOpen, dismiss, setMode, restart, restarting };
}
