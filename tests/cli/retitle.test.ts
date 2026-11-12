/**
 * `stack retitle` and `stack note add`: in-place row edits for agents.
 * @req FR:cli/cmd.retitle @req FR:cli/cmd.note
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const FILE = [
  '# Alpha', '', '## 🔄 Active', '',
  '- [ ] 🚨 Old title 🟢',
  '  - [ ] Child',
  '  - old note',
  '- [x] Done one 🔴',
  '- [ ] Last',
  '',
].join('\n');

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function mk(): string {
  const d = mkdtempSync(join(tmpdir(), 'stack-retitle-'));
  dirs.push(d);
  mkdirSync(join(d, 'tasks'));
  writeFileSync(join(d, 'tasks/alpha.md'), FILE);
  return d;
}
async function stack(d: string, ...a: string[]) {
  let out = '', err = '';
  const code = await run([...a, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const lines = (d: string) => readFileSync(join(d, 'tasks/alpha.md'), 'utf8').split('\n');

describe('retitle', () => {
  it('replaces the text, keeps marks, children, and notes', async () => {
    const d = mk();
    const r = await stack(d, 'retitle', 'tasks/alpha.md:5', '--expect', '🚨 Old title 🟢', '--text', 'New title', '--no-update');
    expect(r.code).toBe(0);
    expect(r.out).toContain('tasks/alpha.md:5');
    expect(lines(d).slice(4, 7)).toEqual(['- [ ] 🚨 New title 🟢', '  - [ ] Child', '  - old note']);
  });
  it('keeps checkbox state and indent', async () => {
    const d = mk();
    await stack(d, 'retitle', 'tasks/alpha.md:6', '--text', 'Kid', '--no-update');
    expect(lines(d)[5]).toBe('  - [ ] Kid');
    await stack(d, 'retitle', 'tasks/alpha.md:8', '--text', 'Finished', '--no-update');
    expect(lines(d)[7]).toBe('- [x] Finished 🔴');
  });
  it('uses marks the new text supplies', async () => {
    const d = mk();
    await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', '🔻 New 🔴', '--no-update');
    expect(lines(d)[4]).toBe('- [ ] 🔻 New 🔴');
  });
  it('a new mark replaces only the same kind at that end', async () => {
    const d = mk();
    await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', '🔻 New', '--no-update');
    expect(lines(d)[4]).toBe('- [ ] 🔻 New 🟢');
    await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', 'Newer 🔴', '--no-update');
    expect(lines(d)[4]).toBe('- [ ] 🔻 Newer 🔴');
  });
  it('--json reports before and after', async () => {
    const d = mk();
    const r = await stack(d, 'retitle', 'tasks/alpha.md:9', '--text', 'Last', '--json', '--no-update');
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, command: 'retitle', changed: false });
    const r2 = await stack(d, 'retitle', 'tasks/alpha.md:9', '--text', 'Next', '--json', '--no-update');
    expect(JSON.parse(r2.out)).toMatchObject({ ok: true, changed: true, before: 'Last', text: 'Next' });
  });
  it('refreshes summaries unless --no-update', async () => {
    const d = mk();
    const r = await stack(d, 'retitle', 'tasks/alpha.md:9', '--text', 'Next', '--json');
    expect(JSON.parse(r.out).update).toBeDefined();
  });
  it('--expect mismatch is exit 3 and writes nothing', async () => {
    const d = mk();
    const r = await stack(d, 'retitle', 'tasks/alpha.md:5', '--expect', 'other', '--text', 'X', '--no-update');
    expect(r.code).toBe(3);
    expect(lines(d)).toEqual(FILE.split('\n'));
  });
  it('usage errors are exit 2', async () => {
    const d = mk();
    expect((await stack(d, 'retitle', '--text', 'X')).code).toBe(2);
    expect((await stack(d, 'retitle', 'tasks/alpha.md:5')).code).toBe(2);
    expect((await stack(d, 'retitle', 'bad', '--text', 'X')).code).toBe(2);
    expect((await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', 'a\nb')).code).toBe(2);
    expect((await stack(d, 'retitle', 'tasks/alpha.md:5', '--text', '[ ] x')).code).toBe(2);
    expect((await stack(d, 'retitle', 'tasks/alpha.md:2', '--text', 'X')).code).toBe(2);
  });
  it('is listed in --help', async () => {
    expect((await stack(mk(), '--help')).out).toContain('retitle <ref>');
  });
});

describe('note add', () => {
  it('appends a nested bullet after children and notes', async () => {
    const d = mk();
    const r = await stack(d, 'note', 'add', 'tasks/alpha.md:5', '--text', 'new note', '--expect', '🚨 Old title 🟢');
    expect(r.code).toBe(0);
    expect(lines(d).slice(4, 9)).toEqual(['- [ ] 🚨 Old title 🟢', '  - [ ] Child', '  - old note', '  - new note', '- [x] Done one 🔴']);
  });
  it('nests under a child row one level deeper', async () => {
    const d = mk();
    await stack(d, 'note', 'add', 'tasks/alpha.md:6', '--text', 'kid note');
    expect(lines(d)[6]).toBe('    - kid note');
  });
  it('copies the indent of existing children', async () => {
    const d = mk();
    writeFileSync(join(d, 'tasks/alpha.md'), '# A\n\n## 🔄 Active\n\n- [ ] Top\n    - [ ] Deep child\n');
    await stack(d, 'note', 'add', 'tasks/alpha.md:5', '--text', 'n');
    expect(lines(d)[6]).toBe('    - n');
  });
  it('--expect mismatch is exit 3', async () => {
    const d = mk();
    expect((await stack(d, 'note', 'add', 'tasks/alpha.md:5', '--text', 'n', '--expect', 'nope')).code).toBe(3);
    expect(lines(d)).toEqual(FILE.split('\n'));
  });
  it('usage errors are exit 2', async () => {
    const d = mk();
    expect((await stack(d, 'note', 'add', 'tasks/alpha.md:5')).code).toBe(2);
    expect((await stack(d, 'note', 'add', '--text', 'x')).code).toBe(2);
    expect((await stack(d, 'note', 'add', 'tasks/alpha.md:5', '--text', 'a\nb')).code).toBe(2);
    expect((await stack(d, 'note', 'add', 'tasks/alpha.md:5', '--text', '[ ] sneaky')).code).toBe(2);
    expect((await stack(d, 'note', 'nope', 'tasks/alpha.md:5', '--text', 'x')).code).toBe(2);
  });
});
