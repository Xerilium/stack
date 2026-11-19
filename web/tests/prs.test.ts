import { describe, expect, it, vi } from 'vitest';
import {
  ACTION_LABEL, actionable, actionsOf, authorText, flagText, countOf, serverHref, starting, createPrStore, loadPrefs, moveTo, needCount, projectsOf, rowsOf, savePrefs, signInText, specText, summaryView, sweepCommand, tabsOf, TAB_LABEL, toneOf, totalOf, updatedText,
  type PrBoard, type PrRow,
} from '../src/prs';

const row = (o: Partial<PrRow>): PrRow => ({
  url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1, title: 'T', author: 'me', mine: true, project: 'xerilium', group: 'processing', draft: false, createdAt: '2026-11-10T12:00:00Z', updatedAt: '', ci: 'passing',
  unresolved: 0, labels: [], state: { owner: 'none', blocker: '', link: '', stalled: false, source: 'rule' }, healthy: true, agent: false, after: [], rank: null, pinned: false, autopilot: true,
  nextAction: null, specLines: null, detail: {}, ...o,
});
const board = (rows: PrRow[], o: Partial<PrBoard> = {}): PrBoard => ({
  at: '2026-11-11T12:00:00Z', user: 'me', agents: { count: 0, source: 'sessions' }, counts: { waiting: 0, processing: 0, pending: 0, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, rows,
  summary: { live: [], signoff: [], autopilot: [], missing: [] }, queue: true, servers: false, ...o,
});

// @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.filter @req FR:pr-page/pin.tab
describe('tabs, counts, and filters', () => {
  const b = board([
    row({ url: 'a', project: 'allyte', nextAction: 'validate', pinned: true, rank: 2 }), row({ url: 'b', nextAction: 'signoff', pinned: true, rank: 1 }),
    row({ url: 'c', group: 'waiting', project: 'ftk', mine: false, author: 'roland', nextAction: 'approve' }), row({ url: 'd', group: 'pending', autopilot: false }),
  ], { servers: true, summary: { live: ['a'], signoff: ['b'], autopilot: [], missing: [{ url: 'c', reason: 'Approve' }, { url: 'a', reason: 'Live check failed: Login' }] } });
  it('Summary first, then the groups, then Pinned; clear names', () => {
    expect(tabsOf()).toEqual(['summary', 'processing', 'waiting', 'pending', 'paused', 'pinned']);
    expect(tabsOf().map((t) => TAB_LABEL[t])).toEqual(['Summary', 'Processing', 'Waiting on me', 'Pending', 'Paused', 'Pinned']);
  });
  it('Pinned lists pinned rows by rank; groups list their rows; counts follow the project filter', () => {
    expect(rowsOf(b, 'pinned', []).map((r) => r.url)).toEqual(['b', 'a']);
    expect(rowsOf(b, 'processing', []).map((r) => r.url)).toEqual(['a', 'b']);
    expect(countOf(b, 'pinned', ['allyte'])).toBe(1);
    expect(countOf(b, 'waiting', [])).toBe(1);
    // Summary counts distinct PRs: a, b, c.
    expect(countOf(b, 'summary', [])).toBe(3);
    expect(countOf(b, 'summary', ['ftk'])).toBe(1);
    expect(projectsOf(b)).toEqual(['allyte', 'ftk', 'xerilium']);
  });
  // @req FR:pr-page/flyout.header.total @req FR:pr-page/flyout.filter.count
  it('totalOf counts board rows under the project filter, whatever the tab; one project gives its chip count', () => {
    expect(totalOf(b, [])).toBe(4);
    expect(totalOf(b, ['allyte'])).toBe(1);
    expect(totalOf(b, ['allyte', 'ftk'])).toBe(2);
    expect(totalOf(b, ['xerilium'])).toBe(2);
    expect(totalOf(null, [])).toBe(0);
  });
  // @req FR:pr-page/summary.layout @req FR:pr-page/summary.missing
  it('summaryView maps urls to rows under the filter and drops urls with no row', () => {
    const v = summaryView({ ...b, summary: { ...b.summary!, signoff: ['b', 'gone'] } }, []);
    expect(v.live.map((r) => r.url)).toEqual(['a']);
    expect(v.signoff.map((r) => r.url)).toEqual(['b']);
    expect(v.missing.map((m) => `${m.row.url} ${m.reason}`)).toEqual(['c Approve', 'a Live check failed: Login']);
    expect(summaryView(b, ['ftk']).live).toEqual([]);
    expect(summaryView(null, []).missing).toEqual([]);
  });
  it('prefs default to Summary; old tabs fall back to Summary; a broken store is fine', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    savePrefs(s, { tab: 'pinned', projects: ['ftk'] });
    expect(loadPrefs(s)).toEqual({ tab: 'pinned', projects: ['ftk'] });
    m.set('stack.prs.v1', JSON.stringify({ tab: 'blocked', projects: [] }));
    expect(loadPrefs(s).tab).toBe('summary');
    expect(loadPrefs({ getItem: () => { throw new Error('denied'); } })).toEqual({ tab: 'summary', projects: [] });
    expect(loadPrefs(null)).toEqual({ tab: 'summary', projects: [] });
  });
});

// @req FR:pr-page/card.fields @req FR:pr-page/card.color @req FR:pr-page/card.action
describe('card words and colors', () => {
  it('next action labels', () => {
    expect(ACTION_LABEL).toEqual({ validate: 'Validate', signoff: 'Sign off', approve: 'Approve', publish: 'Publish review', autopilot: 'Enable Autopilot' });
  });
  it('author: My Autopilot, You, or the login', () => {
    expect(authorText(row({}))).toBe('My Autopilot');
    expect(authorText(row({ autopilot: false }))).toBe('You');
    expect(authorText(row({ mine: false, author: 'roland', autopilot: true }))).toBe('roland');
  });
  it('tone: owner kind and strength', () => {
    expect(toneOf(row({ nextAction: 'signoff' }))).toBe('auto strong');
    expect(toneOf(row({}))).toBe('auto');
    expect(toneOf(row({ autopilot: false, nextAction: 'autopilot' }))).toBe('mine strong');
    expect(toneOf(row({ mine: false, nextAction: null }))).toBe('other');
  });
  it('spec lines: small text only when known', () => {
    expect(specText(row({ specLines: 1 }))).toBe('1 spec line');
    expect(specText(row({ specLines: 42 }))).toBe('42 spec lines');
    expect(specText(row({ specLines: 0 }))).toBe('0 spec lines');
    expect(specText(row({}))).toBe('');
  });
  // @req FR:pr-page/nav.badge
  it('the nav count is the rows with a next action', () => {
    expect(needCount(board([row({ nextAction: 'approve' }), row({}), row({ nextAction: 'signoff' })]))).toBe(2);
    expect(needCount(null)).toBe(0);
  });
});

// @req FR:pr-page/pin.drag @req FR:pr-page/pin.keys
describe('moveTo: the Pinned order', () => {
  it('moves one item and returns the new rank (1 is first)', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual({ order: ['d', 'a', 'b', 'c'], rank: 1 });
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 2)).toEqual({ order: ['b', 'c', 'a', 'd'], rank: 3 });
    expect(moveTo(['a', 'b'], 'a', 9)).toEqual({ order: ['b', 'a'], rank: 2 });
    expect(moveTo(['a', 'b'], 'a', 0)).toBeNull();
    expect(moveTo(['a', 'b'], 'x', 0)).toBeNull();
  });
});

// @req FR:pr-page/live.age
it('Updated 12 s ago; Paused until while backing off', () => {
  const now = new Date('2026-11-11T12:00:12Z');
  expect(updatedText(board([]), now)).toBe('Updated 12 s ago');
  expect(updatedText(board([], { at: '2026-11-11T11:55:00Z' }), now)).toBe('Updated 5 min ago');
  expect(updatedText(board([], { rate: { until: '2026-11-11T12:30:00Z' } }), now)).toMatch(/^Paused until /);
  expect(updatedText(board([], { at: null, error: 'GitHub unavailable' }), now)).toBe('GitHub unavailable');
});

// @req FR:pr-page/live.event @req FR:pr-page/icon.absent
describe('store: no automatic reload', () => {
  it('loads once; no reload on events, timers, or show; Refresh asks the host to poll', async () => {
    vi.useFakeTimers();
    try {
      const calls: boolean[] = [];
      const s = createPrStore(async (fresh) => { calls.push(fresh); return board([]); }, { visible: () => true });
      const off1 = s.subscribe(() => undefined); const off2 = s.subscribe(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.get().phase).toBe('ready');
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual([false]);
      await s.reload(true);
      expect(calls).toEqual([false, true]);
      off1(); off2();
    } finally { vi.useRealTimers(); }
  });
  it('a 404 turns it off; two reloads that wait on the gate load once', async () => {
    const gone = createPrStore(async () => { throw Object.assign(new Error('nf'), { status: 404 }); });
    gone.subscribe(() => undefined);
    await vi.waitFor(() => expect(gone.get().phase).toBe('off'));
    let n = 0;
    let open: (v: boolean) => void = () => undefined;
    const gate = new Promise<boolean>((r) => { open = r; });
    const s = createPrStore(async () => { n++; await new Promise((r) => setTimeout(r, 5)); return board([]); }, { enabled: () => gate });
    s.subscribe(() => undefined);
    const a = s.reload(); const b = s.reload();
    open(true);
    await Promise.all([a, b]);
    await vi.waitFor(() => expect(s.get().phase).toBe('ready'));
    expect(n).toBe(1);
  });
});

// @req FR:pr-page/auth.state @req FR:pr-page/nav.load
describe('signed out and loading', () => {
  it('a signed-out answer is phase signin with the method, never a zero board', async () => {
    const s = createPrStore(async () => ({ auth: { state: 'signed-out', method: 'gh' } }) as never);
    expect(s.get().phase).toBe('loading');
    s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('signin'));
    expect(s.get().board).toBeNull();
  });
  it('a failed first load is the failed state, never a zero board', async () => {
    const s = createPrStore(async () => board([], { at: null, error: 'GitHub unavailable' }));
    s.subscribe(() => undefined);
    await vi.waitFor(() => expect(s.get().phase).toBe('error'));
  });
  it('signed out, it checks again each 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const s = createPrStore(async () => { n++; return ({ auth: { state: 'signed-out', method: 'gh' } }) as never; }, { visible: () => true });
      const off = s.subscribe(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(n).toBe(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(n).toBe(2);
      off();
    } finally { vi.useRealTimers(); }
  });
  it('the sign-in words', () => {
    expect(signInText({ state: 'signed-out', method: 'gh' })).toEqual({ title: 'Sign in to GitHub to see your PRs.', action: 'Sign in to GitHub' });
    expect(signInText({ state: 'signed-out', method: 'gh', session: { state: 'error', error: 'expired' } }).note).toBe('The code expired. Try again.');
  });
});

// @req FR:pr-page/menu.@function
describe('actionsOf: quick actions that fit the PR', () => {
  const ids = (r: PrRow, b: PrBoard | null = board([r])) => actionsOf(r, b).map((a) => a.id);
  it('my Autopilot PR: Sweep next, Remove Autopilot, Open, Copy; never Ready, merge, or approve', () => {
    const r = row({ url: 'https://github.com/o/r/pull/7', number: 7 });
    expect(ids(r)).toEqual(['sweep', 'autopilot-off', 'pin', 'open', 'copy']);
    expect(actionsOf(r, board([r])).map((a) => a.label)).toEqual(['Sweep next', 'Remove Autopilot', 'Pin', 'Open on GitHub', 'Copy sweep command']);
    expect(actionsOf(r, board([r])).map((a) => a.label).join(' ')).not.toMatch(/ready|merge|approve|close|draft/i);
  });
  it('my PR with no Autopilot: Enable Autopilot; not on a draft or a paused PR', () => {
    expect(ids(row({ autopilot: false, group: 'pending' }))).toEqual(['sweep', 'autopilot-on', 'pin', 'open', 'copy']);
    expect(ids(row({ autopilot: false, group: 'pending', draft: true }))).toEqual(['sweep', 'pin', 'open', 'copy']);
    expect(ids(row({ autopilot: false, group: 'paused' }))).toEqual(['sweep', 'pin', 'open', 'copy']);
  });
  it('someone else\'s PR: no Autopilot change unless it is in Processing (assigned to me)', () => {
    expect(ids(row({ mine: false, author: 'roland', group: 'waiting', autopilot: false }))).toEqual(['sweep', 'pin', 'open', 'copy']);
    expect(ids(row({ mine: false, author: 'roland', group: 'waiting', autopilot: true }))).toEqual(['sweep', 'pin', 'open', 'copy']);
    expect(ids(row({ mine: false, author: 'roland', group: 'processing', autopilot: true }))).toEqual(['sweep', 'autopilot-off', 'pin', 'open', 'copy']);
  });
  it('Sweep next: add when not queued, top when queued; hidden when first in its part or with no queue', () => {
    const a = row({ url: 'a', rank: 1, pinned: true });
    const b2 = row({ url: 'b', rank: 2, pinned: false });
    const c = row({ url: 'c', rank: 3, pinned: false });
    const d = row({ url: 'd', rank: null });
    const b = board([a, b2, c, d]);
    expect(ids(a, b)).not.toContain('sweep');
    expect(ids(b2, b)).not.toContain('sweep');
    expect(actionsOf(c, b).find((x) => x.id === 'sweep')?.op).toBe('top');
    expect(actionsOf(d, b).find((x) => x.id === 'sweep')?.op).toBe('add');
    expect(ids(row({ rank: 2, pinned: true }), board([row({ rank: 1, pinned: true }), row({ rank: 2, pinned: true })]))).toContain('sweep');
    expect(ids(d, board([d], { queue: false }))).not.toContain('sweep');
    expect(ids(d, null)).not.toContain('sweep');
  });
  it('Open links the PR; Copy holds the Catalyst sweep command for the role', () => {
    const r = row({ url: 'https://github.com/o/r/pull/7', number: 7 });
    expect(actionsOf(r, board([r])).find((a) => a.id === 'open')?.href).toBe('https://github.com/o/r/pull/7');
    expect(sweepCommand(r)).toBe('/catalyst:pr-sweep 7 update');
    expect(sweepCommand(row({ number: 9, mine: false }))).toBe('/catalyst:pr-sweep 9 review');
    expect(actionsOf(r, board([r])).find((a) => a.id === 'copy')?.text).toBe('/catalyst:pr-sweep 7 update');
    expect(actionsOf(r, board([r])).find((a) => a.id === 'autopilot-off')?.op).toBe('remove');
    expect(actionsOf(row({ autopilot: false }), null).find((a) => a.id === 'autopilot-on')?.op).toBe('add');
  });
});

// @req FR:pr-page/check.none @req FR:pr-page/nav.badge @req FR:pr-page/summary.live @req FR:pr-page/summary.missing
describe('a Validate row the owner cannot act on never shows as a task', () => {
  const check = { ask: 'Check it', server: 'pnpm web', steps: ['Open it'], pass: [], fail: [] };
  const off = board([], { servers: false });
  const on = board([], { servers: true });
  it('actionable: steps, a server, or a host that can start one', () => {
    expect(actionable(row({ nextAction: 'validate' }), off)).toBe(false);
    expect(actionable(row({ nextAction: 'validate', detail: { check: { ...check, steps: [] } } }), off)).toBe(false);
    expect(actionable(row({ nextAction: 'validate', detail: { check } }), off)).toBe(true);
    expect(actionable(row({ nextAction: 'validate', server: { state: 'running', url: 'http://localhost:5180', at: '' } }), off)).toBe(true);
    expect(actionable(row({ nextAction: 'validate' }), on)).toBe(true);
    expect(actionable(row({ nextAction: 'signoff' }), off)).toBe(true);
    expect(actionable(row({}), on)).toBe(false);
  });
  it('no flag, no badge count, and never the words Not actionable', () => {
    expect(flagText(row({ nextAction: 'validate' }), off)).toBe('');
    expect(flagText(row({ nextAction: 'validate' }), on)).toBe('Validate');
    expect(flagText(row({ nextAction: 'validate', detail: { check } }), off)).toBe('Validate');
    expect(flagText(row({ nextAction: 'signoff' }), off)).toBe('Sign off');
    expect(flagText(row({}), on)).toBe('');
    expect(toneOf(row({ nextAction: 'validate' }), off)).toBe('auto');
    expect(toneOf(row({ nextAction: 'validate' }), on)).toBe('auto strong');
    const rows = [row({ url: 'a', nextAction: 'validate' }), row({ url: 'b', nextAction: 'validate', detail: { check } }), row({ url: 'c', nextAction: 'approve' })];
    expect(needCount(board(rows, { servers: false }))).toBe(2);
    expect(needCount(board(rows, { servers: true }))).toBe(3);
  });
  it('the Summary lists only actionable rows', () => {
    const rows = [row({ url: 'a', nextAction: 'validate' }), row({ url: 'c', nextAction: 'approve' })];
    const summary = { live: ['a'], signoff: [], autopilot: [], missing: [{ url: 'a', reason: 'Validate' }, { url: 'c', reason: 'Approve' }, { url: 'a', reason: 'Live check failed: Login' }] };
    const no = summaryView(board(rows, { servers: false, summary }), []);
    expect(no.live).toEqual([]);
    expect(no.missing.map((m) => m.reason)).toEqual(['Approve']);
    expect(countOf(board(rows, { servers: false, summary }), 'summary', [])).toBe(1);
    const yes = summaryView(board(rows, { servers: true, summary }), []);
    expect(yes.live.map((r) => r.url)).toEqual(['a']);
    expect(yes.missing).toHaveLength(3);
  });
});

// @req FR:pr-page/menu.@function @req FR:pr-page/pin.toggle @req FR:pr-page/server.pane
describe('actionsOf: Pin and the test server', () => {
  const find = (r: PrRow, b: PrBoard) => actionsOf(r, b).map((a) => a.id);
  it('Pin or Unpin sits before Open, only with a queue', () => {
    const r = row({ url: 'a', rank: 1 });
    expect(find(r, board([r]))).toEqual(['autopilot-off', 'pin', 'open', 'copy']);
    expect(actionsOf(r, board([r])).find((a) => a.id === 'pin')).toMatchObject({ label: 'Pin', op: 'pin' });
    const p = row({ url: 'a', rank: 1, pinned: true });
    expect(actionsOf(p, board([p])).find((a) => a.id === 'unpin')).toMatchObject({ label: 'Unpin', op: 'unpin' });
    expect(find(r, board([r], { queue: false }))).toEqual(['autopilot-off', 'open', 'copy']);
  });
  it('Start server with no server or a failed one; Stop while it starts or runs; Open when it runs', () => {
    const b = (r: PrRow, servers = true) => board([r], { queue: false, servers });
    const none = row({});
    expect(find(none, b(none))).toEqual(['autopilot-off', 'server-start', 'open', 'copy']);
    expect(find(none, b(none, false))).toEqual(['autopilot-off', 'open', 'copy']);
    const starting = row({ server: { state: 'starting', step: 'build', at: '' } });
    expect(find(starting, b(starting))).toEqual(['autopilot-off', 'server-stop', 'open', 'copy']);
    const running = row({ server: { state: 'running', url: 'http://localhost:5180', at: '' } });
    expect(find(running, b(running))).toEqual(['autopilot-off', 'server-open', 'server-stop', 'open', 'copy']);
    expect(actionsOf(running, b(running)).find((a) => a.id === 'server-open')).toMatchObject({ label: 'Open test server', href: 'http://localhost:5180' });
    const failed = row({ server: { state: 'failed', error: 'Build failed', at: '' } });
    expect(find(failed, b(failed))).toEqual(['autopilot-off', 'server-start', 'open', 'copy']);
    expect(actionsOf(none, b(none)).map((a) => a.label)).toContain('Start server');
    expect(actionsOf(running, b(running)).map((a) => a.label)).toContain('Stop server');
  });
  it('a server URL that is not local is never a link', () => {
    const r = row({ server: { state: 'running', url: 'https://evil.example/x', at: '' } });
    expect(find(r, board([r], { queue: false, servers: true }))).not.toContain('server-open');
    expect(serverHref(r)).toBeNull();
    expect(serverHref(row({ server: { state: 'running', url: 'http://localhost:5180', at: '' } }))).toBe('http://localhost:5180');
  });
});

// @req FR:pr-page/server.poll @req FR:pr-page/live.event
describe('the board reloads only while a test server starts', () => {
  it('starting: true while a row has a starting server', () => {
    expect(starting(board([row({ server: { state: 'starting', at: '' } })]))).toBe(true);
    expect(starting(board([row({ server: { state: 'running', at: '' } }), row({})]))).toBe(false);
    expect(starting(null)).toBe(false);
  });
});
