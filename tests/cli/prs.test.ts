import { run } from '../../src/cli/run';
import { filterBoard, formatBoard, prsCmd } from '../../src/cli/prs';
import type { PrBoard } from '../../src/api/pr-board-service';
import type { PrRow } from '../../src/core/pr-board';
import { getDefaults } from '../../src/core/config';

const SIGN_IN = 'GitHub sign-in needed: run gh auth login or set GITHUB_TOKEN';

const row = (o: Partial<PrRow>): PrRow => ({
  url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1, title: 'Fix it', author: 'me', project: 'other', group: 'blocked', draft: false, createdAt: '', updatedAt: '', ci: 'passing',
  unresolved: 0, labels: [], state: { owner: 'me', bucket: 'decide', blocker: 'Pick one', link: 'https://github.com/o/r/pull/1#discussion_r1', stalled: false, source: 'rule' },
  healthy: false, agent: false, after: [], rank: null, pinned: false, autopilot: true, ...o,
});
const board = (rows: PrRow[]): PrBoard => ({ at: '2026-11-11T12:00:00.000Z', user: 'me', agents: { count: 2, source: 'sessions' }, counts: { blocked: 1, waiting: 1, processing: 0, pending: 0, paused: 0 }, footer: { running: 2, waiting: 2, parked: 0 }, rows, queue: false });

// @req FR:pr-page/cli.prs
describe('stack prs', () => {
  const rows = [row({}), row({ number: 2, url: 'https://github.com/x/stack/pull/2', repo: 'x/stack', project: 'xerilium', group: 'waiting', state: { owner: 'reviewer', login: 'roland', blocker: 'Waiting on roland', link: 'https://github.com/x/stack/pull/2', stalled: false, source: 'rule' } })];
  it('filters by group and by project or repo', () => {
    expect(filterBoard(board(rows), 'waiting').map((r) => r.number)).toEqual([2]);
    expect(filterBoard(board(rows), undefined, 'xerilium').map((r) => r.number)).toEqual([2]);
    expect(filterBoard(board(rows), undefined, 'stack').map((r) => r.number)).toEqual([2]);
    expect(filterBoard(board(rows), undefined, 'o/r').map((r) => r.number)).toEqual([1]);
    expect(() => filterBoard(board(rows), 'nope')).toThrow('--group must be one of');
  });
  it('prints counts, then one line per row with owner, blocker, and link', () => {
    expect(formatBoard(board(rows), rows).split('\n')).toEqual([
      'prs: blocked 1, waiting 1, processing 0, pending 0, paused 0; agents 2 (sessions); updated 2026-11-11T12:00:00.000Z',
      'blocked [other] o/r#1 Fix it · you: Pick one https://github.com/o/r/pull/1#discussion_r1',
      'waiting [xerilium] x/stack#2 Fix it · roland: Waiting on roland https://github.com/x/stack/pull/2',
    ]);
  });
  // @req FR:pr-page/auth.token
  it('no token exits 1 and says how to sign in; never asks GitHub', async () => {
    const r = await prsCmd({}, [], getDefaults, '/nonexistent', {}, async () => null);
    expect(r).toEqual({ json: { ok: false, error: SIGN_IN }, text: `error: ${SIGN_IN}`, code: 1 });
    await expect(prsCmd({}, ['extra'], getDefaults, '/x', {}, async () => null)).rejects.toThrow('Unexpected argument');
  });
  it('is a registered command with its flags', async () => {
    const out: string[] = [];
    const prev = process.env.GITHUB_TOKEN;
    const off = process.env.STACK_GH_AUTH;
    delete process.env.GITHUB_TOKEN;
    process.env.STACK_GH_AUTH = 'off';
    try {
      expect(await run(['prs', '--group', 'blocked', '--json'], { out: (s) => out.push(s), err: () => undefined })).toBe(1);
      expect(JSON.parse(out.join(''))).toEqual({ ok: false, error: SIGN_IN });
      expect(await run(['prs', '--bogus'], { out: () => undefined, err: () => undefined })).toBe(2);
    } finally { if (prev !== undefined) process.env.GITHUB_TOKEN = prev; if (off === undefined) delete process.env.STACK_GH_AUTH; else process.env.STACK_GH_AUTH = off; }
  });
});
