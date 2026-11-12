import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseFacts, parsePrRef, PrPriConflict, PrPriInvalid, PrPriNotFound, PrPriorityStore, repoProject, similarReason,
} from '../../src/core/pr-priority';

let clock = Date.parse('2026-11-11T18:00:00Z');
const now = () => new Date(clock);
const home = () => mkdtempSync(join(tmpdir(), 'stack-home-'));
const mk = (dir = home()) => new PrPriorityStore(dir, { now });
const order = (s: PrPriorityStore) => s.read().items.map((i) => `${i.rank}:${i.number}${i.pinned ? 'p' : ''}`);
const U = (n: number, repo = 'o/r') => `https://github.com/${repo}/pull/${n}`;
beforeEach(() => { clock = Date.parse('2026-11-11T18:00:00Z'); });

describe('refs', () => {
  // @req FR:pr-priority/queue.ref
  it('parses owner/name#n and PR urls; rejects anything else', () => {
    expect(parsePrRef('Xerilium/stack#12')).toEqual({ repo: 'Xerilium/stack', number: 12 });
    expect(parsePrRef('https://github.com/o/r.js/pull/7/files')).toEqual({ repo: 'o/r.js', number: 7 });
    for (const bad of ['o/r', '#1', 'o/r#0', 'o/r#x', 'http://github.com/o/r/pull/1', 'https://gitlab.com/o/r/pull/1', 'o r#1']) expect(() => parsePrRef(bad)).toThrow(PrPriInvalid);
  });
  // @req FR:pr-priority/rec.order
  it('maps repos to projects', () => {
    expect(['allytehq/web', 'o/finops-hubs', 'microsoft/finops-toolkit', 'FinOps-Open-Cost-and-Usage-Spec/FOCUS_Spec', 'x/f4-music', 'Xerilium/anything', 'o/catalyst', 'o/zzz'].map(repoProject))
      .toEqual(['allyte', 'allyte', 'ftk', 'focus', 'f4', 'xerilium', 'xerilium', 'other']);
  });
});

describe('queue', () => {
  // @req FR:pr-priority/queue.model @req FR:pr-priority/queue.add @req FR:pr-priority/queue.write @req FR:pr-priority/$item
  it('adds at the top by default, at a rank, or last; writes atomically with rev', async () => {
    const dir = home(); const s = mk(dir);
    expect(s.read()).toEqual({ version: 1, rev: 0, items: [] });
    await s.edit({ op: 'add', ref: 'o/r#1' });
    await s.edit({ op: 'add', ref: U(2) });
    expect(order(s)).toEqual(['1:2', '2:1']);
    await s.edit({ op: 'add', ref: 'o/r#3', rank: 99, note: 'last one' });
    await s.edit({ op: 'add', ref: 'o/r#4', rank: 2 });
    expect(order(s)).toEqual(['1:2', '2:4', '3:1', '4:3']);
    const f = s.read();
    expect(f.rev).toBe(4);
    expect(f.items[3]).toEqual({ rank: 4, repo: 'o/r', number: 3, url: U(3), pinned: false, note: 'last one', by: 'owner', at: now().toISOString() });
    expect(statSync(join(dir, 'pr-priority.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp') || n.endsWith('.lock'))).toEqual([]);
    await expect(s.edit({ op: 'add', ref: 'o/r#5' }, { rev: 1 })).rejects.toThrow(PrPriConflict);
    expect(s.read().rev).toBe(4);
  });

  // @req FR:pr-priority/queue.idem @req FR:pr-priority/queue.add
  it('is idempotent: re-add, re-move, re-remove change nothing and write nothing', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' }); await s.edit({ op: 'add', ref: 'o/r#2' });
    expect(await s.edit({ op: 'add', ref: 'O/R#1' })).toMatchObject({ changed: false });
    expect(await s.edit({ op: 'move', ref: 'o/r#2', to: 'top' })).toMatchObject({ changed: false });
    expect(await s.edit({ op: 'remove', ref: 'o/r#9' })).toMatchObject({ changed: false });
    expect(s.read().rev).toBe(2);
    // Re-add with a rank moves it.
    const r = await s.edit({ op: 'add', ref: 'o/r#1', rank: 1 });
    expect(r.changed).toBe(true);
    expect(r.queue.items.map((i) => i.number)).toEqual([1, 2]);
  });

  // @req FR:pr-priority/queue.move
  it('moves top, up, down, and to a clamped rank; unknown PR is not found', async () => {
    const s = mk();
    for (const n of [4, 3, 2, 1]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    await s.edit({ op: 'move', ref: 'o/r#4', to: 'top' }); expect(order(s)).toEqual(['1:4', '2:1', '3:2', '4:3']);
    await s.edit({ op: 'move', ref: 'o/r#2', to: 'up' }); expect(order(s)).toEqual(['1:4', '2:2', '3:1', '4:3']);
    await s.edit({ op: 'move', ref: 'o/r#4', to: 'down', note: 'later' }); expect(order(s)).toEqual(['1:2', '2:4', '3:1', '4:3']);
    await s.edit({ op: 'move', ref: 'o/r#2', to: 50 }); expect(order(s)).toEqual(['1:4', '2:1', '3:3', '4:2']);
    expect(s.read().items[0].note).toBe('later');
    await expect(s.edit({ op: 'move', ref: 'o/r#9', to: 1 })).rejects.toThrow(PrPriNotFound);
  });

  // @req FR:pr-priority/queue.pin
  it('pins first; unpinned items never pass pinned ones', async () => {
    const s = mk();
    for (const n of [3, 2, 1]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    await s.edit({ op: 'pin', ref: 'o/r#3' }); expect(order(s)).toEqual(['1:3p', '2:1', '3:2']);
    expect((await s.edit({ op: 'pin', ref: 'o/r#3' })).changed).toBe(false);
    await s.edit({ op: 'move', ref: 'o/r#2', to: 'top' }); expect(order(s)).toEqual(['1:3p', '2:2', '3:1']);
    await s.edit({ op: 'move', ref: 'o/r#1', to: 1 }); expect(order(s)).toEqual(['1:3p', '2:1', '3:2']);
    await s.edit({ op: 'add', ref: 'o/r#5' }); expect(order(s)).toEqual(['1:3p', '2:5', '3:1', '4:2']);
    await s.edit({ op: 'pin', ref: 'o/r#2' }); expect(order(s)).toEqual(['1:3p', '2:2p', '3:5', '4:1']);
    await s.edit({ op: 'move', ref: 'o/r#3', to: 'down' }); expect(order(s)).toEqual(['1:2p', '2:3p', '3:5', '4:1']);
    await s.edit({ op: 'move', ref: 'o/r#3', to: 'down' }); expect(order(s)).toEqual(['1:2p', '2:3p', '3:5', '4:1']);
    await s.edit({ op: 'unpin', ref: 'o/r#2' }); expect(order(s)).toEqual(['1:3p', '2:2', '3:5', '4:1']);
    await expect(s.edit({ op: 'pin', ref: 'o/r#9' })).rejects.toThrow(PrPriNotFound);
  });

  // @req FR:pr-priority/queue.remove @req FR:pr-priority/edge.depends
  it('removes and closes the gap, dropping edges', async () => {
    const s = mk();
    for (const n of [3, 2, 1]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    await s.depends('o/r#1', 'o/r#2');
    await s.edit({ op: 'remove', ref: 'o/r#2' });
    expect(order(s)).toEqual(['1:1', '2:3']);
    expect(s.view().find((i) => i.number === 1)!.baseStack).toEqual([]);
  });

  // @req FR:pr-priority/queue.undo
  it('undo restores prior revisions, newest 20 kept', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' }); await s.edit({ op: 'add', ref: 'o/r#2' }); await s.edit({ op: 'move', ref: 'o/r#1', to: 'top' });
    expect(order(s)).toEqual(['1:1', '2:2']);
    let r = await s.edit({ op: 'undo' }); expect(r.changed).toBe(true); expect(order(s)).toEqual(['1:2', '2:1']);
    r = await s.edit({ op: 'undo' }); expect(order(s)).toEqual(['1:1']);
    r = await s.edit({ op: 'undo' }); expect(order(s)).toEqual([]);
    expect((await s.edit({ op: 'undo' })).changed).toBe(false);
    expect(s.read().rev).toBe(6);
    for (let n = 1; n <= 25; n++) await s.edit({ op: 'add', ref: `o/r#${n}` });
    expect(s.state().history).toHaveLength(20);
  });

  // @req FR:pr-priority/queue.exclude
  it('excludes PRs named in the config', async () => {
    const dir = home(); const s = mk(dir);
    await s.edit({ op: 'add', ref: 'o/r#918' });
    writeFileSync(join(dir, 'pr-priority.config.json'), JSON.stringify({ exclude: ['o/r#918', 'bad'] }));
    await expect(s.edit({ op: 'add', ref: 'o/r#918', rank: 1 })).rejects.toThrow(PrPriInvalid);
    await expect(s.edit({ op: 'add', ref: 'O/r#918' })).rejects.toThrow(PrPriInvalid);
    expect(s.view()).toEqual([]);
    expect(await s.recommend({ repo: 'o/r', number: 918, agent: 'cos', reason: 'x' })).toEqual({ blocked: { kind: 'excluded' } });
    writeFileSync(join(dir, 'pr-priority.config.json'), '{nope');
    expect(s.view().map((i) => i.number)).toEqual([918]);
  });

  // @req FR:pr-priority/queue.broken
  it('reads a broken file as empty and moves it aside on write', async () => {
    const dir = home(); const s = mk(dir);
    writeFileSync(join(dir, 'pr-priority.json'), '{"rev": "x"');
    writeFileSync(join(dir, 'pr-priority-state.json'), '[]');
    expect(s.read()).toEqual({ version: 1, rev: 0, items: [] });
    await s.edit({ op: 'add', ref: 'o/r#1' });
    const names = readdirSync(dir);
    expect(names.some((n) => n.startsWith('pr-priority.json.broken-'))).toBe(true);
    expect(names.some((n) => n.startsWith('pr-priority-state.json.broken-'))).toBe(true);
    expect(order(s)).toEqual(['1:1']);
  });
});

describe('recommendations', () => {
  // @req FR:pr-priority/rec.model @req FR:pr-priority/rec.put @req FR:pr-priority/$rec
  it('stores an open recommendation once per PR', async () => {
    const s = mk();
    const r = await s.recommend({ repo: 'o/r', number: 5, agent: 'xe-cos', reason: 'Unblocks the release', toRank: 1 });
    expect(r).toMatchObject({ created: true, rec: { repo: 'o/r', number: 5, url: U(5), agent: 'xe-cos', reason: 'Unblocks the release', toRank: 1, state: 'open', at: now().toISOString() } });
    if (!('rec' in r)) throw new Error('no rec');
    expect(r.rec.id).toMatch(/^pp-[0-9a-f]{8}$/);
    expect(await s.recommend({ repo: 'O/R', number: 5, agent: 'other', reason: 'x' })).toEqual({ created: false, rec: r.rec });
    await expect(s.recommend({ repo: 'o/r', number: 5, agent: 'Bad Agent', reason: '' })).rejects.toThrow(PrPriInvalid);
  });

  // @req FR:pr-priority/rec.queued
  it('blocks when the PR is already queued high enough', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' }); await s.edit({ op: 'add', ref: 'o/r#2', rank: 99 });
    expect(await s.recommend({ repo: 'o/r', number: 1, agent: 'a', reason: 'x' })).toEqual({ blocked: { kind: 'queued', rank: 1 } });
    expect(await s.recommend({ repo: 'o/r', number: 2, agent: 'a', reason: 'x', toRank: 3 })).toEqual({ blocked: { kind: 'queued', rank: 2 } });
    expect(await s.recommend({ repo: 'o/r', number: 2, agent: 'a', reason: 'x', toRank: 1 })).toMatchObject({ created: true });
  });

  // @req FR:pr-priority/rec.decide @req FR:pr-priority/rec.closed @req FR:pr-priority/queue.idem
  it('accept puts the PR at toRank with the reason as note; repeat is a no-op; another decision conflicts', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' });
    const r = await s.recommend({ repo: 'o/r', number: 2, agent: 'cos', reason: 'Release blocker', toRank: 1 });
    if (!('rec' in r)) throw new Error('no rec');
    const d = await s.decide(r.rec.id, { decision: 'accept' });
    expect(d.changed).toBe(true);
    expect(d.rec).toMatchObject({ state: 'accepted', decision: { at: now().toISOString(), rank: 1, note: 'cos: Release blocker' } });
    expect(d.queue.items[0]).toMatchObject({ number: 2, note: 'cos: Release blocker', by: 'cos' });
    expect((await s.decide(r.rec.id, { decision: 'accept' })).changed).toBe(false);
    await expect(s.decide(r.rec.id, { decision: 'reject', reason: 'no' })).rejects.toThrow(PrPriConflict);
    await expect(s.decide('pp-00000000', { decision: 'accept' })).rejects.toThrow(PrPriNotFound);
  });

  // @req FR:pr-priority/rec.decide @req FR:pr-priority/rec.reason
  it('edit applies the owner rank and note and needs a reason; a queued PR moves', async () => {
    const s = mk();
    for (const n of [3, 2, 1]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    const r = await s.recommend({ repo: 'o/r', number: 3, agent: 'cos', reason: 'Hot', toRank: 1 });
    if (!('rec' in r)) throw new Error('no rec');
    await expect(s.decide(r.rec.id, { decision: 'edit', rank: 2 })).rejects.toThrow(PrPriInvalid);
    const d = await s.decide(r.rec.id, { decision: 'edit', rank: 2, note: 'second is fine', reason: 'Not above 1' });
    expect(d.rec).toMatchObject({ state: 'edited', decision: { reason: 'Not above 1', rank: 2, note: 'second is fine' } });
    expect(d.queue.items.map((i) => i.number)).toEqual([1, 3, 2]);
    expect(d.queue.items).toHaveLength(3);
  });

  // @req FR:pr-priority/rec.memory @req FR:pr-priority/rec.reason @req FR:pr-priority/rec.decisions
  it('remembers a rejection for 14 days for a similar reason', async () => {
    const s = mk();
    const r = await s.recommend({ repo: 'o/r', number: 7, agent: 'cos', reason: 'Blocking the FH release' });
    if (!('rec' in r)) throw new Error('no rec');
    await expect(s.decide(r.rec.id, { decision: 'reject' })).rejects.toThrow(PrPriInvalid);
    await s.decide(r.rec.id, { decision: 'reject', reason: 'Release slipped; not urgent' });
    expect(s.read().items).toEqual([]);
    clock += 3 * 864e5;
    const again = await s.recommend({ repo: 'o/r', number: 7, agent: 'other', reason: 'blocks FH release' });
    expect(again).toEqual({ blocked: { kind: 'rejected', id: r.rec.id, reason: 'Release slipped; not urgent', at: '2026-11-11T18:00:00.000Z' } });
    expect(await s.recommend({ repo: 'o/r', number: 7, agent: 'cos', reason: 'Security fix landed upstream' })).toMatchObject({ created: true });
    expect(s.decisions().map((d) => d.state)).toEqual(['rejected']);
    expect(s.decisions('nobody')).toEqual([]);
    clock += 12 * 864e5;
    const s2 = mk(s.dir);
    const open = s2.openRecs()[0];
    await s2.decide(open.id, { decision: 'reject', reason: 'later' });
    expect(await s2.recommend({ repo: 'o/r', number: 7, agent: 'cos', reason: 'blocking the FH release' })).toMatchObject({ created: true });
  });

  // @req FR:pr-priority/rec.memory
  it('compares reasons by shared stemmed words', () => {
    expect(similarReason('Blocking the FH release', 'blocks FH release')).toBe(true);
    expect(similarReason('Fix CI', 'CI fixes')).toBe(true);
    expect(similarReason('Security fix', 'Docs typo')).toBe(false);
    expect(similarReason('a b', 'c d')).toBe(true);
  });

  // @req FR:pr-priority/rec.order @req FR:pr-priority/needs.list
  it('orders open recommendations by project then age and lists them as Needs you decisions', async () => {
    const s = mk();
    await s.recommend({ repo: 'Xerilium/stack', number: 1, agent: 'xe', reason: 'Stack' }); clock += 1000;
    await s.recommend({ repo: 'microsoft/finops-toolkit', number: 2, agent: 'ftk', reason: 'FTK' }); clock += 1000;
    await s.recommend({ repo: 'allytehq/web', number: 3, agent: 'al', reason: 'Allyte', toRank: 2 });
    expect(s.openRecs().map((r) => r.number)).toEqual([3, 2, 1]);
    const n = s.needs();
    expect(n[0]).toEqual({
      id: `pp.${s.openRecs()[0].id}`, kind: 'decision', title: `Raise ${U(3, 'allytehq/web')} to rank 2: Allyte`,
      recommendation: 'Accept, edit, or reject with a reason', link: U(3, 'allytehq/web'), project: 'allyte',
      actions: ['accept', 'edit', 'reject'], decide: `/api/pr-priority/recommendations/${s.openRecs()[0].id}`,
    });
    expect(n[2].title).toBe(`Raise ${U(1, 'Xerilium/stack')} to rank last: Stack`);
  });

  // @req FR:pr-priority/rec.prune
  it('drops decided recommendations older than 90 days', async () => {
    const s = mk();
    const r = await s.recommend({ repo: 'o/r', number: 1, agent: 'a', reason: 'x' });
    if (!('rec' in r)) throw new Error('no rec');
    await s.decide(r.rec.id, { decision: 'reject', reason: 'no' });
    clock += 91 * 864e5;
    await s.recommend({ repo: 'o/r', number: 2, agent: 'a', reason: 'y' });
    expect(s.state().recs.map((x) => x.number)).toEqual([2]);
  });
});

describe('edges, acks, escalations', () => {
  // @req FR:pr-priority/edge.depends
  it('stores merge-order edges; rejects self and cycles; removes', async () => {
    const s = mk();
    for (const n of [3, 2, 1]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    expect((await s.depends('o/r#1', 'o/r#2')).changed).toBe(true);
    expect((await s.depends('o/r#1', U(2))).changed).toBe(false);
    await s.depends('o/r#2', 'x/y#3');
    await expect(s.depends('o/r#1', 'o/r#1')).rejects.toThrow(PrPriInvalid);
    await expect(s.depends('x/y#3', 'o/r#1')).rejects.toThrow(PrPriInvalid);
    expect(s.view().find((i) => i.number === 1)!.baseStack).toEqual([U(2)]);
    await s.depends('o/r#1', 'o/r#2', true);
    expect(s.view().find((i) => i.number === 1)!.baseStack).toEqual([]);
  });

  // @req FR:pr-priority/edge.ack
  it('stores acks per thread, replacing the same thread', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' });
    await s.ack('o/r#1', 'https://github.com/o/r/pull/1#discussion_r1', 'ok to hold');
    expect((await s.ack('o/r#1', 'https://github.com/o/r/pull/1#discussion_r1', 'ok to hold')).changed).toBe(false);
    await s.ack('o/r#1', 'https://github.com/o/r/pull/1#discussion_r1', 'resolve it');
    expect(s.view()[0].acks).toEqual([{ thread: 'https://github.com/o/r/pull/1#discussion_r1', note: 'resolve it', at: now().toISOString() }]);
    await expect(s.ack('o/r#1', 'http://x', 'n')).rejects.toThrow(PrPriInvalid);
  });

  // @req FR:pr-priority/edge.escalate
  it('replaces the escalation set wholesale after checking all of it', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' });
    const set = {
      blockedAutopilot: [{ pr: U(1), status: 'approve', exactBlocker: 'Codeowner gate', context: 'Needs owner review', recommendedAnswer: 'Approve' }],
      enableAutopilot: [{ pr: U(2), whyEasy: 'Two spec lines' }], liveValidation: [],
    };
    expect(await s.escalate(set)).toEqual({ ...set, at: now().toISOString() });
    expect(s.view()[0].status).toBe('approve');
    const bad = { blockedAutopilot: [{ ...set.blockedAutopilot[0], status: 'merge' }], enableAutopilot: [1, 2, 3, 4], liveValidation: [{ pr: U(1), why: 'a' }, { pr: U(2), why: 'b' }], x: 1 };
    let issues: string[] = [];
    try { await s.escalate(bad); } catch (e) { issues = (e as PrPriInvalid).issues.map((i) => i.field); }
    expect(issues.sort()).toEqual(['blockedAutopilot[0].status', 'enableAutopilot', 'liveValidation', 'x']);
    expect(s.state().escalations).toEqual({ ...set, at: now().toISOString() });
    await s.escalate({ blockedAutopilot: [], enableAutopilot: [], liveValidation: [] });
    expect(s.view()[0].status).toBeUndefined();
  });
});

describe('view', () => {
  // @req FR:pr-priority/view.item @req FR:pr-priority/record.stale
  it('merges facts, edges, recommendations, the SM record, and acks', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' });
    const r = await s.recommend({ repo: 'o/r', number: 1, agent: 'cos', reason: 'Hot', toRank: 1 });
    expect(r).toEqual({ blocked: { kind: 'queued', rank: 1 } });
    await s.edit({ op: 'add', ref: 'o/r#2', rank: 9 });
    const rr = await s.recommend({ repo: 'o/r', number: 2, agent: 'cos', reason: 'Hot', toRank: 1 });
    if (!('rec' in rr)) throw new Error('no rec');
    await s.decide(rr.rec.id, { decision: 'reject', reason: 'Wait' });
    await s.refresh(async (_repo, n) => (n === 1 ? { title: 'One', author: { login: 'me' }, isDraft: false, assignees: [], labels: [{ name: 'Autopilot' }], reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], mergeable: 'MERGEABLE', commits: [{ committedDate: '2026-11-10T01:00:00Z' }, { committedDate: '2026-11-11T01:00:00Z' }], headRefOid: 'def5678' } : null));
    await s.record('o/r#1', { state: 'waiting-on-me', ts: '2026-11-11T12:00:00Z', owner: 'Michael', nextAction: 'Approve', blocker: { text: 'Needs label', threadUrl: 'https://github.com/o/r/pull/1#issuecomment-1' }, headSha: 'abc1234', humanOnly: true, bucket: 'approve' });
    const v = s.view();
    expect(v[0]).toEqual({
      rank: 1, repo: 'o/r', number: 1, pr: 1, url: U(1), pinned: false, by: 'owner', at: now().toISOString(),
      title: 'One', author: 'me', isDraft: false, assignee: null, labels: ['Autopilot'], reviewDecision: 'APPROVED', checks: 'green', mergeable: 'MERGEABLE', lastPushAt: '2026-11-11T01:00:00Z', headSha: 'def5678', factsAt: now().toISOString(),
      baseStack: [], acks: [], status: 'approve',
      report: { state: 'waiting-on-me', ts: '2026-11-11T12:00:00Z', owner: 'Michael', nextAction: 'Approve', blocker: { text: 'Needs label', threadUrl: 'https://github.com/o/r/pull/1#issuecomment-1' }, headSha: 'abc1234', humanOnly: true, bucket: 'approve', stale: true },
    });
    expect(v[1]).toMatchObject({ number: 2, why: 'Hot', michaelDecision: { state: 'rejected', reason: 'Wait', at: now().toISOString() } });
    expect(v[1].title).toBeUndefined();
  });

  // @req FR:pr-priority/view.refresh
  it('derives checks from the rollup; keeps prior facts when gh fails', () => {
    expect(parseFacts({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'PENDING' }] }).checks).toBe('pending');
    expect(parseFacts({ statusCheckRollup: [{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }] }).checks).toBe('red');
    expect(parseFacts({ statusCheckRollup: [{ state: 'ERROR' }] }).checks).toBe('red');
    expect(parseFacts({ statusCheckRollup: [] }).checks).toBe('green');
    expect(parseFacts({ assignees: [{ login: 'rk' }], reviewDecision: '' })).toMatchObject({ assignee: 'rk', reviewDecision: null });
  });

  // @req FR:pr-priority/api.pr
  it('rankOf gives the rank or null', async () => {
    const s = mk();
    await s.edit({ op: 'add', ref: 'o/r#1' });
    expect(s.rankOf('O/R', 1)).toBe(1);
    expect(s.rankOf('o/r', 2)).toBeNull();
  });
});

describe('SM records', () => {
  // @req FR:pr-priority/record.model @req FR:pr-priority/record.latest
  it('validates records and keeps the newest', async () => {
    const s = mk();
    const rec = { state: 'paused', ts: '2026-11-11T10:00:00Z', worker: 'w1' };
    expect(await s.record('o/r#1', rec)).toEqual({ changed: true, record: rec });
    expect((await s.record(U(1), rec)).changed).toBe(false);
    expect(await s.record('o/r#1', { state: 'pending', ts: '2026-11-11T09:00:00Z' })).toEqual({ changed: false, record: rec });
    expect((await s.record('o/r#1', { state: 'pending', ts: '2026-11-11T11:00:00Z' })).changed).toBe(true);
    let fields: string[] = [];
    try { await s.record('o/r#1', { state: 'merging', ts: 'now', owner: 'Bob', headSha: 'zz', humanOnly: 'yes', bucket: 'merge', blocker: { text: '', threadUrl: 'http://x', y: 1 }, y: 1 }); } catch (e) { fields = (e as PrPriInvalid).issues.map((i) => i.field); }
    expect(fields.sort()).toEqual(['blocker.text', 'blocker.threadUrl', 'blocker.y', 'bucket', 'headSha', 'humanOnly', 'owner', 'state', 'ts', 'y']);
    expect(s.state().records['o/r#1'].state).toBe('pending');
  });

  // @req FR:pr-priority/edge.depends
  it('adds many edges at once, all or none', async () => {
    const s = mk();
    for (const n of [715, 718, 919, 907]) await s.edit({ op: 'add', ref: `o/r#${n}` });
    expect(await s.dependsMany([{ pr: 'o/r#715', on: 'o/r#718' }, { pr: U(919), on: 'o/r#907' }])).toEqual({ changed: true, count: 2 });
    await expect(s.dependsMany([{ pr: 'o/r#731', on: 'o/r#732' }, { pr: 'o/r#718', on: 'o/r#715' }])).rejects.toThrow(PrPriInvalid);
    expect(s.state().deps).toEqual({ 'o/r#715': ['o/r#718'], 'o/r#919': ['o/r#907'] });
    await expect(s.dependsMany([{ pr: 'bad', on: 'o/r#1' }])).rejects.toThrow(PrPriInvalid);
    await expect(s.dependsMany([])).rejects.toThrow(PrPriInvalid);
    expect(await s.dependsMany([{ pr: 'o/r#715', on: 'o/r#718' }], true)).toEqual({ changed: true, count: 1 });
  });
});
