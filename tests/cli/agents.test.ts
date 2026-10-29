/** @req FR:agent-team/cli.agents */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-agents-')); mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks/f4.md'), '# F4\n\n- **Agents:**\n  - `🎧 Cid Manager` — label manager\n\n## Active\n\n- [ ] Ship\n'); return d; };
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack agents', () => {
  it('add writes the file; list shows files and metadata agents, scoped by project', async () => {
    const d = dir();
    writeFileSync(join(d, 'prompt.md'), 'Read the charter first.');
    const add = await stack(d, 'agents', 'add', 'cos', '--name', 'CoS', '--scope', '*', '--role', 'Roll-up', '--mode', 'long-running', '--model', 'sonnet', '--tools', 'Read,Bash', '--prompt-file', join(d, 'prompt.md'));
    expect(add).toMatchObject({ code: 0, out: 'added cos\n' });
    const raw = readFileSync(join(d, 'tasks/agents/cos.md'), 'utf8');
    expect(raw).toContain('- scope: *');
    expect(raw).toContain('- tools: Read, Bash');
    expect(raw).toContain('Read the charter first.');
    expect((await stack(d, 'agents', 'add', 'cos', '--role', 'Boss')).out).toBe('updated cos\n');
    const list = await stack(d, 'agents', 'list');
    expect(list.out).toBe('cos  CoS  *\ncid-manager  🎧 Cid Manager  f4  (metadata only)\n');
    const f4 = await stack(d, 'agents', 'list', '--project', 'f4', '--json');
    expect(JSON.parse(f4.out).items.map((a: { slug: string }) => a.slug)).toEqual(['cid-manager', 'cos']);
    expect((await stack(d, 'agents', 'add', 'x', '--name', 'X', '--mode', 'weird')).code).toBe(2);
    expect((await stack(d, 'agents', 'add', 'Bad Slug', '--name', 'X')).code).toBe(2);
    expect((await stack(d, 'agents', 'nope')).code).toBe(2);
  });
});
