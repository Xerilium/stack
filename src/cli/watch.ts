/**
 * Watches the served folder and turns bursts of file changes into one classified change.
 * @req FR:ask-queue/live.watch
 */
import { existsSync, watch as fsWatch, type FSWatcher } from 'fs';
import { join } from 'path';

/** The only folders whose files `classify` reports; watching the rest (`.git`, `node_modules`) is wasted work. @req FR:perf/watch.scope */
const WATCHED = ['tasks', '.stack'];

export type ChangeKind = 'asks' | 'tasks' | 'state';
export const ALL_KINDS: ChangeKind[] = ['asks', 'tasks', 'state'];
export interface Change { rev: number; kinds: ChangeKind[] }
export interface Watcher {
  rev(): number;
  /** False when the folder could not be watched; the page then polls. */
  active(): boolean;
  on(fn: (c: Change) => void): () => void;
  close(): void;
}

/** Kind for a path relative to the served folder; `null` for anything not worth a refresh (dotfiles, editor temp files, `.git`). */
export function classify(rel: string): ChangeKind | null {
  const p = rel.split('\\').join('/');
  const parts = p.split('/');
  const name = parts[parts.length - 1];
  if (parts[0] === '.git' || parts.includes('node_modules')) return null;
  if (name.startsWith('.') && parts[0] !== '.stack') return null;
  if (name.startsWith('.') || /(~|\.swp|\.swx|\.tmp)$/.test(name) || !/\.md$/.test(name)) return null;
  if (parts[0] === 'tasks' && parts[1] === 'asks') return 'asks';
  if (parts[0] === 'tasks') return 'tasks';
  if (parts[0] === '.stack') return 'state';
  return null;
}

export interface WatchOptions {
  debounceMs?: number;
  /** Hears every raw file event before filtering; tests use it to know the OS watcher is armed. */
  onRaw?: (file: string) => void;
  /** Test seam: replaces `fs.watch`, so unit tests drive events by hand instead of waiting for the OS. */
  watchFn?: typeof fsWatch;
}

export function watchRepo(dir: string, o: WatchOptions = {}): Watcher {
  const watch = o.watchFn ?? fsWatch;
  const wait = o.debounceMs ?? 150;
  let rev = 0;
  let pending = new Set<ChangeKind>();
  let timer: NodeJS.Timeout | null = null;
  const subs = new Set<(c: Change) => void>();
  const ws = new Map<string, FSWatcher>();
  let root: FSWatcher | null = null;
  let active = false;
  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    const kinds = ALL_KINDS.filter((k) => pending.has(k));
    pending = new Set();
    const c: Change = { rev: ++rev, kinds };
    for (const fn of [...subs]) fn(c);
  };
  const note = (rel: string) => {
    const k = classify(rel);
    if (!k) return;
    pending.add(k);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, wait);
  };
  const fail = (e: Error) => { active = false; console.error(`stack web: file watcher stopped (${e.message}); the page polls instead`); };
  /** Watch one of the folders once it exists. */
  const arm = (name: string): boolean => {
    if (ws.has(name) || !existsSync(join(dir, name))) return false;
    const w = watch(join(dir, name), { recursive: true }, (_ev, file) => { if (file) { o.onRaw?.(`${name}/${String(file)}`); note(`${name}/${String(file)}`); } });
    w.on('error', fail);
    ws.set(name, w);
    return true;
  };
  try {
    for (const n of WATCHED) arm(n);
    // A folder that appears later (`.stack` on the first Chief of Staff write) shows up as a root entry: watch it, and report what it already holds.
    root = watch(dir, { recursive: false }, (_ev, file) => {
      const name = file ? String(file) : '';
      if (file) o.onRaw?.(name);
      if (WATCHED.includes(name) && arm(name)) note(`${name}/new.md`);
    });
    root.on('error', fail);
    active = true;
  } catch (e) { console.error(`stack web: cannot watch ${dir} (${(e as Error).message}); the page polls instead`); }
  return {
    rev: () => rev,
    active: () => active,
    on(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    close() { if (timer) clearTimeout(timer); timer = null; for (const w of ws.values()) w.close(); ws.clear(); root?.close(); root = null; active = false; subs.clear(); },
  };
}
