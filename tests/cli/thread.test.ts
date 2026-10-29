/** @req FR:agent-thread/ask.cli @req FR:agent-thread/reply.entry */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-thread-')); mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks/f4.md'), '# F4\n\n## Active\n\n- [ ] Ship\n'); return d; };
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack asks put --ref and stack inbox reply', () => {
  it('puts an ask on a task and replies as an agent', async () => {
    const d = dir();
    expect((await stack(d, 'asks', 'put', 'q1', '--ask', 'Which cover?', '--kind', 'answer', '--from', 'cid', '--ref', 'tasks/f4.md:5')).out).toBe('q1\n');
    expect(readFileSync(join(d, 'tasks/asks/q1.md'), 'utf8')).toContain('- ref: tasks/f4.md:5');
    expect((await stack(d, 'asks', 'put', 'q2', '--ask', 'x', '--kind', 'answer', '--from', 'cid', '--ref', 'tasks/f4.md:99')).code).toBe(2);
    const r = await stack(d, 'inbox', 'reply', 'tasks/f4.md:5', '--from', 'cid', '--text', 'On it.');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^in-/);
    const inbox = readFileSync(join(d, 'tasks/inbox/f4.md'), 'utf8');
    expect(inbox).toContain('- from: agent\n- agent: cid');
    expect(inbox).toContain('- text: On it.');
    expect((await stack(d, 'inbox', 'reply', 'tasks/f4.md:5', '--text', 'x')).code).toBe(2);
    expect((await stack(d, 'inbox', 'nope')).code).toBe(2);
  });
});
