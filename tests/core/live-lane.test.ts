import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isExcluded, lockState, LiveError, LiveStore, pickNext, readLiveConfig, readQueue } from '../../src/core/live-lane';
import { parsePrRef, type PrRef } from '../../src/core/pr-review';

const NOW = new Date('2026-11-11T18:00:00Z');
const R = (s: string) => parsePrRef(s)!;
function mk(o: { alive?: (pid: number) => boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'stack-live-'));
  const lockPath = join(home, 'fh-server.lock');
  writeFileSync(join(home, 'live.config.json'), JSON.stringify({ lockPath }));
  const store = new LiveStore(home, { now: () => NOW, alive: o.alive ?? ((pid) => pid === 4242 || pid === 777) });
  return { home, lockPath, store };
}
const queue = (...refs: PrRef[]) => async () => refs.shift() ?? null;

describe('config', () => {
  // @req FR:pr-review-lane/lane.config
  it('defaults: /tmp/fh-server.lock, 5173-5182, 5180 reserved, #918 excluded; broken config uses defaults', () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-live-'));
    expect(readLiveConfig(home)).toEqual({ lockPath: '/tmp/fh-server.lock', portMin: 5173, portMax: 5182, reservedPorts: [5180], exclude: ['#918'] });
    writeFileSync(join(home, 'live.config.json'), '{bad');
    expect(readLiveConfig(home).lockPath).toBe('/tmp/fh-server.lock');
    writeFileSync(join(home, 'live.config.json'), JSON.stringify({ lockPath: '/x.lock', portMin: 6000, portMax: 6010, reservedPorts: [], exclude: ['o/r#3'] }));
    expect(readLiveConfig(home)).toEqual({ lockPath: '/x.lock', portMin: 6000, portMax: 6010, reservedPorts: [], exclude: ['o/r#3'] });
    expect(isExcluded(R('any/repo#918'), ['#918'])).toBe(true);
    expect(isExcluded(R('O/R#3'), ['o/r#3'])).toBe(true);
    expect(isExcluded(R('https://github.com/o/r/pull/3'), ['https://github.com/o/r/pull/3'])).toBe(true);
    expect(isExcluded(R('o/r#4'), ['#918', 'o/r#3'])).toBe(false);
  });
});

describe('pick', () => {
  // @req FR:pr-review-lane/lane.pick
  it('takes the first queued PR that is live, not excluded, not done', async () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-live-'));
    writeFileSync(join(home, 'pr-priority.json'), JSON.stringify({ version: 1, rev: 3, items: [
      { rank: 1, repo: 'o/r', number: 918, url: 'https://github.com/o/r/pull/918' },
      { rank: 2, repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' },
      { rank: 3, repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2' },
      { rank: 4, repo: 'o/r', number: 3, url: 'https://github.com/o/r/pull/3' },
    ] }));
    const q = readQueue(home);
    expect(q.map((r) => r.number)).toEqual([918, 1, 2, 3]);
    const live = new Set(['o/r#918', 'o/r#2', 'o/r#3']);
    const asked: number[] = [];
    const isLive = async (r: PrRef) => { asked.push(r.number); return live.has(`${r.repo}#${r.number}`); };
    expect((await pickNext(q, { exclude: ['#918'], done: ['o/r#2'] }, isLive))?.number).toBe(3);
    expect(asked).toEqual([1, 3]);
    expect(await pickNext(q, { exclude: ['#918'], done: ['o/r#2', 'o/r#3'] }, isLive)).toBeNull();
    expect(readQueue(mkdtempSync(join(tmpdir(), 'stack-live-')))).toEqual([]);
  });
});

describe('lane', () => {
  // @req FR:pr-review-lane/lane.model @req FR:pr-review-lane/lane.next
  it('claims one PR; a second next returns it and records the agent only when empty', async () => {
    const { home, store } = mk();
    expect(store.view().state).toBe('idle');
    const a = await store.next({ agent: 'live-1', worktree: '/wt/1' }, queue(R('o/r#1'), R('o/r#2')));
    expect(a).toMatchObject({ changed: true, active: { repo: 'o/r', number: 1, state: 'preparing', by: 'live-1', worktree: '/wt/1', claimedAt: NOW.toISOString() } });
    const b = await store.next({ agent: 'live-2' }, queue(R('o/r#2')));
    expect(b).toMatchObject({ changed: false, active: { number: 1, by: 'live-1' } });
    const f = JSON.parse(readFileSync(join(home, 'live-lane.json'), 'utf8'));
    expect(f).toMatchObject({ version: 1, rev: 1, active: { number: 1 }, done: [] });
    expect(existsSync(join(home, 'live-lane.lock'))).toBe(false);
    await expect(new LiveStore(home).next({}, queue())).resolves.toMatchObject({ changed: false });
    const empty = mk();
    await expect(empty.store.next({}, queue())).rejects.toMatchObject({ code: 'none' });
    // An explicit ref wins over the queue.
    const c = mk();
    expect((await c.store.next({ ref: R('o/r#9') }, queue(R('o/r#1')))).active?.number).toBe(9);
  });

  // @req FR:pr-review-lane/lane.config
  it('never claims an excluded PR, even by ref', async () => {
    const { store } = mk();
    await expect(store.next({ ref: R('o/r#918') }, queue())).rejects.toMatchObject({ code: 'usage' });
  });

  // @req FR:pr-review-lane/lane.lock @req FR:pr-review-lane/lane.port @req FR:pr-review-lane/lane.ready
  it('respects the shared server lock and the port range', async () => {
    const { lockPath, store } = mk();
    await store.next({ agent: 'live-1' }, queue(R('o/r#1')));
    // Port rules.
    await expect(store.ready(R('o/r#1'), { url: 'http://localhost:5180', pid: 4242 })).rejects.toMatchObject({ code: 'usage' });
    await expect(store.ready(R('o/r#1'), { url: 'http://localhost:4000', pid: 4242 })).rejects.toMatchObject({ code: 'usage' });
    await expect(store.ready(R('o/r#1'), { url: 'ftp://x', pid: 4242 })).rejects.toMatchObject({ code: 'usage' });
    // Not the active PR.
    await expect(store.ready(R('o/r#2'), { url: 'http://localhost:5173', pid: 4242 })).rejects.toMatchObject({ code: 'notfound' });
    // Held by another owner with a live pid: refused, state kept, waitingOnLock set.
    writeFileSync(lockPath, JSON.stringify({ owner: 'sweep:fh', port: 5174, pid: 777, wt: '/x', head: 'abc' }));
    expect(lockState(JSON.parse(readFileSync(lockPath, 'utf8')), 'live:o/r#1', (p) => p === 777)).toEqual({ free: false, holder: 'sweep:fh (pid 777, port 5174)' });
    await expect(store.ready(R('o/r#1'), { url: 'http://localhost:5173', pid: 4242 })).rejects.toBeInstanceOf(LiveError);
    expect(store.view().active).toMatchObject({ state: 'preparing', waitingOnLock: 'sweep:fh (pid 777, port 5174)' });
    // Next reports a held lock and does not take it.
    expect((await store.next({}, queue())).lock).toBe('sweep:fh (pid 777, port 5174)');
    // Stale (pid dead): taken over and written with the lane fields.
    writeFileSync(lockPath, JSON.stringify({ owner: 'sweep:fh', port: 5174, pid: 999, wt: '/x', head: 'abc' }));
    const r = await store.ready(R('o/r#1'), { url: 'http://localhost:5175/app', pid: 4242, worktree: '/wt/1', head: 'c'.repeat(40) });
    expect(r).toMatchObject({ state: 'ready-for-michael', serverUrl: 'http://localhost:5175/app', port: 5175, pid: 4242, worktree: '/wt/1' });
    expect(r.waitingOnLock).toBeUndefined();
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual({ owner: 'live:o/r#1', port: 5175, pid: 4242, wt: '/wt/1', head: 'c'.repeat(40) });
    // Same owner: free.
    expect(lockState({ owner: 'live:o/r#1', port: 5175, pid: 4242, wt: '', head: '' }, 'live:o/r#1', () => true).free).toBe(true);
    expect(lockState(null, 'x', () => true).free).toBe(true);
  });

  // @req FR:pr-review-lane/lane.state @req FR:pr-review-lane/lane.checklist @req FR:pr-review-lane/lane.item @req FR:pr-review-lane/lane.items
  it('seeds items, changes them, and computes ready vs revalidating', async () => {
    const { store } = mk();
    await store.next({ agent: 'live-1' }, queue(R('o/r#1')));
    const s = await store.seed(R('o/r#1'), ['Sign in works', 'Export CSV', 'sign in works'], 'live-1');
    expect(s.added).toBe(2);
    expect((await store.seed(R('o/r#1'), ['Export csv'], 'live-1')).added).toBe(0);
    const items = store.view().items;
    expect(items.map((i) => [i.text, i.by, i.state])).toEqual([['Sign in works', 'live-1', 'open'], ['Export CSV', 'live-1', 'open']]);
    expect(items[0].id).toMatch(/^li-[0-9a-f]{8}$/);
    const id = items[1].id;
    const added = await store.item(R('o/r#1'), 'add', { text: 'Dark mode', by: 'owner' });
    expect(added.item).toMatchObject({ text: 'Dark mode', by: 'owner', state: 'open', createdAt: NOW.toISOString() });
    expect((await store.item(R('o/r#1'), 'check', { id: items[0].id, by: 'owner' })).item.state).toBe('passed');
    expect((await store.item(R('o/r#1'), 'check', { id: items[0].id, by: 'owner' })).changed).toBe(false);
    expect((await store.item(R('o/r#1'), 'uncheck', { id: items[0].id, by: 'owner' })).item.state).toBe('open');
    expect((await store.item(R('o/r#1'), 'fail', { id: items[0].id, by: 'owner' })).item.state).toBe('failed');
    expect((await store.item(R('o/r#1'), 'needs-fix', { id, text: 'Header is wrong', by: 'owner' })).item).toMatchObject({ state: 'needs-fix', comment: 'Header is wrong' });
    expect((await store.item(R('o/r#1'), 'comment', { id, text: 'Also the footer', by: 'owner' })).item.comment).toBe('Also the footer');
    expect((await store.item(R('o/r#1'), 'edit', { id, text: 'Export CSV with headers', by: 'live-1' })).item.text).toBe('Export CSV with headers');
    await expect(store.item(R('o/r#1'), 'block', { id, by: 'live-1' })).rejects.toMatchObject({ code: 'usage' });
    await expect(store.item(R('o/r#1'), 'add', { by: 'owner' })).rejects.toMatchObject({ code: 'usage' });
    await expect(store.item(R('o/r#1'), 'check', { id: 'li-00000000', by: 'owner' })).rejects.toMatchObject({ code: 'notfound' });
    await expect(store.item(R('o/r#1'), 'add', { text: 'a\nb', by: 'owner' })).rejects.toMatchObject({ code: 'usage' });
    expect((await store.setState(R('o/r#1'), 'working')).state).toBe('working');
    await expect(store.setState(R('o/r#1'), 'ready-for-michael' as never)).rejects.toMatchObject({ code: 'usage' });
    expect((await store.item(R('o/r#1'), 'fixed', { id, by: 'live-1' })).item.state).toBe('fixed-pending-revalidation');
    expect((await store.ready(R('o/r#1'), { url: 'http://localhost:5173', pid: 4242 })).state).toBe('revalidating');
    await expect(store.item(R('o/r#2'), 'add', { text: 'x', by: 'owner' })).rejects.toMatchObject({ code: 'notfound' });
  });

  // @req FR:pr-review-lane/lane.needs
  it('blocked items surface in Needs you; an answer reopens them', async () => {
    const { store } = mk();
    await store.next({ agent: 'live-1' }, queue(R('o/r#1')));
    await store.seed(R('o/r#1'), ['Run the export'], 'live-1');
    const id = store.view().items[0].id;
    await store.item(R('o/r#1'), 'block', { id, reason: 'No test tenant access', by: 'live-1' });
    expect(store.needs()).toEqual([{ id: `lv.${id}`, title: 'Live check blocked: Run the export', recommendation: 'No test tenant access', link: 'https://github.com/o/r/pull/1', project: 'o/r' }]);
    await store.answerNeed(`lv.${id}`, { choice: 'reply', text: 'Use the demo tenant' });
    expect(store.view().items[0]).toMatchObject({ state: 'open', comment: 'Use the demo tenant' });
    expect(store.needs()).toEqual([]);
    await expect(store.answerNeed('lv.li-00000000', { choice: 'go' })).rejects.toMatchObject({ code: 'notfound' });
  });

  // @req FR:pr-review-lane/lane.resolve
  it('resolve marks done, frees our lock, and makes the next PR active at once', async () => {
    const { lockPath, store } = mk();
    await store.next({ agent: 'live-1' }, queue(R('o/r#1')));
    await store.ready(R('o/r#1'), { url: 'http://localhost:5173', pid: 4242 });
    expect(existsSync(lockPath)).toBe(true);
    const r = await store.resolve(R('o/r#1'), 'merged', queue(R('o/r#2')));
    expect(r.done).toMatchObject({ number: 1, reason: 'merged', at: NOW.toISOString() });
    expect(r.next).toMatchObject({ number: 2, state: 'preparing' });
    expect(r.next?.by).toBeUndefined();
    expect(existsSync(lockPath)).toBe(false);
    // The agent picks up the unowned PR.
    expect((await store.next({ agent: 'live-2' }, queue())).active).toMatchObject({ number: 2, by: 'live-2' });
    // Another owner's lock is never removed.
    writeFileSync(lockPath, JSON.stringify({ owner: 'sweep:fh', port: 5174, pid: 777, wt: '/x', head: 'h' }));
    const r2 = await store.resolve(R('o/r#2'), 'done', queue());
    expect(r2.next).toBeUndefined();
    expect(store.view().state).toBe('idle');
    expect(existsSync(lockPath)).toBe(true);
    expect(store.view().done.map((d) => d.number)).toEqual([2, 1]);
    await expect(store.resolve(R('o/r#5'), 'done', queue())).rejects.toMatchObject({ code: 'notfound' });
  });
});

describe('review fixes', () => {
  // @req FR:pr-review-lane/lane.item @req FR:pr-review-lane/lane.model
  it('records who made the last change and the PR title from facts', async () => {
    const { store } = mk();
    const a = await store.next({ agent: 'live-1', info: () => ({ title: 'Fix export', headSha: 'd'.repeat(40) }) }, queue(R('o/r#1')));
    expect(a.active).toMatchObject({ title: 'Fix export', headSha: 'd'.repeat(40) });
    const { item } = await store.item(R('o/r#1'), 'add', { text: 'Sign in', by: 'live-1' });
    expect((await store.item(R('o/r#1'), 'check', { id: item.id, by: 'live-1' })).item).toMatchObject({ by: 'live-1', updatedBy: 'live-1', state: 'passed' });
    expect((await store.item(R('o/r#1'), 'uncheck', { id: item.id, by: 'owner' })).item.updatedBy).toBe('owner');
  });
  // @req FR:pr-review-lane/lane.needs
  it('a stale answer never reopens an item that is no longer blocked', async () => {
    const { store } = mk();
    await store.next({}, queue(R('o/r#1')));
    const { item } = await store.item(R('o/r#1'), 'add', { text: 'Export', by: 'live-1' });
    await store.item(R('o/r#1'), 'block', { id: item.id, reason: 'No tenant', by: 'live-1' });
    await store.item(R('o/r#1'), 'check', { id: item.id, by: 'owner' });
    expect(await store.answerNeed(`lv.${item.id}`, { choice: 'go' })).toBe(false);
    expect(store.view().items[0].state).toBe('passed');
  });
});

// @req FR:pr-review-lane/lane.next
it('refuses a ref that is not the live PR', async () => {
  const { store } = mk();
  await store.next({}, queue(R('o/r#1')));
  await expect(store.next({ ref: R('o/r#2') }, queue())).rejects.toMatchObject({ code: 'conflict' });
  expect((await store.next({ ref: R('O/R#1') }, queue())).active.number).toBe(1);
});
