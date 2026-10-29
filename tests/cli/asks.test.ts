/** @req FR:ask-queue/cli.put @req FR:ask-queue/cli.list @req FR:ask-queue/cli.handle */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';
import { answerAsk } from '../../src/core/asks';
import { FsStorage } from '../../src/core/storage';

const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-asks-')); mkdirSync(join(d, 'tasks')); return d; };
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack asks', () => {
  it('put writes the ask file and prints the key; list ranks; handle closes', async () => {
    const d = dir();
    writeFileSync(join(d, 'detail.md'), 'Remaining risk: keyboard pass.');
    const put = await stack(d, 'asks', 'put', 'pr-879-approve', '--ask', 'Approve merging PR 879', '--kind', 'approve', '--from', 'allyte-cos', '--recommend', 'Approve', '--default', 'Merges at 8am', '--by', '2026-10-29T15:00:00Z', '--reversible', 'yes', '--link', 'https://github.com/o/r/pull/879', '--priority', 'high', '--effort', '2m', '--blocks', '3', '--detail-file', join(d, 'detail.md'));
    expect(put).toMatchObject({ code: 0, out: 'pr-879-approve\n' });
    const raw = readFileSync(join(d, 'tasks/asks/pr-879-approve.md'), 'utf8');
    expect(raw).toContain('- ask: Approve merging PR 879');
    expect(raw).toContain('Remaining risk: keyboard pass.');
    await stack(d, 'asks', 'put', 'low-one', '--ask', 'Rename the repo', '--kind', 'go-do', '--from', 'cos', '--priority', 'low');
    const list = await stack(d, 'asks', 'list', '--now', '2026-10-28T18:00:00Z');
    const lines = list.out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^pr-879-approve\s+\d+\s+Approve merging PR 879$/);
    const json = JSON.parse((await stack(d, 'asks', 'list', '--json')).out);
    expect(json.items[0]).toMatchObject({ key: 'pr-879-approve', rank: 1 });
    await answerAsk({ storage: new FsStorage(d) }, 'pr-879-approve', { answer: 'go' });
    expect((await stack(d, 'asks', 'list', '--state', 'answered')).out).toContain('pr-879-approve');
    const h = await stack(d, 'asks', 'handle', 'pr-879-approve', '--outcome', 'handled', '--note', 'merged');
    expect(h).toMatchObject({ code: 0, out: 'handled pr-879-approve\n' });
    expect((await stack(d, 'asks', 'handle', 'pr-879-approve', '--outcome', 'handled')).out).toBe('no change: pr-879-approve\n');
    expect((await stack(d, 'asks', 'list', '--state', 'done')).out).toContain('pr-879-approve');
  });
  it('rejects bad input with a usage or lifecycle error', async () => {
    const d = dir();
    expect((await stack(d, 'asks')).code).toBe(2);
    expect((await stack(d, 'asks', 'nope')).code).toBe(2);
    expect((await stack(d, 'asks', 'put', 'k', '--kind', 'approve', '--from', 'cos')).code).toBe(2);
    expect((await stack(d, 'asks', 'put', 'k', '--ask', 'x', '--kind', 'approve')).code).toBe(2); // --from is required
    expect((await stack(d, 'asks', 'put', 'Bad Key', '--ask', 'x', '--kind', 'approve', '--from', 'cos')).code).toBe(2);
    expect((await stack(d, 'asks', 'put', 'k', '--ask', 'x', '--kind', 'approve', '--from', 'cos', '--blocks', 'many')).code).toBe(2);
    expect((await stack(d, 'asks', 'handle', 'missing', '--outcome', 'handled')).code).toBe(2);
    expect((await stack(d, 'asks', 'put', 'k', '--ask', 'x', '--kind', 'approve', '--from', 'cos', '--bogus', '1')).code).toBe(2);
  });
});
