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
    expect(readFileSync(join(d, 'tasks/asks/q1.md'), 'utf8')).toContain('- ref: f4:4');
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

/** @req FR:agent-inbox/cli.list @req FR:agent-inbox/cli.handle */
describe('stack inbox list and handle', () => {
  it('lists open instructions and closes one with a note', async () => {
    const d = dir();
    mkdirSync(join(d, 'tasks/inbox'));
    writeFileSync(join(d, 'tasks/inbox/f4.md'), [
      '# F4 inbox', '',
      '## in-20261028T140311Z-3f9a', '', '- at: 2026-10-28T14:03:11.000Z', '- state: open', '- kind: instruction', '- to: agent', '- ref: tasks/f4.md:5', '- task: Ship', '- text: Use the new logo', '',
      '## in-20261028T140312Z-3f9b', '', '- at: 2026-10-28T14:03:12.000Z', '- state: handled', '- kind: reply', '- to: agent', '- ref: tasks/f4.md:5', '- task: Ship', '- text: Old', '- handled: 2026-10-28T15:00:00.000Z by cid', '',
    ].join('\n'));
    const l = await stack(d, 'inbox', 'list');
    expect(l.code).toBe(0);
    expect(l.out).toBe('in-20261028T140311Z-3f9a instruction f4 tasks/f4.md:5 Use the new logo\n');
    const j = JSON.parse((await stack(d, 'inbox', 'list', '--project', 'f4', '--state', 'all', '--json')).out);
    expect(j.items.map((e: { id: string; row?: string }) => [e.id, e.row])).toEqual([['in-20261028T140311Z-3f9a', 'tasks/f4.md:5'], ['in-20261028T140312Z-3f9b', 'tasks/f4.md:5']]);
    expect((await stack(d, 'inbox', 'list', '--project', 'other')).out).toBe('');
    expect((await stack(d, 'inbox', 'list', '--state', 'nope')).code).toBe(2);
    const h = await stack(d, 'inbox', 'handle', 'in-20261028T140311Z-3f9a', '--note', 'Logo swapped in PR 12', '--from', 'cid');
    expect(h.code).toBe(0);
    expect(h.out).toBe('handled\n');
    const f = readFileSync(join(d, 'tasks/inbox/f4.md'), 'utf8');
    expect(f).toMatch(/- state: handled\n- kind: instruction[\s\S]*- handled: \S+ by cid\n- note: Logo swapped in PR 12/);
    expect((await stack(d, 'inbox', 'handle', 'in-20261028T140311Z-3f9a')).out).toBe('unchanged\n');
    expect((await stack(d, 'inbox', 'handle', 'in-20261028T140399Z-ffff')).code).toBe(2);
    expect((await stack(d, 'inbox', 'handle')).code).toBe(2);
    expect((await stack(d, 'inbox', 'list')).out).toBe('');
  });
  // @req FR:agent-inbox/cli.list: a withdrawn entry shows only with --all
  it('hides withdrawn entries unless --all', async () => {
    const d = dir();
    mkdirSync(join(d, 'tasks/inbox'));
    writeFileSync(join(d, 'tasks/inbox/f4.md'), ['# F4 inbox', '', '## in-20261028T140311Z-3f9a', '', '- at: 2026-10-28T14:03:11.000Z', '- state: handled', '- kind: instruction', '- to: agent', '- ref: tasks/f4.md:5', '- task: Ship', '- text: Oops', '- handled: 2026-10-28T14:03:15.000Z by owner', '- withdrawn: true', ''].join('\n'));
    expect((await stack(d, 'inbox', 'list', '--state', 'all')).out).toBe('');
    expect((await stack(d, 'inbox', 'list', '--state', 'all', '--all')).out).toBe('in-20261028T140311Z-3f9a instruction f4 tasks/f4.md:5 Oops\n');
  });
});
