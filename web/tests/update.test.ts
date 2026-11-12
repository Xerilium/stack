import { describe, expect, it } from 'vitest';
import { createUpdateWatch, dismissKey, isUpdatesHash, MODE_WORDS, UPDATE_POLL_MS, updateChip, type VersionState } from '../src/update';

const STAMP = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };
const state = (o: Partial<VersionState> = {}): VersionState => ({ running: { ...STAMP, sha: 'aaaaaaaaaaaa' }, available: STAMP, ready: true, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: null, ...o });
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** Timers and visibility we control. */
function harness(answers: (VersionState | Error)[]) {
  const seen: (VersionState | null)[] = []; let gets = 0;
  const timers: { fn: () => void; ms: number }[] = [];
  let visible = true;
  const w = createUpdateWatch({
    get: async () => { const a = answers[Math.min(gets++, answers.length - 1)]; if (a instanceof Error) throw a; return a; },
    onState: (s) => seen.push(s),
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => { timers.length = 0; },
    visible: () => visible,
  });
  return { w, seen, timers, gets: () => gets, hide: () => { visible = false; } };
}

describe('update watch', () => {
  // @req FR:devops-installer/notice.poll
  it('reads once after load, then every 10 minutes while visible', async () => {
    const h = harness([state()]);
    h.w.start();
    await tick();
    expect(h.gets()).toBe(1);
    expect(h.timers[0].ms).toBe(UPDATE_POLL_MS);
    expect(UPDATE_POLL_MS).toBe(600_000);
    h.timers[0].fn(); await tick();
    expect(h.gets()).toBe(2);
    h.hide(); h.timers[0].fn(); await tick();
    expect(h.gets()).toBe(2);
  });
  // @req FR:devops-installer/notice.poll
  it('a 404 stops polling and shows nothing', async () => {
    const h = harness([Object.assign(new Error('Not found'), { status: 404 })]);
    h.w.start();
    await tick();
    expect(h.timers).toEqual([]);
    expect(h.seen.at(-1)).toBeNull();
  });
});

describe('update chip', () => {
  // @req FR:devops-installer/notice.chip @req FR:devops-installer/mode.never-launch
  it('shows Update ready, Update failed, or nothing', () => {
    expect(updateChip(state(), null)).toBe('Update ready');
    expect(updateChip(state({ ready: false }), null)).toBeNull();
    expect(updateChip(state({ ready: false, last: { ok: false, step: 'launch', at: 'x' } }), null)).toBe('Update failed');
    expect(updateChip(state({ ready: false, last: { ok: true, step: 'done', at: 'x' } }), null)).toBeNull();
    expect(updateChip(null, null)).toBeNull();
  });
  // @req FR:devops-installer/notice.dismiss
  it('Later hides it until a different build is ready', () => {
    const key = dismissKey(state())!;
    expect(key).toBe('bbbbbbbbbbbb@2026-11-12T10:00:00.000Z');
    expect(updateChip(state(), key)).toBeNull();
    expect(updateChip(state({ available: { ...STAMP, sha: 'cccccccccccc' } }), key)).toBe('Update ready');
    expect(updateChip(state({ available: { ...STAMP, dirty: true, builtAt: '2026-11-12T11:00:00.000Z' } }), key)).toBe('Update ready');
  });
});

describe('Updates dialog', () => {
  // @req FR:devops-installer/notice.words
  it('names the four modes in plain words', () => {
    expect(MODE_WORDS['on-quit'](30)).toBe('When I quit Stack (recommended)');
    expect(MODE_WORDS.ask(30)).toBe('Only when I select Restart');
    expect(MODE_WORDS['auto-idle'](15)).toBe("When I'm away for 15 minutes");
    expect(MODE_WORDS.off(30)).toBe('Never');
  });
  // @req FR:devops-installer/notice.menu
  it('opens for the #/updates hash', () => {
    expect(isUpdatesHash('#/updates')).toBe(true);
    expect(isUpdatesHash('#/asks')).toBe(false);
  });
});
