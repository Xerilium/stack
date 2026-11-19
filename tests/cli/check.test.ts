/** @req FR:product-reset/cli.check */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const FILE = '# F4\n\n## Active\n\n- [ ] 🙋 Answer the acks\n  - Done when: All threads answered\n  - Context: The acks pick the cut\n- [ ] 🙋 🤖 Launch prep 🟢\n';
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-check-')); mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks/f4.md'), FILE); return d; };
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack check', () => {
  it('exits 0 at score 4 and prints the score', async () => {
    const d = dir();
    const r = await stack(d, 'check', 'tasks/f4.md:5');
    expect(r.code).toBe(0);
    expect(r.out).toBe('tasks/f4.md:5 4/4 actionable\n');
    expect(JSON.parse((await stack(d, 'check', 'tasks/f4.md:5', '--json')).out)).toEqual({ ok: true, ref: 'tasks/f4.md:5', score: 4, actionable: true, missing: [] });
  });

  it('exits 1 below score 4 and names the missing checks', async () => {
    const d = dir();
    const r = await stack(d, 'check', 'tasks/f4.md:8');
    expect(r.code).toBe(1);
    expect(r.out).toBe('tasks/f4.md:8 1/4 missing: doneWhen, context, single\n');
    const j = await stack(d, 'check', 'tasks/f4.md:8', '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out)).toEqual({ ok: true, ref: 'tasks/f4.md:8', score: 1, actionable: false, missing: ['doneWhen', 'context', 'single'] });
  });

  it('never writes the file', async () => {
    const d = dir();
    await stack(d, 'check', 'tasks/f4.md:8');
    expect(readFileSync(join(d, 'tasks/f4.md'), 'utf8')).toBe(FILE);
  });

  it('needs a ref that points at a task row', async () => {
    const d = dir();
    expect((await stack(d, 'check')).code).toBe(2);
    expect((await stack(d, 'check', 'tasks/f4.md:1')).code).not.toBe(0);
    expect((await stack(d, 'check', 'tasks/nope.md:5')).code).not.toBe(0);
  });
});
