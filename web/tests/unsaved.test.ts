import { describe, expect, it } from 'vitest';
import { createUnsaved, unsavedLabel, unsavedTitle, type UnsavedState } from '../src/unsaved';

type Fn = () => void;
/** A document/window stand-in: visibility we control, listeners we can fire. */
const fakeDom = () => {
  const doc = { visibilityState: 'visible' as string, on: new Map<string, Set<Fn>>(), addEventListener(t: string, fn: Fn) { (this.on.get(t) ?? this.on.set(t, new Set()).get(t))!.add(fn); }, removeEventListener(t: string, fn: Fn) { this.on.get(t)?.delete(fn); } };
  const win = { on: new Map<string, Set<Fn>>(), addEventListener(t: string, fn: Fn) { (this.on.get(t) ?? this.on.set(t, new Set()).get(t))!.add(fn); }, removeEventListener(t: string, fn: Fn) { this.on.get(t)?.delete(fn); } };
  const fire = (o: typeof doc | typeof win, t: string) => { for (const fn of o.on.get(t) ?? []) fn(); };
  return { doc, win, fire };
};
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const setup = (answer: { pending?: number; since?: string | null } = {}) => {
  const { doc, win, fire } = fakeDom();
  const posts: boolean[] = []; const states: UnsavedState[] = []; const errors: string[] = [];
  const server = { answer, postFail: null as null | Error, gets: 0 };
  const u = createUnsaved({
    get: async () => { server.gets++; return server.answer; },
    post: async (keepalive) => { posts.push(keepalive); if (server.postFail) throw server.postFail; server.answer = { pending: 0, since: null }; return { flushed: 1, rev: 'x' }; },
    onState: (s) => states.push(s), onError: (m) => errors.push(m), doc, win,
  });
  return { u, doc, win, fire, posts, states, errors, server };
};

describe('createUnsaved', () => {
  // @req FR:live-deploy/web.unsaved @req FR:live-deploy/web.unsaved.none
  it('reads the pending count and first time; a missing pending means nothing is unsaved', async () => {
    const { u, states, server } = setup({ pending: 3, since: '2026-10-31T10:00:00.000Z' });
    await u.check();
    expect(states.at(-1)).toEqual({ pending: 3, since: '2026-10-31T10:00:00.000Z', saving: false });
    server.answer = { rev: null } as never;
    await u.check();
    expect(states.at(-1)).toEqual({ pending: 0, since: null, saving: false });
  });
  // @req FR:live-deploy/web.unsaved.click
  it('flush posts, shows saving until the next answer, then re-reads the count', async () => {
    const { u, states, posts, server } = setup({ pending: 2, since: '2026-10-31T10:00:00.000Z' });
    await u.check();
    const p = u.flush();
    expect(states.at(-1)?.saving).toBe(true);
    await p;
    expect(posts).toEqual([false]);
    expect(states.at(-1)).toEqual({ pending: 0, since: null, saving: false });
    expect(server.gets).toBe(2);
  });
  // @req FR:live-deploy/web.unsaved.error
  it('a failed flush reports the error and keeps the count', async () => {
    const { u, states, errors, server } = setup({ pending: 2, since: '2026-10-31T10:00:00.000Z' });
    await u.check();
    server.postFail = new Error('Conflict on tasks/a.md: remote changed it concurrently');
    await u.flush();
    expect(errors).toEqual(['Conflict on tasks/a.md: remote changed it concurrently']);
    expect(states.at(-1)).toEqual({ pending: 2, since: '2026-10-31T10:00:00.000Z', saving: false });
  });
  // @req FR:live-deploy/web.unsaved.hide
  it('posts a keepalive flush when the page is hidden or unloaded with pending edits, not otherwise', async () => {
    const { u, doc, win, fire, posts, server } = setup({ pending: 1, since: '2026-10-31T10:00:00.000Z' });
    await u.check();
    doc.visibilityState = 'hidden'; fire(doc, 'visibilitychange'); await flush();
    expect(posts).toEqual([true]);
    expect(u.state().pending).toBe(0); // re-read after the save settled
    fire(win, 'pagehide'); await flush();
    expect(posts).toEqual([true]); // nothing pending any more: no second post
    server.answer = { pending: 1, since: null }; await u.check();
    fire(win, 'pagehide'); await flush();
    expect(posts).toEqual([true, true]);
    doc.visibilityState = 'visible'; fire(doc, 'visibilitychange'); await flush();
    doc.visibilityState = 'hidden'; fire(doc, 'visibilitychange'); fire(win, 'pagehide'); await flush();
    expect(posts).toEqual([true, true]); // nothing pending: no post
  });
  // @req FR:live-deploy/web.unsaved.refresh
  it('re-reads the count when the page becomes visible, and stops listening after stop()', async () => {
    const { u, doc, fire, server } = setup({ pending: 1, since: null });
    await u.check();
    expect(server.gets).toBe(1);
    doc.visibilityState = 'visible'; fire(doc, 'visibilitychange'); await flush();
    expect(server.gets).toBe(2);
    u.stop();
    fire(doc, 'visibilitychange'); await flush();
    expect(server.gets).toBe(2);
    expect(doc.on.get('visibilitychange')?.size ?? 0).toBe(0);
  });
});

describe('createUnsaved edge cases', () => {
  // @req FR:live-deploy/web.unsaved.refresh
  it('an older reply never overwrites a newer one', async () => {
    const { doc, win } = fakeDom();
    const states: UnsavedState[] = [];
    const replies: ((v: { pending: number; since: string | null }) => void)[] = [];
    const u = createUnsaved({ get: () => new Promise((ok) => replies.push(ok)), post: async () => undefined, onState: (s) => states.push(s), doc, win });
    const first = u.check(); const second = u.check();
    replies[1]({ pending: 1, since: null }); await second;
    replies[0]({ pending: 0, since: null }); await first;
    expect(states.at(-1)?.pending).toBe(1);
  });
  // @req FR:live-deploy/web.unsaved.error
  it('publishes saving=false even when the re-read after a save fails', async () => {
    const { doc, win } = fakeDom();
    const states: UnsavedState[] = [];
    let gets = 0;
    const u = createUnsaved({ get: async () => { if (++gets > 1) throw new Error('offline'); return { pending: 1, since: null }; }, post: async () => undefined, onState: (s) => states.push(s), doc, win });
    await u.check();
    await u.flush();
    expect(states.at(-1)).toEqual({ pending: 1, since: null, saving: false });
  });
  // @req FR:live-deploy/web.unsaved.hide
  it('sends the keepalive save while a click-started save is still in flight', async () => {
    const { doc, win, fire } = fakeDom();
    const posts: boolean[] = [];
    let release: () => void = () => undefined;
    const u = createUnsaved({ get: async () => ({ pending: 1, since: null }), post: (k) => { posts.push(k); return k ? Promise.resolve() : new Promise<void>((ok) => { release = ok; }); }, onState: () => undefined, doc, win });
    await u.check();
    const click = u.flush();
    fire(win, 'pagehide'); await flush();
    expect(posts).toEqual([false, true]);
    release(); await click;
  });
});

describe('chip words', () => {
  // @req FR:live-deploy/web.unsaved @req FR:live-deploy/web.unsaved.click @req FR:live-deploy/web.unsaved.none
  it('Unsaved · n, Saving… while saving, nothing when clean; the title names the first edit', () => {
    expect(unsavedLabel({ pending: 3, since: null, saving: false })).toBe('Unsaved · 3');
    expect(unsavedLabel({ pending: 3, since: null, saving: true })).toBe('Saving…');
    expect(unsavedLabel({ pending: 0, since: null, saving: false })).toBeNull();
    expect(unsavedTitle({ pending: 1, since: new Date(2026, 9, 31, 14, 5).toISOString(), saving: false })).toBe('First unsaved edit 2:05 PM · click to save now');
    expect(unsavedTitle({ pending: 1, since: null, saving: false })).toBe('Click to save now');
  });
});
