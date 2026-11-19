/** `stack lint` and the lint in `check`, `update`, `add`, `capture`, and `retitle`. */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { run } from '../../src/cli/run';

const CLEAN = '# Alpha\n\n## Active\n\n- [ ] 🙋 Answer the acks\n  - Done when: All threads answered\n  - Context: The acks pick the cut\n';
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function mk(bloat = true): string {
  const d = mkdtempSync(join(tmpdir(), 'stack-lint-'));
  dirs.push(d);
  mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'tasks/alpha.md'), CLEAN);
  if (bloat) copyFileSync(resolve(__dirname, '../fixtures/task-lint/bloated.md'), join(d, 'tasks/bloat.md'));
  return d;
}
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const read = (d: string, f: string) => readFileSync(join(d, f), 'utf8');

describe('stack lint', () => {
  // @req FR:task-lint/cli.lint @req FR:task-lint/cli.lint.out @req FR:task-lint/cli.lint.exit
  it('lists each issue as path:line rule message, then the count, and exits 1', async () => {
    const r = await stack(mk(), 'lint');
    expect(r.code).toBe(1);
    const lines = r.out.trimEnd().split('\n');
    expect(lines[0]).toBe('tasks/bloat.md:5 title-status Title holds status text "as of". Move it to a nested bullet.');
    expect(lines).toContain('tasks/bloat.md:13 detail-nesting Detail line is not a bullet. Start it with "- ".');
    expect(lines.slice(0, -1).every((l) => /^tasks\/bloat\.md:\d+ (title-length|title-status|title-parens|detail-nesting) \S/.test(l))).toBe(true);
    expect(lines[lines.length - 1]).toBe('14 issues in 1 files');
  });

  // @req FR:task-lint/cli.lint.out @req FR:task-lint/cli.lint.exit
  it('prints no issues and exits 0 on clean files, and never writes', async () => {
    const d = mk(false);
    expect(await stack(d, 'lint')).toEqual({ code: 0, out: 'no issues\n', err: '' });
    expect(read(d, 'tasks/alpha.md')).toBe(CLEAN);
  });

  // @req FR:task-lint/cli.lint @req FR:task-lint/cli.lint.unknown
  it('lints one project with --project and refuses an unknown one', async () => {
    const d = mk();
    expect((await stack(d, 'lint', '--project', 'alpha')).out).toBe('no issues\n');
    expect((await stack(d, 'lint', '--project', 'bloat')).code).toBe(1);
    expect((await stack(d, 'lint', '--project', 'nope')).code).toBe(2);
  });

  // @req FR:task-lint/cli.lint.json
  it('prints the issues as JSON', async () => {
    const d = mk();
    const bad = await stack(d, 'lint', '--json');
    const j = JSON.parse(bad.out);
    expect(bad.code).toBe(1);
    expect(j.ok).toBe(false);
    expect(j.command).toBe('lint');
    expect(j.issues).toHaveLength(14);
    expect(j.issues[0]).toEqual({ path: 'tasks/bloat.md', line: 5, rule: 'title-status', message: 'Title holds status text "as of". Move it to a nested bullet.' });
    expect(JSON.parse((await stack(mk(false), 'lint', '--json')).out)).toEqual({ ok: true, command: 'lint', issues: [] });
  });
});

describe('stack check with the lint', () => {
  // @req FR:task-lint/cli.check
  it('adds the rules to the line and the JSON, and exits 1', async () => {
    const d = mk();
    const r = await stack(d, 'check', 'tasks/bloat.md:12');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^tasks\/bloat\.md:12 \d\/4 .* lint: detail-nesting\n$/);
    const j = JSON.parse((await stack(d, 'check', 'tasks/bloat.md:8', '--json')).out);
    expect(j.lint.map((i: { rule: string }) => i.rule)).toEqual(['title-status', 'detail-nesting']);
    expect(j.lint[0]).toEqual({ line: 8, rule: 'title-status', message: 'Title holds status text "Waiting". Move it to a nested bullet.' });
  });

  // @req FR:task-lint/cli.check
  it('does not change the output of a clean row', async () => {
    const d = mk();
    expect(await stack(d, 'check', 'tasks/alpha.md:5')).toEqual({ code: 0, out: 'tasks/alpha.md:5 4/4 actionable\n', err: '' });
    expect(JSON.parse((await stack(d, 'check', 'tasks/alpha.md:5', '--json')).out)).toEqual({ ok: true, ref: 'tasks/alpha.md:5', score: 4, actionable: true, missing: [] });
  });
});

describe('writes with the lint', () => {
  const LONG = `Fix the export ${'and the next thing '.repeat(7)}`.trim();

  // @req FR:task-lint/cli.write
  it('add refuses a bloated title, names each rule, and writes nothing', async () => {
    const d = mk(false);
    const r = await stack(d, 'add', 'alpha', 'Portal extension (a) (b) -- Waiting on the reviewer');
    expect(r.code).toBe(2);
    expect(r.err).toContain('title-status Title holds status text "Waiting". Move it to a nested bullet.');
    expect(r.err).toContain('title-parens Title has 2 parentheticals (max 1). Move detail to nested bullets.');
    expect(r.err).toContain('detail-nesting Title holds detail after a dash. Move it to a nested bullet.');
    expect((await stack(d, 'add', 'alpha', LONG)).err).toContain('title-length');
    expect(read(d, 'tasks/alpha.md')).toBe(CLEAN);
  });

  // @req FR:task-lint/cli.write
  it('add accepts a clean title with an agent tag', async () => {
    const d = mk(false);
    expect((await stack(d, 'add', 'alpha', '1️⃣ Approve the QM plan (4 tasks) (agent: qm-planner)')).code).toBe(0);
    expect(read(d, 'tasks/alpha.md')).toContain('- [ ] 1️⃣ Approve the QM plan (4 tasks) (agent: qm-planner)\n');
  });

  // @req FR:task-lint/cli.write
  it('retitle refuses a bloated title and accepts a clean one', async () => {
    const d = mk(false);
    const bad = await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', 'Answer the acks -- blocked on the label', '--no-update');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('title-status');
    expect(read(d, 'tasks/alpha.md')).toBe(CLEAN);
    expect((await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', 'Answer the 3 acks', '--no-update')).code).toBe(0);
    expect(read(d, 'tasks/alpha.md')).toContain('- [ ] Answer the 3 acks\n');
  });

  // @req FR:task-lint/cli.write
  it('capture refuses a bloated title; a dry run still shows the row', async () => {
    const d = mk(false);
    const text = 'Ship the hub fix (a) (b) -- blocked';
    const bad = await stack(d, 'capture', text, '--project', 'alpha');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('title-parens');
    expect(read(d, 'tasks/alpha.md')).toBe(CLEAN);
    expect((await stack(d, 'capture', text, '--project', 'alpha', '--dry-run')).code).toBe(0);
    expect((await stack(d, 'capture', 'Call the dentist tomorrow 30m', '--project', 'alpha')).code).toBe(0);
  });
});

describe('stack update with the lint', () => {
  // @req FR:task-lint/cli.update
  it('writes the summaries, then lists the issues on stderr and exits 1', async () => {
    const d = mk();
    const r = await stack(d, 'update');
    expect(r.code).toBe(1);
    expect(r.out).toContain('updated README.md');
    expect(r.err).toContain('tasks/bloat.md:5 title-status ');
    expect(r.err.trimEnd().split('\n').pop()).toBe('14 issues in 1 files');
    expect(read(d, 'README.md').length).toBeGreaterThan(0);
    const j = await stack(d, 'update', '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out)).toMatchObject({ ok: false, command: 'update' });
    expect(JSON.parse(j.out).lint).toHaveLength(14);
  });

  // @req FR:task-lint/cli.update
  it('exits 0 with no issue', async () => {
    const r = await stack(mk(false), 'update');
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
  });

  // @req FR:task-lint/cli.update.refresh
  it('does not lint in the refresh after a lifecycle command', async () => {
    const d = mk();
    const r = await stack(d, 'start', 'tasks/bloat.md:8');
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    expect(read(d, 'tasks/bloat.md')).toContain('🚧');
  });
});

describe('agent write guidance', () => {
  // @req FR:task-lint/docs.rubric
  it('states the four rules and the command in the task rubric', () => {
    const doc = readFileSync(resolve(__dirname, '../../docs/task-rubric.md'), 'utf8');
    for (const s of ['title-length', 'title-status', 'title-parens', 'detail-nesting', 'stack lint', '120 characters']) expect(doc).toContain(s);
  });

  // @req FR:task-lint/docs.cli
  it('lists lint in docs/cli.md', () => {
    expect(readFileSync(resolve(__dirname, '../../docs/cli.md'), 'utf8')).toContain('<a id="lint"></a>');
  });
});
