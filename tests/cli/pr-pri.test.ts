import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prPriArgv } from '../../src/cli/pr-pri';
import { run } from '../../src/cli/run';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const U = (n: number, repo = 'o/r') => `https://github.com/${repo}/pull/${n}`;
let home: string; let cwd: string;
beforeEach(() => { home = tmp('stack-home-'); cwd = tmp('stack-norepo-'); process.env.STACK_HOME = home; delete process.env.STACK_GH; });
afterAll(() => { delete process.env.STACK_HOME; delete process.env.STACK_GH; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const j = async (...args: string[]) => JSON.parse((await stack(...args, '--json')).out);

describe('stack pr-pri queue', () => {
  // @req FR:pr-priority/cli.edit @req FR:pr-priority/view.text @req FR:pr-priority/queue.add
  it('adds by url at the top, moves, pins and prints the new order; no repo needed', async () => {
    expect((await stack('pr-pri', 'list')).out).toBe('no PR priorities (run: stack pr-pri add <repo>#<n>)\n');
    expect((await stack('pr-pri', 'add', 'o/r#1')).code).toBe(0);
    const r = await stack('pr-pri', 'add', U(2), '--note', 'release blocker');
    expect(r.out).toBe(`1. ${U(2)} - release blocker\n2. ${U(1)}\n`);
    expect((await stack('pr-pri', 'move', 'o/r#1', '--top')).out).toBe(`1. ${U(1)}\n2. ${U(2)} - release blocker\n`);
    expect((await stack('pr-pri', 'move', 'o/r#1', '--down')).out.split('\n')[0]).toBe(`1. ${U(2)} - release blocker`);
    expect((await stack('pr-pri', 'move', 'o/r#1', '--up')).out.split('\n')[0]).toBe(`1. ${U(1)}`);
    expect((await stack('pr-pri', 'move', 'o/r#1', '--to', '2')).out.split('\n')[0]).toBe(`1. ${U(2)} - release blocker`);
    expect((await stack('pr-pri', 'pin', 'o/r#1')).out.split('\n')[0]).toBe(`1. ${U(1)} 📌`);
    expect((await stack('pr-pri', 'unpin', 'o/r#1')).code).toBe(0);
    const v = await j('pr-pri', 'list');
    expect(v).toMatchObject({ ok: true, version: 1, rev: 8, escalations: null, items: [{ rank: 1, pr: 1, url: U(1), pinned: false }, { rank: 2, pr: 2 }] });
    const again = await j('pr-pri', 'add', 'o/r#1');
    expect(again).toMatchObject({ ok: true, changed: false, rev: 8 });
  });

  // @req FR:pr-priority/cli.edit @req FR:pr-priority/queue.undo
  it('removes, undoes, and maps errors to exit codes', async () => {
    await stack('pr-pri', 'add', 'o/r#1'); await stack('pr-pri', 'add', 'o/r#2');
    expect((await stack('pr-pri', 'remove', 'o/r#1')).out).toBe(`1. ${U(2)}\n`);
    expect((await stack('pr-pri', 'remove', 'o/r#1')).code).toBe(0);
    expect((await stack('pr-pri', 'undo')).out).toBe(`1. ${U(2)}\n2. ${U(1)}\n`);
    expect((await stack('pr-pri', 'add', 'nope')).code).toBe(2);
    expect((await stack('pr-pri', 'move', 'o/r#1')).code).toBe(2);
    expect((await stack('pr-pri', 'move', 'o/r#9', '--top')).code).toBe(1);
    expect((await stack('pr-pri', 'add', 'o/r#3', '--rev', '0')).code).toBe(3);
    expect((await stack('pr-pri', 'bogus')).code).toBe(2);
    expect((await stack('pr-pri', 'add', 'o/r#3', '--rank', 'x')).code).toBe(2);
  });
});

describe('stack pr-pri recommendations', () => {
  // @req FR:pr-priority/cli.recommend @req FR:pr-priority/cli.decide @req FR:pr-priority/cli.decisions
  it('recommends, decides, remembers rejections (exit 4), and lists decisions', async () => {
    const r = await stack('pr-pri', 'recommend', 'o/r#5', '--agent', 'xe-cos', '--reason', 'Blocks the release', '--to-rank', '1');
    expect(r.code).toBe(0);
    const id = /^recommended (pp-[0-9a-f]{8}) /.exec(r.out)![1];
    expect(r.out).toBe(`recommended ${id} ${U(5)}\n`);
    expect((await stack('pr-pri', 'recommend', 'o/r#5', '--agent', 'xe-cos', '--reason', 'x')).out).toBe(`already open: ${id} ${U(5)}\n`);
    expect((await stack('pr-pri', 'recommend', 'o/r#5', '--agent', 'xe-cos')).code).toBe(2);
    expect((await stack('pr-pri', 'reject', id)).code).toBe(2);
    expect((await stack('pr-pri', 'reject', id, '--reason', 'Release moved')).code).toBe(0);
    expect((await stack('pr-pri', 'accept', id)).code).toBe(3);
    expect((await stack('pr-pri', 'accept', 'pp-00000000')).code).toBe(1);
    const b = await stack('pr-pri', 'recommend', U(5), '--agent', 'other', '--reason', 'blocking release');
    expect(b.code).toBe(4);
    expect(b.out).toMatch(new RegExp(`^rejected \\S+ by owner: Release moved \\(${id}\\)\\n$`));
    const bj = await stack('pr-pri', 'recommend', U(5), '--agent', 'other', '--reason', 'blocking release', '--json');
    expect(bj.code).toBe(4);
    expect(JSON.parse(bj.out)).toMatchObject({ ok: false, blocked: { kind: 'rejected', id, reason: 'Release moved' } });
    const d = await stack('pr-pri', 'decisions', '--agent', 'xe-cos');
    expect(d.out).toMatch(new RegExp(`^rejected ${U(5).replace(/[.]/g, '\\.')} \\(xe-cos\\) \\d{4}-\\d{2}-\\d{2}: Release moved\\n$`));
    expect((await stack('pr-pri', 'decisions', '--agent', 'zz')).out).toBe('no decisions\n');
    // Accept and edit.
    const a = /recommended (\S+)/.exec((await stack('pr-pri', 'recommend', 'o/r#6', '--agent', 'cos', '--reason', 'Hot')).out)![1];
    expect((await stack('pr-pri', 'accept', a)).out).toBe(`1. ${U(6)} - cos: Hot\n`);
    expect((await stack('pr-pri', 'accept', a)).code).toBe(0);
    const e = /recommended (\S+)/.exec((await stack('pr-pri', 'recommend', 'o/r#7', '--agent', 'cos', '--reason', 'Hot too', '--to-rank', '1')).out)![1];
    expect((await stack('pr-pri', 'edit', e, '--rank', '2', '--note', 'after 6')).code).toBe(2);
    expect((await stack('pr-pri', 'edit', e, '--rank', '2', '--note', 'after 6', '--reason', '6 first')).out).toBe(`1. ${U(6)} - cos: Hot\n2. ${U(7)} - after 6\n`);
    expect((await stack('pr-pri', 'recommend', 'o/r#7', '--agent', 'cos', '--reason', 'x', '--to-rank', '3')).out).toBe('already queued at rank 2\n');
  });
});

describe('stack pr-pri edges, acks, escalations, view', () => {
  // @req FR:pr-priority/cli.more @req FR:pr-priority/record.model @req FR:pr-priority/edge.depends @req FR:pr-priority/edge.ack @req FR:pr-priority/edge.escalate @req FR:pr-priority/sm.cli
  it('stores edges, acks and the escalation set and merges them into list --json', async () => {
    await stack('pr-pri', 'add', 'o/r#2'); await stack('pr-pri', 'add', 'o/r#1');
    expect((await stack('pr-pri', 'depends', 'o/r#1', '--on', 'o/r#2')).out).toBe(`${U(1)} merges after ${U(2)}\n`);
    expect((await stack('pr-pri', 'depends', 'o/r#2', '--on', 'o/r#1')).code).toBe(2);
    expect((await stack('pr-pri', 'ack', 'o/r#1', '--thread', `${U(1)}#discussion_r9`, '--note', 'hold ok')).out).toBe(`acked ${U(1)}#discussion_r9\n`);
    expect((await stack('pr-pri', 'ack', 'o/r#1', '--thread', 'x', '--note', 'n')).code).toBe(2);
    const set = join(cwd, 'set.json');
    writeFileSync(set, JSON.stringify({ blockedAutopilot: [{ pr: U(1), status: 'unblock', exactBlocker: 'Thread open', context: 'Hold thread', recommendedAnswer: 'Resolve' }], enableAutopilot: [], liveValidation: [] }));
    expect((await stack('pr-pri', 'escalate', '--file', set)).out).toBe('escalations: 1 blocked, 0 enable, 0 live\n');
    writeFileSync(set, '{"x":1}');
    expect((await stack('pr-pri', 'escalate', '--file', set)).code).toBe(2);
    const rec = join(cwd, 'rec.json');
    writeFileSync(rec, JSON.stringify({ state: 'blocked-on-me', ts: '2026-11-11T10:00:00Z', owner: 'Michael' }));
    expect((await stack('pr-pri', 'record', 'o/r#1', '--file', rec)).out).toBe(`recorded ${U(1)} blocked-on-me\n`);
    writeFileSync(rec, '{"state":"nope"}');
    expect((await stack('pr-pri', 'record', 'o/r#1', '--file', rec)).code).toBe(2);
    const edges = join(cwd, 'edges.json');
    writeFileSync(edges, JSON.stringify([{ pr: 'o/r#2', on: 'x/y#9' }]));
    expect((await stack('pr-pri', 'depends', '--file', edges)).out).toBe('edges added: 1\n');
    const v = await j('pr-pri', 'list');
    expect(v.escalations).toMatchObject({ blockedAutopilot: [{ pr: U(1), status: 'unblock' }] });
    expect(v.items[0]).toMatchObject({ pr: 1, baseStack: [U(2)], status: 'unblock', acks: [{ thread: `${U(1)}#discussion_r9`, note: 'hold ok' }], report: { state: 'blocked-on-me', owner: 'Michael', stale: false } });
    expect(v.items[1].baseStack).toEqual(['https://github.com/x/y/pull/9']);
    expect((await stack('pr-pri', 'list')).out).toBe(`1. ${U(1)} unblock\n2. ${U(2)}\n`);
  });

  // @req FR:pr-priority/view.refresh
  it('list --refresh reads PR facts through gh and caches them', async () => {
    const gh = join(cwd, 'gh');
    writeFileSync(gh, `#!/bin/sh\ncase "$*" in *"view 1 "*) echo '{"title":"One","author":{"login":"me"},"isDraft":true,"assignees":[],"labels":[],"reviewDecision":"","statusCheckRollup":[{"status":"COMPLETED","conclusion":"FAILURE"}],"mergeable":"CONFLICTING","commits":[{"committedDate":"2026-11-10T00:00:00Z"}]}';; *) exit 1;; esac\n`);
    chmodSync(gh, 0o755);
    process.env.STACK_GH = gh;
    await stack('pr-pri', 'add', 'o/r#2'); await stack('pr-pri', 'add', 'o/r#1');
    const v = await j('pr-pri', 'list', '--refresh');
    expect(v.items[0]).toMatchObject({ pr: 1, title: 'One', author: 'me', isDraft: true, checks: 'red', mergeable: 'CONFLICTING', reviewDecision: null, assignee: null });
    expect(v.items[1].title).toBeUndefined();
    delete process.env.STACK_GH;
    expect((await j('pr-pri', 'list')).items[0].title).toBe('One');
  });
});

describe('SM contract', () => {
  // @req FR:pr-priority/sm.file
  it('keeps the lean queue file shape', async () => {
    await stack('pr-pri', 'add', 'o/r#1', '--note', 'n');
    const f = JSON.parse(readFileSync(join(home, 'pr-priority.json'), 'utf8'));
    expect(Object.keys(f).sort()).toEqual(['items', 'rev', 'updatedAt', 'version']);
    expect(Object.keys(f.items[0]).sort()).toEqual(['at', 'by', 'note', 'number', 'pinned', 'rank', 'repo', 'url']);
  });
  // @req FR:pr-priority/sm.doc
  it('documents the SM prompt text in at most 40 lines', () => {
    const doc = readFileSync(join(__dirname, '../../docs/pr-priority.md'), 'utf8') as string;
    expect(doc.trimEnd().split('\n').length).toBeLessThanOrEqual(40);
    expect(doc).toContain('Work PRs in this order; skip none; report progress per PR.');
    expect(doc).toContain('stack pr-pri list --json --refresh');
  });
});

describe('prPriArgv', () => {
  // @req FR:pr-priority/cli.edit
  it('finds the command past a flag value and leaves positionals after -- alone', () => {
    expect(prPriArgv(['--dir', '/checkout', 'pr-pri', 'move', 'o/r#1', '--top'])).toEqual(['--dir', '/checkout', 'pr-pri', 'move', 'o/r#1', '--to=top']);
    expect(prPriArgv(['--json', 'pr-pri', 'move', 'o/r#1', '--up'])).toEqual(['--json', 'pr-pri', 'move', 'o/r#1', '--to=up']);
    expect(prPriArgv(['pr-pri', 'add', 'o/r#1', '--', '--down'])).toEqual(['pr-pri', 'add', 'o/r#1', '--', '--down']);
    expect(prPriArgv(['--dir', 'pr-pri', 'list', '--top', '3'])).toEqual(['--dir', 'pr-pri', 'list', '--top', '3']);
  });
  it('moves to the top with --dir before the command', async () => {
    await stack('pr-pri', 'add', 'o/r#1'); await stack('pr-pri', 'add', 'o/r#2');
    let out = '';
    expect(await run(['--dir', cwd, 'pr-pri', 'move', 'o/r#1', '--top'], { out: (s) => { out += s; }, err: () => undefined })).toBe(0);
    expect(out.split('\n')[0]).toBe(`1. ${U(1)}`);
  });
});
