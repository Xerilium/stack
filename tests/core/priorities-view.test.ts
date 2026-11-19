import { parsePris, PrisInvalid, type Pri } from '../../src/core/pris';
import { prioritiesView, type BoardInput, type ViewInput } from '../../src/core/priorities-view';
import type { TieredTask } from '../../src/core/tiered-tasks';

const TZ = 'America/Los_Angeles';
/** Wed 2026-11-18 11:00 in Los Angeles. */
const WED_11 = new Date('2026-11-18T19:00:00Z');
const AT = WED_11.toISOString();
const pri = (id: string, o: Partial<Pri> = {}): Pri => ({ id, title: id.toUpperCase(), status: 'active', items: [], backlog: [], weekly: [], projects: [id], ...o });
let n = 0;
const task = (project: string, tier: 1 | 2 | 3, text: string, o: Partial<TieredTask> = {}): TieredTask => ({
  path: `tasks/${project}.md`, line: n++, project, aliases: [], tier, text, agent: null, more: 0, status: null, ...o,
});
const view = (pris: Pri[], tasks: TieredTask[] = [], o: Partial<ViewInput> = {}) => prioritiesView({ pris, tasks, now: WED_11, timeZone: TZ, board: { at: AT, rows: [] }, ...o });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const prow = (num: number, nextAction: BoardInput['rows'][number]['nextAction'], o: Partial<BoardInput['rows'][number]> = {}): BoardInput['rows'][number] => ({
  url: `https://github.com/o/r/pull/${num}`, repo: 'o/r', number: num, title: `PR ${num}`, project: 'other', nextAction, ...o,
});
const GAP = 'No tiered task in tasks/';

describe('pris.json fields', () => {
  // @req FR:priorities-tables/$window
  it('keeps label, action, session, windows and perProject', () => {
    const [p] = parsePris([{ id: 'qm', title: 'QM', status: 'active', label: 'QM', action: 'work with QM CoS', session: 'local_abc-1', perProject: true, windows: [{ days: ['wed'], from: '15:00' }, { days: ['thu', 'fri'] }] }]);
    expect(p).toMatchObject({ label: 'QM', action: 'work with QM CoS', session: 'local_abc-1', perProject: true, windows: [{ days: ['wed'], from: '15:00' }, { days: ['thu', 'fri'] }] });
  });
  // @req FR:priorities-tables/$window
  it('rejects a bad window, label, session or perProject', () => {
    const bad = (x: Record<string, unknown>) => () => parsePris([{ id: 'a', title: 'A', status: 'active', ...x }]);
    expect(bad({ windows: [{ from: '25:00' }] })).toThrow(PrisInvalid);
    expect(bad({ windows: [{ days: ['xyz'] }] })).toThrow(PrisInvalid);
    expect(bad({ windows: [{ from: '13:00', to: '12:00' }] })).toThrow(PrisInvalid);
    expect(bad({ windows: Array(8).fill({}) })).toThrow(PrisInvalid);
    expect(bad({ label: 'x'.repeat(41) })).toThrow(PrisInvalid);
    expect(bad({ session: 'bad id!' })).toThrow(PrisInvalid);
    expect(bad({ action: 'x'.repeat(201) })).toThrow(PrisInvalid);
    expect(bad({ perProject: 'yes' })).toThrow(PrisInvalid);
  });
});

describe('project rows', () => {
  // @req FR:priorities-tables/rows.@function @req FR:priorities-tables/rows.input @req FR:priorities-tables/rows.status @req FR:priorities-tables/$view @req FR:priorities-tables/$row
  it('gives one row per active or blocked priority', () => {
    const v = view([pri('a'), pri('b', { status: 'paused' }), pri('c', { status: 'blocked' }), pri('d', { status: 'done' })]);
    expect(v.at).toBe(AT);
    expect(v.qm).toBeNull();
    expect(ids(v.now.rows)).toEqual(['a', 'c']);
    expect(v.today.rows).toEqual([]);
  });
  // @req FR:priorities-tables/rows.link @req FR:priorities-tables/rows.pick @req FR:priorities-tables/rows.cols
  it('links tasks to priorities and shows the lowest tier, then file order', () => {
    const tasks = [
      task('ftk', 2, 'Week one'), task('ftk', 1, 'Today one', { agent: 'ftk-rm', status: 'working' }), task('ftk', 1, 'Today two'),
      task('other', 1, 'Not a priority'),
    ];
    const [r] = view([pri('ftk', { label: 'FTK 16' })], tasks).now.rows;
    expect(r).toEqual({ id: 'ftk', project: 'FTK 16', agent: { name: 'ftk-rm', link: null }, status: 'working', action: 'Today one', gap: false, ref: `tasks/ftk.md:${tasks[1].line}`, at: AT, stale: false });
  });
  // @req FR:priorities-tables/rows.project
  it('names the project by label, else the title before the first (', () => {
    const v = view([pri('m', { title: 'Ad hoc money tasks (unemployment)' }), pri('p', { title: 'FH Premium (+ AM)', label: 'FH.com' })]);
    expect(v.now.rows.map((r) => r.project)).toEqual(['Ad hoc money tasks', 'FH.com']);
  });
  // @req FR:priorities-tables/rows.cols.action @req FR:priorities-tables/rows.cols.later @req FR:priorities-tables/rows.cols.more
  it('uses the fixed action, marks later tiers and counts more agents', () => {
    const tasks = [task('focus', 1, 'Publish 2826', { agent: 'focus-cos', more: 2, status: 'pairing' }), task('fh', 2, 'Review spec', { agent: 'fh-pm', more: 1 }), task('f4', 3, 'Plan')];
    const v = view([pri('focus', { action: 'work with FOCUS CoS' }), pri('fh'), pri('f4')], tasks);
    expect(v.now.rows.map((r) => [r.action, r.status])).toEqual([['work with FOCUS CoS + 2 more', 'pairing'], ['⏳ Review spec + 1 more', null], ['⏳ Plan', null]]);
  });
  // @req FR:priorities-tables/rows.gap
  it('shows an explicit gap for a priority with no tiered task, never filler', () => {
    const [r] = view([pri('arc', { items: [{ text: 'old item', status: 'todo' }], weekly: [{ week: '2026-W47', text: 'Michael: old note' }] })]).now.rows;
    expect(r).toMatchObject({ id: 'arc', agent: null, status: null, action: GAP, gap: true, ref: null });
  });
  // @req FR:priorities-tables/rows.words
  it('cuts a cell to 20 words', () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
    const [r] = view([pri('a', { title: long })], [task('a', 1, long)]).now.rows;
    expect(r.action.split(' ')).toHaveLength(20);
    expect(r.action.endsWith('…')).toBe(true);
  });
});

describe('QM', () => {
  const qm = (o: Partial<Pri> = {}) => pri('qm', { title: 'QM', perProject: true, projects: [], keywords: ['QM'], days: { wed: 0, tue: 4, mon: 5, thu: 'off', fri: 'off', sat: 'off', sun: 'off' }, ...o });
  const tasks = () => [
    task('stack', 1, 'QM 3pm final calls on plan PR 119', { agent: 'qm-planner' }), task('stack', 1, 'Ship v2'),
    task('catalyst', 1, 'Approve the QM 5'), task('catalyst', 2, 'QM later one'),
  ];
  // @req FR:priorities-tables/qm.pri @req FR:priorities-tables/qm.link @req FR:priorities-tables/qm.rows
  it('gets its own first section, one row per project, linked before the other priorities', () => {
    const v = view([pri('stack'), qm(), pri('catalyst')], tasks());
    expect(v.qm?.title).toBe('QM');
    expect(v.qm?.rows.map((r) => [r.project, r.action, r.agent?.name ?? null])).toEqual([['catalyst', 'Approve the QM 5', null], ['stack', 'QM 3pm final calls on plan PR 119', 'qm-planner']]);
    expect(v.now.rows.map((r) => [r.id, r.action])).toEqual([['stack', 'Ship v2'], ['catalyst', GAP]]);
  });
  // @req FR:priorities-tables/qm.off
  it('says Not a priority today on an off day', () => {
    const thu = new Date('2026-11-19T19:00:00Z');
    const v = view([qm(), pri('stack')], tasks(), { now: thu });
    expect(v.qm?.rows).toMatchObject([{ id: 'qm', project: 'QM', action: 'Not a priority today', gap: true }]);
  });
  // @req FR:priorities-tables/qm.later
  it('starts each action with the start time when it opens later today', () => {
    const v = view([qm({ windows: [{ days: ['wed'], from: '15:00' }] })], tasks());
    expect(v.qm?.rows.map((r) => r.action)).toEqual(['3 PM: Approve the QM 5', '3 PM: QM 3pm final calls on plan PR 119']);
  });
});

describe('order', () => {
  // @req FR:priorities-tables/order.day @req FR:priorities-tables/order.now @req FR:priorities-tables/order.today
  it('follows the day order: the first 3 in Now, the rest in Today', () => {
    const v = view([pri('a'), pri('b', { days: { wed: 0 } }), pri('c'), pri('d', { days: { wed: 'off' } }), pri('e')]);
    expect(ids(v.now.rows)).toEqual(['b', 'a', 'c']);
    expect(ids(v.today.rows)).toEqual(['e']);
  });
  // @req FR:priorities-tables/order.window @req FR:priorities-tables/order.window.day @req FR:priorities-tables/order.window.edge @req FR:priorities-tables/order.today.later @req FR:priorities-tables/order.today.past
  it('keeps a windowed priority out of Now until its window opens', () => {
    const pris = [
      pri('printer', { windows: [{ from: '12:00', to: '13:00' }] }),
      pri('early', { windows: [{ to: '09:00' }] }),
      pri('a'),
    ];
    const tasks = [task('printer', 1, 'print')];
    const at11 = view(pris, tasks);
    expect(ids(at11.now.rows)).toEqual(['a']);
    expect(at11.today.rows.map((r) => [r.id, r.action])).toEqual([['printer', '12 PM: print']]);
    expect(ids(view(pris, tasks, { now: new Date('2026-11-18T20:00:00Z') }).now.rows)).toEqual(['printer', 'a']);
    expect(ids(view(pris, tasks, { now: new Date('2026-11-18T21:00:00Z') }).now.rows)).toEqual(['a']);
  });
  // @req FR:priorities-tables/order.next @req FR:priorities-tables/order.next.when @req FR:priorities-tables/order.next.sort
  it('lists the priorities of the next 3 days that are not today, once, by first day', () => {
    const pris = [
      pri('a'),
      pri('fri', { days: { mon: 'off', tue: 'off', wed: 'off', thu: 'off', sat: 'off', sun: 'off' } }),
      pri('thu', { windows: [{ days: ['thu', 'fri'], from: '15:30' }] }),
      pri('mon', { windows: [{ days: ['mon'] }] }),
    ];
    const v = view(pris, [task('fri', 1, 'ship'), task('thu', 2, 'plan')]);
    expect(v.next.rows.map((r) => [r.id, r.action])).toEqual([['thu', 'Thu 3:30 PM: ⏳ plan'], ['fri', 'Fri: ship']]);
  });
});

describe('agent', () => {
  const inv = { at: AT, sessions: [{ id: 's1', title: '👓 FOCUS CoS', link: 'claude://claude.ai/epitaxy/s1' }, { id: 's2', title: 'FH backend', link: 'claude://claude.ai/epitaxy/s2' }] };
  // @req FR:priorities-tables/agent.link @req FR:priorities-tables/agent.plain
  it('links the session whose title matches the agent, else the priority session, else plain', () => {
    const tasks = [task('focus', 1, 'x', { agent: 'focus-cos' }), task('fh', 1, 'y', { agent: 'someone' }), task('ftk', 1, 'z', { agent: 'ftk-rm' })];
    const v = view([pri('focus'), pri('fh', { session: 's2' }), pri('ftk')], tasks, { sessions: inv });
    expect(v.now.rows.map((r) => r.agent)).toEqual([
      { name: 'focus-cos', link: 'claude://claude.ai/epitaxy/s1' }, { name: 'someone', link: 'claude://claude.ai/epitaxy/s2' }, { name: 'ftk-rm', link: null },
    ]);
  });
});

describe('PRs', () => {
  const board = (rows: BoardInput['rows'], o: Partial<BoardInput> = {}): BoardInput => ({ at: AT, rows, ...o });
  // @req FR:priorities-tables/pr.live @req FR:priorities-tables/pr.cols @req FR:priorities-tables/pr.cols.action @req FR:priorities-tables/pr.cols.time @req FR:priorities-tables/pr.order @req FR:priorities-tables/$pr
  it('lists live PRs that need the owner, quickest first', () => {
    const rows = [
      prow(1, 'validate'), prow(2, null), prow(3, 'autopilot', { specLines: 45 }), prow(4, 'publish'), prow(5, 'signoff'), prow(6, 'approve'), prow(7, 'autopilot', { specLines: null }),
    ];
    const v = view([], [], { board: board(rows) });
    expect(v.prs.rows.map((r) => [r.number, r.action, r.minutes])).toEqual([
      [5, 'Thread: sign off', 5], [6, 'Approve', 5], [7, 'Autopilot: promote', 5], [3, 'Autopilot: promote', 7], [4, 'Publish review', 10], [1, 'Live: validate', 15],
    ]);
    expect(v.prs).toMatchObject({ at: AT, stale: false, verified: true });
  });
  // @req FR:priorities-tables/pr.cols.emoji @req FR:priorities-tables/pr.cols.agent
  it('shows the repo emoji and the agent of the linked priority', () => {
    const p = pri('fh', { refs: ['allytehq/finops-hubs'], session: 's2' });
    const rows = [prow(9, 'approve', { repo: 'allytehq/finops-hubs', url: 'https://github.com/allytehq/finops-hubs/pull/9' }), prow(8, 'approve', { repo: 'x/unknown' })];
    const v = view([p], [], { board: board(rows), sessions: { at: AT, sessions: [{ id: 's2', title: 'FH backend', link: 'claude://claude.ai/epitaxy/s2' }] } });
    expect(v.prs.rows.map((r) => [r.number, r.emoji, r.agent])).toEqual([[9, '🏦', { name: 'FH backend', link: 'claude://claude.ai/epitaxy/s2' }], [8, '', null]]);
  });
  // @req FR:priorities-tables/pr.live.none @req FR:priorities-tables/fresh.table
  it('lists no PRs without a good board poll; marks an old poll stale', () => {
    for (const b of [undefined, { at: null, rows: [prow(1, 'approve')] }]) expect(view([], [], { board: b }).prs).toMatchObject({ verified: false, stale: true, rows: [] });
    const old = new Date(WED_11.getTime() - 40 * 60_000).toISOString();
    expect(view([], [], { board: board([prow(1, 'approve')], { at: old }) }).prs).toMatchObject({ at: old, stale: true, verified: true });
  });
});

describe('freshness', () => {
  const min = (m: number) => new Date(WED_11.getTime() - m * 60_000).toISOString();
  // @req FR:priorities-tables/fresh.row @req FR:priorities-tables/fresh.table @req FR:priorities-tables/fresh.stale
  it('stamps each row and table with the oldest live check, stale after 30 minutes', () => {
    const sessions = { at: min(40), sessions: [{ id: 's1', title: 'S', link: 'claude://claude.ai/epitaxy/s1' }] };
    const v = view([pri('a', { session: 's1' }), pri('b')], [task('a', 1, 'x', { agent: 'S' })], { sessions });
    expect(v.now.rows.map((r) => [r.at, r.stale])).toEqual([[min(40), true], [AT, false]]);
    expect(v.now).toMatchObject({ at: min(40), stale: true });
    expect(v.today).toMatchObject({ at: AT, stale: false });
  });
});
