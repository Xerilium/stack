/** `stack inbox run` with an injected runner: no process, no model. @req FR:agent-delivery/cli.run @req FR:agent-inbox/cli.deliver */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { inboxRunCmd } from '../../src/cli/delivery';
import { putAgent } from '../../src/core/agents';
import { listInbox, sendToInbox } from '../../src/core/inbox';
import { MemoryStorage } from '../../src/core/storage';
import type { Runner } from '../../src/email/llm';

const F = '# Alpha\n\n## Active\n\n- [ ] 🤖 Ship it\n';
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'stack-inbox-run-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const runner = (loggedIn: boolean): Runner => async (_c, args) => args[0] === 'auth'
  ? { code: loggedIn ? 0 : 1, stdout: JSON.stringify({ loggedIn }), stderr: '' }
  : { code: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'Done.' }), stderr: '' };

async function mk() {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', F);
  const ctx = { storage, now: () => new Date('2026-11-12T10:00:00Z') };
  await putAgent(ctx, 'ace', { name: 'Ace', scope: ['alpha'] });
  const e = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 4 }, 'Go', 'instruction');
  return { ctx, e };
}

describe('stack inbox run', () => {
  it('runs one pass and prints a line per entry', async () => {
    // @req FR:agent-delivery/cli.run
    const { ctx, e } = await mk();
    const r = await inboxRunCmd(ctx, { once: true }, { repo: '/r', run: runner(true), home, isRepo: () => false });
    expect(r.code).toBe(0);
    expect(r.text).toBe(`${e.id} delivered ace`);
    expect(r.json).toMatchObject({ ok: true, login: 'ok', items: [{ id: e.id, state: 'delivered' }] });
    expect(await listInbox(ctx)).toEqual([]);
  });

  it('exits 1 and names the step when the login expired', async () => {
    const { ctx, e } = await mk();
    const r = await inboxRunCmd(ctx, {}, { repo: '/r', run: runner(false), home, isRepo: () => false });
    expect(r.code).toBe(1);
    expect(r.text).toBe(`${e.id} not-delivered ace Claude login expired\nClaude login expired: run claude auth login`);
  });

  it('watches until stopped', async () => {
    const { ctx } = await mk();
    const ac = new AbortController();
    const seen: string[] = [];
    const p = inboxRunCmd(ctx, { watch: true }, { repo: '/r', run: runner(true), home, isRepo: () => false, signal: ac.signal, intervalMs: 5, out: (l) => { seen.push(l); ac.abort(); } });
    const r = await p;
    expect(seen).toHaveLength(1);
    expect(r.code).toBe(0);
  });

  it('prints no text lines when watching with --json', async () => {
    const { ctx } = await mk();
    const ac = new AbortController();
    const seen: string[] = [];
    setTimeout(() => ac.abort(), 30);
    const r = await inboxRunCmd(ctx, { watch: true, json: true }, { repo: '/r', run: runner(true), home, isRepo: () => false, signal: ac.signal, intervalMs: 5, out: (l) => { seen.push(l); } });
    expect(seen).toEqual([]);
    expect((r.json.items as unknown[]).length).toBe(1);
  });

  it('refuses --once with --watch', async () => {
    const { ctx } = await mk();
    await expect(inboxRunCmd(ctx, { once: true, watch: true }, { repo: '/r', home })).rejects.toThrow('--once or --watch');
  });
});
