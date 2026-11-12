/**
 * The owner's priorities on the page: what shows, the edits, and the save with one rebase on a conflict.
 * The model and its rules live in the core (`FR:session-inventory/pris.model`); this file mirrors only the limits.
 * @req FR:pris-sessions-ui/pris.block @req FR:pris-sessions-ui/pris.edit @req FR:pris-sessions-ui/pris.save @req FR:pris-sessions-ui/pris.conflict
 */
import { ApiFailure } from './api';

export type PriStatus = 'active' | 'paused' | 'blocked' | 'done';
export type ItemStatus = 'todo' | 'doing' | 'blocked' | 'done';
export interface PriItem { text: string; status: ItemStatus }
export interface Pri { id: string; title: string; status: PriStatus; items: PriItem[]; backlog: PriItem[]; weekly: { week: string; text: string }[] }
export interface PrisFile { version: 1; rev: number; updatedAt?: string; pris: Pri[] }

export interface StatusWord { glyph: string; word: string; warn?: boolean }
/** Glyph plus word, never color alone. @req FR:pris-sessions-ui/pris.status */
export const PRI_STATUS: Record<PriStatus, StatusWord> = { active: { glyph: '●', word: 'Active' }, paused: { glyph: '‖', word: 'Paused' }, blocked: { glyph: '⛔', word: 'Blocked', warn: true }, done: { glyph: '✓', word: 'Done' } };
export const ITEM_STATUS: Record<ItemStatus, StatusWord> = { todo: { glyph: '○', word: 'Todo' }, doing: { glyph: '◐', word: 'Doing' }, blocked: { glyph: '⛔', word: 'Blocked', warn: true }, done: { glyph: '✓', word: 'Done' } };

/** @req FR:pris-sessions-ui/pris.limits */
export const LIMITS = { pris: 30, items: 20, title: 200, item: 300 } as const;
const TOP = 5;

/** One line, trimmed, at most `max` characters. */
export function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** First 5 priorities that are not done, numbered by stored order; `showAll` shows every one. @req FR:pris-sessions-ui/pris.block */
export function visiblePris(pris: Pri[], showAll: boolean): { shown: { n: number; pri: Pri }[]; more: number } {
  const all = pris.map((pri, i) => ({ n: i + 1, pri }));
  if (showAll) return { shown: all, more: 0 };
  const shown = all.filter((x) => x.pri.status !== 'done').slice(0, TOP);
  return { shown, more: all.length - shown.length };
}

export const progress = (p: Pri): { done: number; total: number } => ({ done: p.items.filter((i) => i.status === 'done').length, total: p.items.length });

/** The item to show at a glance: doing, else todo, else blocked. */
export function nextItem(p: Pri): PriItem | undefined {
  for (const s of ['doing', 'todo', 'blocked'] as const) { const i = p.items.find((x) => x.status === s); if (i) return i; }
  return undefined;
}

/** A unique id from a title: `[a-z0-9-]`, at most 24 characters. @req FR:pris-sessions-ui/pris.limits */
export function slugId(title: string, taken: Set<string>): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'p';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = `-${n}`;
    const id = `${base.slice(0, 24 - tail.length).replace(/-+$/, '')}${tail}`;
    if (!taken.has(id)) return id;
  }
}

/** An edit: a new list, or null when it does not apply (target gone, moved, or nothing changes). */
export type Edit = (pris: Pri[]) => Pri[] | null;

const onPri = (id: string, f: (p: Pri) => Pri | null): Edit => (pris) => {
  const i = pris.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const next = f(pris[i]);
  return next ? pris.map((p, j) => (j === i ? next : p)) : null;
};
/** The item at `index` only while its text is still `expect`, so a rebase never edits the wrong one. */
const onItem = (id: string, index: number, expect: string, f: (items: PriItem[], i: number) => PriItem[] | null): Edit =>
  onPri(id, (p) => {
    if (p.items[index]?.text !== expect) return null;
    const items = f(p.items, index);
    return items ? { ...p, items } : null;
  });

/** @req FR:pris-sessions-ui/pris.edit */
export const edits = {
  title: (id: string, text: string): Edit => onPri(id, (p) => { const t = oneLine(text, LIMITS.title); return t && t !== p.title ? { ...p, title: t } : null; }),
  status: (id: string, status: PriStatus): Edit => onPri(id, (p) => (p.status === status ? null : { ...p, status })),
  itemText: (id: string, index: number, expect: string, text: string): Edit => onItem(id, index, expect, (items, i) => {
    const t = oneLine(text, LIMITS.item);
    return t && t !== items[i].text ? items.map((x, j) => (j === i ? { ...x, text: t } : x)) : null;
  }),
  itemStatus: (id: string, index: number, expect: string, status: ItemStatus): Edit => onItem(id, index, expect, (items, i) => (items[i].status === status ? null : items.map((x, j) => (j === i ? { ...x, status } : x)))),
  addItem: (id: string, text: string): Edit => onPri(id, (p) => { const t = oneLine(text, LIMITS.item); return t && p.items.length < LIMITS.items ? { ...p, items: [...p.items, { text: t, status: 'todo' }] } : null; }),
  removeItem: (id: string, index: number, expect: string): Edit => onItem(id, index, expect, (items, i) => items.filter((_, j) => j !== i)),
  /** Swaps with the next priority up or down; `over` names the ones on screen, so a hidden one is passed over. */
  move: (id: string, delta: -1 | 1, over?: string[]): Edit => (pris) => {
    const i = pris.findIndex((p) => p.id === id);
    let j = i + delta;
    if (over) while (j >= 0 && j < pris.length && !over.includes(pris[j].id)) j += delta;
    if (i < 0 || j < 0 || j >= pris.length) return null;
    const next = [...pris];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  },
  addPri: (title: string): Edit => (pris) => {
    const t = oneLine(title, LIMITS.title);
    if (!t || pris.length >= LIMITS.pris) return null;
    return [...pris, { id: slugId(t, new Set(pris.map((p) => p.id))), title: t, status: 'active', items: [], backlog: [], weekly: [] }];
  },
};

export type Outcome = 'saved' | 'rebased' | 'conflict' | 'invalid' | 'error' | 'noop';
export interface CommitResult { outcome: Outcome; file: PrisFile; message?: string }
export interface PrisApi { pris: () => Promise<PrisFile>; putPris: (rev: number, pris: Pri[]) => Promise<PrisFile> }

const isConflict = (e: unknown) => e instanceof ApiFailure && e.status === 409;
const why = (e: unknown): string => {
  if (e instanceof ApiFailure && e.details?.length) return `${e.details[0].field}: ${e.details[0].message}`;
  return e instanceof Error ? e.message : String(e);
};

/**
 * Saves one edit on top of `base`. On 409: re-read, apply the same edit, send once more.
 * Every failure returns the server list to show.
 * @req FR:pris-sessions-ui/pris.save @req FR:pris-sessions-ui/pris.conflict @req FR:pris-sessions-ui/pris.invalid
 */
export async function commitPris(api: PrisApi, base: PrisFile, edit: Edit): Promise<CommitResult> {
  const next = edit(base.pris);
  if (!next) return { outcome: 'noop', file: base };
  try {
    return { outcome: 'saved', file: await api.putPris(base.rev, next) };
  } catch (e) {
    if (!isConflict(e)) return { outcome: e instanceof ApiFailure && e.status === 400 ? 'invalid' : 'error', file: base, message: why(e) };
  }
  let fresh: PrisFile;
  try { fresh = await api.pris(); } catch (e) { return { outcome: 'error', file: base, message: why(e) }; }
  const again = edit(fresh.pris);
  if (!again) return { outcome: 'conflict', file: fresh };
  try {
    return { outcome: 'rebased', file: await api.putPris(fresh.rev, again) };
  } catch (e) {
    if (!isConflict(e)) return { outcome: e instanceof ApiFailure && e.status === 400 ? 'invalid' : 'error', file: fresh, message: why(e) };
  }
  try { return { outcome: 'conflict', file: await api.pris() }; } catch { return { outcome: 'conflict', file: fresh }; }
}

export type PrisPhase = 'loading' | 'ready' | 'absent' | 'error';
/** What the queue tells the page: the list to show, the phase, and toasts. */
export interface PrisSink { view: (l: Pri[]) => void; phase: (p: PrisPhase) => void; toast: (text: string) => void }

/**
 * The page's priorities: optimistic view, one save at a time on the latest server file, and re-reads that never undo an edit.
 * A read is dropped when a save ran, is running, or a text field was open at any point since it started.
 * @req FR:pris-sessions-ui/pris.save @req FR:pris-sessions-ui/pris.conflict @req FR:pris-sessions-ui/pris.invalid @req FR:pris-sessions-ui/live.pris
 */
export class PrisQueue {
  private server: PrisFile | null = null;
  private shown: Pri[] = [];
  private queue: Edit[] = [];
  private running = false;
  private editing = false;
  /** Bumps on each save start and each edit-field open: a read that saw another value is stale. */
  private gen = 0;
  constructor(private readonly api: PrisApi, private readonly sink: PrisSink) {}

  private show(l: Pri[]) { this.shown = l; this.sink.view(l); }

  /** Reads the server list unless a save or a text field could be overwritten. */
  async load(): Promise<void> {
    if (this.running || this.editing) return;
    const at = this.gen;
    try {
      const f = await this.api.pris();
      if (this.running || this.editing || at !== this.gen) return;
      this.server = f; this.show(f.pris); this.sink.phase('ready');
    } catch (e) {
      if (at !== this.gen) return;
      this.sink.phase(e instanceof ApiFailure && e.status === 404 ? 'absent' : this.server ? 'ready' : 'error');
    }
  }

  setEditing(on: boolean): void { if (on) this.gen++; this.editing = on; }

  /** Shows the edit at once and queues its save; an edit that changes nothing is dropped. */
  apply(edit: Edit): void {
    const n = edit(this.shown);
    if (!n) return;
    this.show(n);
    this.queue.push(edit);
    void this.drain();
  }

  /** Resolves when no save is queued or running (tests). */
  async idle(): Promise<void> { while (this.running) await new Promise((ok) => setTimeout(ok, 0)); }

  private async drain(): Promise<void> {
    if (this.running || !this.server) return;
    this.running = true;
    try {
      while (this.queue.length && this.server) {
        const edit = this.queue.shift()!;
        this.gen++;
        const r = await commitPris(this.api, this.server, edit);
        this.server = r.file;
        if (r.outcome === 'conflict') this.sink.toast('Priorities changed elsewhere. Reloaded.');
        else if (r.outcome === 'invalid') this.sink.toast(r.message ?? 'Not saved');
        else if (r.outcome === 'error') this.sink.toast(`Not saved: ${r.message ?? 'unknown error'}`);
        // The server list wins; edits still queued show again on top of it.
        if (r.outcome !== 'saved' && r.outcome !== 'rebased') this.show(this.queue.reduce((l, e) => e(l) ?? l, r.file.pris));
      }
      if (this.server) this.show(this.queue.reduce((l, e) => e(l) ?? l, this.server.pris));
    } finally { this.running = false; }
  }
}
