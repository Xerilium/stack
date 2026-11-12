import { describe, expect, it, vi } from 'vitest';
import { needCount, signInText, replyToOf, threadOf, ageText, countOf, createPrStore, escFor, escIn, healthyCount, loadPrefs, ownerOf, projectsOf, replyText, rowsOf, savePrefs, shortLabels, tabsOf, updatedText, type PrBoard, type PrRow } from '../src/prs';
import { connectLive, onLiveChange, type EventSourceLike } from '../src/live';

const row = (o: Partial<PrRow>): PrRow => ({
  url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1, title: 'T', author: 'me', project: 'xerilium', group: 'processing', draft: false, createdAt: '2026-11-10T12:00:00Z', updatedAt: '', ci: 'passing',
  unresolved: 0, labels: [], state: { owner: 'none', blocker: '', link: '', stalled: false, source: 'rule' }, healthy: true, agent: false, after: [], rank: null, pinned: false, autopilot: true, ...o,
});
const board = (rows: PrRow[], o: Partial<PrBoard> = {}): PrBoard => ({ at: '2026-11-11T12:00:00Z', user: 'me', agents: { count: 0, source: 'sessions' }, counts: { blocked: 0, waiting: 0, processing: 0, pending: 0, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, rows, queue: true, ...o });

// @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.filter @req FR:pr-page/group.healthy
describe('tabs and filters', () => {
  const b = board([
    row({ url: 'a', project: 'allyte' }), row({ url: 'b', healthy: false, state: { owner: 'reviewer', login: 'roland', blocker: 'Waiting on roland', link: '', stalled: false, source: 'rule' } }),
    row({ url: 'c', group: 'blocked', project: 'ftk', healthy: false }), row({ url: 'd', group: 'waiting', project: 'xerilium', healthy: false }),
  ]);
  it('the Escalation set tab only when present', () => {
    expect(tabsOf(b)).toEqual(['blocked', 'waiting', 'processing', 'pending', 'paused']);
    expect(tabsOf({ ...b, escalations: { blocked: [], enable: [], live: [{ repo: 'o/r', number: 1, url: 'u' }] } })[0]).toBe('escalations');
  });
  it('Processing hides healthy rows unless asked; counts follow the project filter', () => {
    expect(rowsOf(b, 'processing', []).map((r) => r.url)).toEqual(['b']);
    expect(rowsOf(b, 'processing', [], true).map((r) => r.url)).toEqual(['a', 'b']);
    expect(healthyCount(b, [])).toBe(1);
    expect(countOf(b, 'blocked', ['xerilium'])).toBe(0);
    expect(countOf(b, 'blocked', ['ftk', 'xerilium'])).toBe(1);
    expect(projectsOf(b)).toEqual(['allyte', 'ftk', 'xerilium']);
    expect(countOf({ ...b, escalations: { blocked: [{ repo: 'o/r', number: 1, url: 'u' }], enable: [], live: [] } }, 'escalations', [])).toBe(1);
  });
  it('the project filter covers the Escalation set, including PRs with no board row', () => {
    const e = { blocked: [{ repo: 'allytehq/x', number: 1, url: 'e1', project: 'allyte' }], enable: [{ repo: 'Xerilium/stack', number: 2, url: 'e2', project: 'xerilium' }], live: [{ repo: 'o/r', number: 3, url: 'e3', project: 'other' }] };
    const eb = board([], { escalations: e });
    expect(projectsOf(eb)).toEqual(['allyte', 'xerilium', 'other']);
    expect(countOf(eb, 'escalations', ['allyte'])).toBe(1);
    expect(escIn([...e.blocked, ...e.enable], ['allyte']).map((x) => x.url)).toEqual(['e1']);
  });
  it('prefs survive a reload and a broken store', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    savePrefs(s, { tab: 'waiting', projects: ['ftk'] });
    expect(loadPrefs(s)).toEqual({ tab: 'waiting', projects: ['ftk'] });
    expect(loadPrefs({ getItem: () => { throw new Error('denied'); } })).toEqual({ tab: 'blocked', projects: [] });
    expect(loadPrefs(null)).toEqual({ tab: 'blocked', projects: [] });
  });
});

// @req FR:pr-page/live.age @req FR:pr-page/flyout.row @req FR:pr-page/state.view @req FR:pr-page/act.accept
describe('words', () => {
  const now = new Date('2026-11-11T12:00:12Z');
  it('Updated 12 s ago; Paused until while backing off', () => {
    expect(updatedText(board([]), now)).toBe('Updated 12 s ago');
    expect(updatedText(board([], { at: '2026-11-11T11:55:00Z' }), now)).toBe('Updated 5 min ago');
    expect(updatedText(board([], { rate: { until: '2026-11-11T12:30:00Z' } }), now)).toMatch(/^Paused until /);
    expect(updatedText(board([], { at: null, error: 'GitHub unavailable' }), now)).toBe('GitHub unavailable');
  });
  it('age, owner chips, labels, reply text, keys', () => {
    expect([ageText('2026-11-11T11:50:00Z', now), ageText('2026-11-11T07:00:00Z', now), ageText('2026-11-08T12:00:00Z', now)]).toEqual(['10m', '5h', '3d']);
    expect(ownerOf(row({ state: { owner: 'me', blocker: 'x', link: '', stalled: false, source: 'rule' } }))).toEqual({ text: 'You', kind: 'me' });
    expect(ownerOf(row({ state: { owner: 'reviewer', login: 'roland', blocker: 'x', link: '', stalled: false, source: 'rule' } }))).toEqual({ text: 'roland', kind: 'reviewer' });
    expect(ownerOf(row({}))).toBeNull();
    expect(shortLabels(['Status: 🤖 Autopilot', 'bug', 'a', 'b'])).toEqual(['🤖 Autopilot', 'bug', 'a']);
    expect(replyText('  Use A ')).toBe('🤖 [AI] Use A');
    expect(threadOf({ url: 'u', link: 'l' })).toBe('l');
    expect(threadOf({ url: 'u' })).toBe('u');
    expect(replyToOf('https://github.com/o/r/pull/1#discussion_r42')).toBe(42);
    expect(replyToOf('https://github.com/o/r/pull/1#issuecomment-4')).toBeUndefined();
    expect(escFor(board([], { escalations: { blocked: [{ repo: 'o/r', number: 1, url: 'https://github.com/O/r/pull/1' }], enable: [], live: [] } }), 'https://github.com/o/r/pull/1')?.number).toBe(1);
  });
});

// @req FR:pr-page/live.event @req FR:pr-page/icon.absent
describe('store', () => {
  it('loads once for every subscriber, reloads on prs and poll changes, and turns off on 404', async () => {
    let n = 0;
    let hear: (k: string[]) => void = () => undefined;
    const s = createPrStore(async () => { n++; return board([]); }, { visible: () => true, every: 10_000_000, listen: (fn) => { hear = fn; return () => undefined; } });
    const off1 = s.subscribe(() => undefined); const off2 = s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('ready'));
    expect(n).toBe(1);
    hear(['tasks']); hear(['asks']); await Promise.resolve();
    expect(n).toBe(1);
    hear(['asks', 'tasks', 'state']); await vi.waitFor(() => expect(n).toBe(2)); // a reconnect
    n = 1;
    hear(['prs']); await vi.waitFor(() => expect(n).toBe(2));
    off1(); off2();
    const gone = createPrStore(async () => { throw Object.assign(new Error('nf'), { status: 404 }); }, { listen: () => () => undefined, every: 10_000_000 });
    gone.subscribe(() => undefined);
    await vi.waitFor(() => expect(gone.get().phase).toBe('off'));
  });
  it('two reloads that wait on the gate together load once', async () => {
    let n = 0;
    let open: (v: boolean) => void = () => undefined;
    const gate = new Promise<boolean>((r) => { open = r; });
    const s = createPrStore(async () => { n++; await new Promise((r) => setTimeout(r, 5)); return board([]); }, { enabled: () => gate, visible: () => true, every: 10_000_000, listen: () => () => undefined });
    s.subscribe(() => undefined);
    const a = s.reload(); const b = s.reload();
    open(true);
    await Promise.all([a, b]);
    await vi.waitFor(() => expect(s.get().phase).toBe('ready'));
    expect(n).toBe(1);
  });
  it('the live stream tells every listener its kinds', () => {
    const heard: string[][] = [];
    const off = onLiveChange((k) => heard.push(k));
    let fire: (e: { data: string }) => void = () => undefined;
    const es: EventSourceLike = { readyState: 1, onopen: null, onerror: null, addEventListener: (_t, fn) => { fire = fn; }, close: () => undefined };
    const stop = connectLive({ make: () => es, onChange: () => undefined, onStatus: () => undefined });
    fire({ data: JSON.stringify({ kinds: ['prs'] }) });
    expect(heard).toEqual([['prs']]);
    stop(); off();
  });
});

// @req FR:pr-page/auth.state @req FR:pr-page/nav.badge @req FR:pr-page/nav.load
describe('signed out, loading, and the nav count', () => {
  it('a signed-out answer is phase signin with the method, never a zero board', async () => {
    const s = createPrStore(async () => ({ auth: { state: 'signed-out', method: 'gh' } }) as never, { visible: () => true, every: 10_000_000, listen: () => () => undefined });
    expect(s.get().phase).toBe('loading');
    s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('signin'));
    expect(s.get().board).toBeNull();
    expect(s.get().auth).toEqual({ state: 'signed-out', method: 'gh' });
  });
  it('a sign-in that lands turns the next load into the board', async () => {
    let signedIn = false;
    const s = createPrStore(async () => (signedIn ? board([]) : ({ auth: { state: 'signed-out', method: 'gh' } }) as never), { visible: () => true, every: 10_000_000, listen: () => () => undefined });
    s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('signin'));
    signedIn = true;
    await s.reload();
    expect(s.get().phase).toBe('ready');
    expect(s.get().auth).toBeNull();
  });
  it('a failed first load (no snapshot, an error) is the failed state, never a zero board', async () => {
    const s = createPrStore(async () => board([], { at: null, error: 'GitHub unavailable' }), { visible: () => true, every: 10_000_000, listen: () => () => undefined });
    s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('error'));
    expect(s.get().board).toBeNull();
  });
  it('signed out, it checks again each 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const s = createPrStore(async () => { n++; return ({ auth: { state: 'signed-out', method: 'gh' } }) as never; }, { visible: () => true, every: 10_000_000, listen: () => () => undefined });
      const off = s.subscribe(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(n).toBe(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(n).toBe(2);
      off();
    } finally { vi.useRealTimers(); }
  });
  it('needCount is Blocked on me plus Waiting on me', () => {
    expect(needCount(board([], { counts: { blocked: 2, waiting: 3, processing: 9, pending: 4, paused: 1 } }))).toBe(5);
    expect(needCount(null)).toBe(0);
  });
  it('the sign-in words: one honest line per method and session', () => {
    expect(signInText({ state: 'signed-out', method: 'gh' })).toEqual({ title: 'Sign in to GitHub to see your PRs.', action: 'Sign in to GitHub' });
    expect(signInText({ state: 'signed-out', method: 'none' })).toEqual({ title: 'Install the GitHub CLI, or set GITHUB_TOKEN.', detail: 'Then reopen this page. Stack reads the gh sign-in; it never stores a token.' });
    expect(signInText({ state: 'signed-out', method: 'gh', session: { state: 'error', error: 'expired' } }).note).toBe('The code expired. Try again.');
    expect(signInText({ state: 'signed-out', method: 'gh', session: { state: 'error', error: 'failed' } }).note).toBe('GitHub sign-in did not finish. Try again.');
  });
});
