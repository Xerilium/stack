/**
 * Watches the served folder and turns bursts of file changes into one classified change.
 * @req FR:ask-queue/live.watch
 */
import { watch, type FSWatcher } from 'fs';

export type ChangeKind = 'asks' | 'tasks' | 'state';
export const ALL_KINDS: ChangeKind[] = ['asks', 'tasks', 'state'];
export interface Change { rev: number; kinds: ChangeKind[] }
export interface Watcher {
  rev(): number;
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

export function watchRepo(dir: string, o: { debounceMs?: number } = {}): Watcher {
  const wait = o.debounceMs ?? 150;
  let rev = 0;
  let pending = new Set<ChangeKind>();
  let timer: NodeJS.Timeout | null = null;
  const subs = new Set<(c: Change) => void>();
  let w: FSWatcher | null = null;
  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    const kinds = ALL_KINDS.filter((k) => pending.has(k));
    pending = new Set();
    const c: Change = { rev: ++rev, kinds };
    for (const fn of [...subs]) fn(c);
  };
  try {
    w = watch(dir, { recursive: true }, (_ev, file) => {
      const k = file ? classify(String(file)) : null;
      if (!k) return;
      pending.add(k);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, wait);
    });
    w.on('error', () => undefined);
  } catch { /* no watcher on this platform or folder: the page polls */ }
  return {
    rev: () => rev,
    on(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    close() { if (timer) clearTimeout(timer); timer = null; w?.close(); w = null; subs.clear(); },
  };
}
