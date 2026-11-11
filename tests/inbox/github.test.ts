import notes from '../fixtures/github/notifications.json';
import { readInbox, writeInbox } from '../../src/inbox';
import { createGhGuard, githubConnector, githubItems, githubSignal, type GhNotification, type GhRun } from '../../src/inbox/connectors/github';
import { runGithub } from '../../src/inbox/connectors/github-runner';
import { mkCtx } from '../email/fixtures';

const fx = notes as GhNotification[];
const byKind = (k: string) => githubItems(fx, 'octo').find((i) => i.kind === k)!;

// @req FR:connector-github/sig.map @req FR:connector-github/sig.kind
describe('githubSignal', () => {
  it('maps reasons to signals', () => {
    const got = fx.map((n) => [n.id, githubSignal(n)]);
    expect(got).toEqual([
      ['1001', { signal: 'approval', kind: 'review_requested' }], ['1002', { signal: 'mention', kind: 'mention' }], ['1003', { signal: 'mention', kind: 'team_mention' }],
      ['1004', { signal: 'reply', kind: 'assign' }], ['1005', { signal: 'reply', kind: 'ci_failed' }], ['1006', { signal: 'fyi', kind: 'ci_activity' }],
      ['1007', { signal: 'fyi', kind: 'subscribed' }], ['1008', { signal: 'mention', kind: 'mention' }],
    ]);
  });
});

// @req FR:connector-github/item.shape @req FR:connector-github/sig.rank @req FR:connector-github/sig.action
describe('githubItems', () => {
  it('maps unread threads only, with stable gh ids', () => {
    const items = githubItems(fx, 'octo');
    expect(items).toHaveLength(7);
    expect(items.every((i) => /^gh-[0-9a-f]{12}$/.test(i.id) && i.source === 'github' && i.account === 'octo' && i.unread)).toBe(true);
    expect(githubItems(fx, 'octo')[0].id).toBe(items[0].id);
  });
  it('sets urgency and suggested action by signal', () => {
    expect(byKind('review_requested')).toMatchObject({ signal: 'approval', urgency: 2, suggested: 'ask-me-later', from: 'example/app', subject: 'Add GitHub connector', receivedAt: '2026-11-09T10:00:00Z' });
    expect(byKind('mention')).toMatchObject({ urgency: 1, suggested: 'ask-me-later' });
    expect(byKind('assign')).toMatchObject({ signal: 'reply', urgency: 1, suggested: 'create-task' });
    expect(byKind('ci_failed')).toMatchObject({ signal: 'reply', urgency: 2, suggested: 'create-task' });
    expect(byKind('subscribed')).toMatchObject({ signal: 'fyi', urgency: 0, suggested: 'mark-done' });
  });
});

// @req FR:connector-github/item.link @req FR:connector-github/item.safe
describe('links and safety', () => {
  it('maps API URLs to web URLs', () => {
    expect(byKind('review_requested').link).toBe('https://github.com/example/app/pull/12');
    expect(byKind('mention').link).toBe('https://github.com/example/app/issues/7');
    expect(byKind('ci_failed').link).toBe('https://github.com/example/app/actions');
    expect(byKind('subscribed').link).toBe('https://github.com/example/app');
  });
  it('drops non-GitHub links and neutralizes markup', () => {
    const evil: GhNotification = { ...fx[0], id: '9', repository: { full_name: 'x/y', html_url: 'https://evil.example.test/x/y' }, subject: { title: 'a'.repeat(500), url: null, type: 'Issue' } };
    const [i] = githubItems([evil], 'octo');
    expect(i.link).toBeUndefined();
    expect(i.subject.length).toBeLessThanOrEqual(300);
    expect(byKind('mention').subject).not.toMatch(/[<>]/);
  });
});

// @req FR:connector-github/conn.guard
describe('createGhGuard', () => {
  const g = createGhGuard();
  it('allows GET notifications only', () => {
    expect(() => g.check(['api', '--method', 'GET', 'notifications?per_page=50&page=1'])).not.toThrow();
    for (const bad of [
      ['api', '--method', 'PATCH', 'notifications/threads/1'], ['api', '--method', 'PUT', 'notifications'], ['api', 'notifications'],
      ['api', '--method', 'GET', 'repos/o/r/issues/1/comments'], ['api', '--method', 'GET', 'notifications', '-f', 'body=x'],
      ['api', '--method', 'GET', 'notifications', '--input', 'x'], ['pr', 'comment', '1'], ['api', '--method', 'GET', '/notifications/../repos'],
    ]) expect(() => g.check(bad)).toThrow(/denied/);
  });
});

// @req FR:connector-github/conn.read @req FR:connector-github/conn.error
describe('githubConnector', () => {
  it('pages until a short page, every call guarded and GET', async () => {
    const calls: string[][] = [];
    const page = Array.from({ length: 50 }, (_, i) => ({ ...fx[0], id: `p${i}` }));
    const run: GhRun = async (args) => { calls.push(args); return JSON.stringify(calls.length === 1 ? page : fx.slice(0, 2)); };
    const items = await githubConnector({ account: 'octo', run }).unread();
    expect(items).toHaveLength(52);
    expect(calls.map((c) => c[3])).toEqual(['notifications?per_page=50&page=1', 'notifications?per_page=50&page=2']);
    expect(calls.every((c) => c[0] === 'api' && c[1] === '--method' && c[2] === 'GET')).toBe(true);
  });
  it('stops at 5 pages', async () => {
    let n = 0;
    const page = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ ...fx[0], id: `p${i}` })));
    await githubConnector({ run: async () => { n++; return page; } }).unread();
    expect(n).toBe(5);
  });
  it('errors carry no output', async () => {
    const run: GhRun = async () => { throw new Error('ghp_secrettoken123 bad'); };
    await expect(githubConnector({ run }).unread()).rejects.toThrow(/^GitHub request failed$/);
    await expect(githubConnector({ run: async () => 'not json' }).unread()).rejects.toThrow(/^GitHub request failed$/);
  });
});

// @req FR:connector-github/run.store @req FR:connector-github/run.ask @req FR:connector-github/run.fail
describe('runGithub', () => {
  const conn = (items = githubItems(fx, 'octo')) => ({ unread: async () => items });
  it('writes github items, keeps others, and asks for non-fyi only', async () => {
    const { ctx, storage } = mkCtx();
    await writeInbox(storage, [{ id: 'chat-aaaaaaaaaaaa', source: 'slack', account: 'w', from: 'S', subject: 'Hi', receivedAt: '2026-11-01T00:00:00Z', unread: true, summary: 's', suggested: 'ask-me-later', actions: [] }]);
    expect(await runGithub(ctx, { connector: conn() })).toEqual({ items: 7, failed: false });
    const stored = await readInbox(storage);
    expect(stored.filter((i) => i.source === 'github')).toHaveLength(7);
    expect(stored.filter((i) => i.source === 'slack')).toHaveLength(1);
    expect(stored.find((i) => i.kind === 'ci_failed')?.link).toBe('https://github.com/example/app/actions');
    const asks = await storage.listAsks();
    expect(asks).toHaveLength(5);
    await runGithub(ctx, { connector: conn(githubItems(fx.slice(0, 1), 'octo')) });
    expect((await readInbox(storage)).filter((i) => i.source === 'github')).toHaveLength(1);
  });
  it('a failed connector keeps stored items', async () => {
    const { ctx, storage } = mkCtx();
    await runGithub(ctx, { connector: conn() });
    const r = await runGithub(ctx, { connector: { unread: async () => { throw new Error('ghp_x'); } } });
    expect(r).toEqual({ items: 0, failed: true });
    expect((await readInbox(storage)).filter((i) => i.source === 'github')).toHaveLength(7);
  });
});
