import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';
import { specSort } from '../../src/cli/pr-review';
import { ghRunner } from '../../src/core/pr-review';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const SHA = 'a'.repeat(40);
let home: string; let cwd: string; let lockPath: string;

/** A fake `gh`: answers search, PR and files reads from a JSON fixture; logs every call. */
function fakeGh(data: { search?: unknown[]; prs: Record<string, { sha: string; body?: string; labels?: string[]; files: { filename: string; additions: number; deletions: number }[] }> }) {
  const fx = join(cwd, 'gh.json'); const log = join(cwd, 'gh.log');
  writeFileSync(fx, JSON.stringify(data)); writeFileSync(log, '');
  const gh = join(cwd, 'gh');
  writeFileSync(gh, `#!/usr/bin/env node
const fs = require('fs'); const d = JSON.parse(fs.readFileSync(${JSON.stringify(fx)}, 'utf8'));
const a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
if (a[0] === 'search') { process.stdout.write(JSON.stringify(d.search || [])); process.exit(0); }
const p = a.find((x) => x.startsWith('repos/')); const m = /^repos\\/([^/]+\\/[^/]+)\\/pulls\\/(\\d+)(\\/files)?$/.exec(p || '');
const pr = m && d.prs[m[1] + '#' + m[2]]; if (!pr) { process.stderr.write('not found'); process.exit(1); }
if (m[3]) process.stdout.write(pr.files.map((f) => JSON.stringify(f)).join('\\n'));
else process.stdout.write(JSON.stringify({ head: { sha: pr.sha }, body: pr.body || null, labels: (pr.labels || []).map((name) => ({ name })), title: 'PR ' + m[2], draft: false, html_url: 'https://github.com/' + m[1] + '/pull/' + m[2] }));
`);
  chmodSync(gh, 0o755);
  process.env.STACK_GH = gh;
  return { calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

beforeEach(() => {
  home = tmp('stack-home-'); cwd = tmp('stack-norepo-'); lockPath = join(home, 'fh-server.lock');
  process.env.STACK_HOME = home; delete process.env.STACK_GH;
  writeFileSync(join(home, 'live.config.json'), JSON.stringify({ lockPath }));
});
afterAll(() => { delete process.env.STACK_HOME; delete process.env.STACK_GH; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}


describe('stack prs --sort spec-lines', () => {
  // @req FR:pr-review-lane/sort.cli @req FR:pr-review-lane/sort.cache
  it('drops Autopilot rows, adds specLines and live from facts, fewest first, cached per head', async () => {
    const g = fakeGh({ prs: {
      'o/r#1': { sha: SHA, files: [{ filename: '.xe/features/a/spec.md', additions: 30, deletions: 2 }] },
      'o/r#3': { sha: SHA, labels: ['Needs Validation'], files: [{ filename: 'docs/a.md', additions: 3, deletions: 1 }, { filename: 'src/a.ts', additions: 99, deletions: 0 }] },
    } });
    const rows = [{ repo: 'o/r', number: 1, labels: [] }, { repo: 'o/r', number: 2, labels: ['Status: 🤖 Autopilot'] }, { repo: 'o/r', number: 3, labels: ['Needs Validation'] }];
    const out = await specSort(rows, ghRunner(), home);
    expect(out.map((r) => [r.number, r.specLines, r.live])).toEqual([[3, 4, true], [1, 32, false]]);
    await specSort(rows, ghRunner(), home);
    expect(g.calls().filter((c) => c.includes('/files')).length).toBe(2);
    expect((await stack('prs', '--sort', 'age')).code).toBe(2);
  });
});

const BRIEF = { problem: 'The deploy step fails on dev.', solution: 'Pin the CLI version.', recommendation: 'Approve the run.', evidence: ['https://github.com/o/r/actions/runs/1'], headSha: SHA };

describe('stack pr-pri brief', () => {
  // @req FR:pr-review-lane/brief.cli @req FR:pr-review-lane/brief.stale
  it('stores a linted brief from a file and prints it, stale after a new head', async () => {
    const f = join(cwd, 'brief.json');
    writeFileSync(f, JSON.stringify(BRIEF));
    const w = await stack('pr-pri', 'brief', 'o/r#7', '--file', f, '--agent', 'fh-agent');
    expect(w).toMatchObject({ code: 0, out: 'brief stored o/r#7 (13 words)\n' });
    const r = await stack('pr-pri', 'brief', 'https://github.com/o/r/pull/7');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Problem: The deploy step fails on dev.');
    expect(r.out).toContain('Recommendation: Approve the run.');
    expect(r.out).not.toContain('[stale]');
    fakeGh({ prs: { 'o/r#7': { sha: 'b'.repeat(40), files: [] } } });
    const s = await stack('pr-pri', 'brief', 'o/r#7', '--refresh', '--json');
    expect(JSON.parse(s.out)).toMatchObject({ ok: true, brief: { number: 7, stale: true, by: 'fh-agent' } });
    expect((await stack('pr-pri', 'brief', 'o/r#7')).out).toContain('[stale]');
  });
  it('lint and input errors exit 2; a missing brief exits 1', async () => {
    const f = join(cwd, 'brief.json');
    writeFileSync(f, JSON.stringify({ ...BRIEF, problem: Array.from({ length: 20 }, () => 'Go now and fix this bug.').join(' ') }));
    const r = await stack('pr-pri', 'brief', 'o/r#7', '--file', f);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/over 120 words/);
    expect((await stack('pr-pri', 'brief', 'bad', '--file', f)).code).toBe(2);
    expect((await stack('pr-pri', 'brief', 'o/r#7', '--file', join(cwd, 'none.json'))).code).toBe(2);
    expect((await stack('pr-pri', 'brief', 'o/r#8')).code).toBe(1);
  });
});

describe('stack live', () => {
  // @req FR:pr-review-lane/lane.next @req FR:pr-review-lane/lane.pick @req FR:pr-review-lane/lane.show @req FR:pr-review-lane/lane.ready @req FR:pr-review-lane/lane.resolve @req FR:pr-review-lane/lane.checklist @req FR:pr-review-lane/lane.items @req FR:pr-review-lane/lane.state
  it('runs the lane end to end from the queue', async () => {
    writeFileSync(join(home, 'pr-priority.json'), JSON.stringify({ version: 1, rev: 1, items: [
      { rank: 1, repo: 'o/r', number: 918, url: 'https://github.com/o/r/pull/918' },
      { rank: 2, repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' },
      { rank: 3, repo: 'o/r', number: 2, url: 'https://github.com/o/r/pull/2' },
      { rank: 4, repo: 'o/r', number: 3, url: 'https://github.com/o/r/pull/3' },
    ] }));
    const g = fakeGh({ prs: {
      'o/r#918': { sha: SHA, labels: ['Needs Validation'], files: [] },
      'o/r#1': { sha: SHA, files: [{ filename: 'src/a.ts', additions: 1, deletions: 0 }] },
      'o/r#2': { sha: SHA, body: 'Needs live validation on dev.', files: [] },
      'o/r#3': { sha: SHA, files: [{ filename: 'infra/main.bicep', additions: 1, deletions: 0 }] },
    } });
    expect((await stack('live')).out).toBe('idle\n');
    const n = await stack('live', 'next', '--agent', 'live-1', '--worktree', '/wt/2');
    expect(n).toMatchObject({ code: 0, out: 'claimed https://github.com/o/r/pull/2 (preparing)\n' });
    expect(g.calls().some((c) => c.includes('/918'))).toBe(false);
    const items = join(cwd, 'items.json');
    writeFileSync(items, JSON.stringify({ items: [{ text: 'Sign in works' }, { text: 'Export CSV' }] }));
    expect((await stack('live', 'checklist', 'o/r#2', '--file', items, '--agent', 'live-1')).out).toBe('seeded 2 items\n');
    const add = await stack('live', 'item', 'add', 'o/r#2', '--text', 'Dark mode', '--json');
    const id = JSON.parse(add.out).item.id as string;
    expect(JSON.parse(add.out).item.by).toBe('owner');
    expect((await stack('live', 'item', 'check', 'o/r#2', id)).code).toBe(0);
    expect((await stack('live', 'item', 'check', 'o/r#2', 'li-00000000')).code).toBe(1);
    expect((await stack('live', 'item', 'block', 'o/r#2', id, '--by', 'live-1')).code).toBe(2);
    expect((await stack('live', 'item', 'zap', 'o/r#2', id)).code).toBe(2);
    expect((await stack('live', 'state', 'o/r#2', 'working')).out).toBe('https://github.com/o/r/pull/2 working\n');
    expect((await stack('live', 'ready', 'o/r#2', '--url', 'http://localhost:5180', '--pid', String(process.pid))).code).toBe(2);
    const rd = await stack('live', 'ready', 'o/r#2', '--url', 'http://localhost:5176', '--pid', String(process.pid), '--worktree', '/wt/2');
    expect(rd).toMatchObject({ code: 0, out: 'ready https://github.com/o/r/pull/2 at http://localhost:5176 (ready-for-michael)\n' });
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual({ owner: 'live:o/r#2', port: 5176, pid: process.pid, wt: '/wt/2', head: SHA });
    expect((await stack('live')).out).toBe('https://github.com/o/r/pull/2 ready-for-michael http://localhost:5176\nitems: open 2, passed 1\n');
    const res = await stack('live', 'resolve', 'o/r#2', '--reason', 'merged');
    expect(res).toMatchObject({ code: 0, out: 'done https://github.com/o/r/pull/2\nnext https://github.com/o/r/pull/3\n' });
    const show = JSON.parse((await stack('live', '--json')).out);
    expect(show).toMatchObject({ ok: true, state: 'preparing', active: { number: 3 } });
    expect((await stack('live', 'resolve', 'o/r#3')).out).toBe('done https://github.com/o/r/pull/3\nnext: none (idle)\n');
    expect((await stack('live', 'next', '--offline')).code).toBe(4);
  });
  // @req FR:pr-review-lane/lane.lock
  it('refuses a server when another owner holds the lock (exit 3)', async () => {
    writeFileSync(lockPath, JSON.stringify({ owner: 'sweep:fh', port: 5174, pid: process.pid, wt: '/x', head: 'h' }));
    await stack('live', 'next', 'o/r#4', '--offline');
    const r = await stack('live', 'ready', 'o/r#4', '--url', 'http://localhost:5173', '--pid', String(process.pid));
    expect(r.code).toBe(3);
    expect(r.err).toContain('sweep:fh');
    expect((await stack('live', 'ready', 'o/r#4', '--url', 'http://localhost:5173')).code).toBe(2);
  });
  // @req FR:pr-review-lane/lane.guard
  it('never calls gh for anything but reads', async () => {
    const g = fakeGh({ prs: { 'o/r#5': { sha: SHA, labels: ['Needs Validation'], files: [] } } });
    await stack('live', 'next', 'o/r#5');
    await stack('live', 'item', 'add', 'o/r#5', '--text', 'x');
    await stack('live', 'resolve', 'o/r#5');
    for (const c of g.calls()) expect(c).toMatch(/^(api (--paginate )?repos\/[^ ]+\/pulls\/\d+(\/files)?( --jq .*)?|search prs .*)$/);
    for (const c of g.calls()) expect(c).not.toMatch(/-X|--method|POST|PATCH|graphql|resolveReviewThread|label/i);
  });
});
