/**
 * `stack agent run` against the fake ACP agent. Permission requests land as asks; the test plays the owner and answers them.
 * @req FR:acp-driver/cli.run @req FR:acp-driver/cli.safe @req FR:acp-driver/perm.broker
 */
import { mkdirSync, mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { answerAsk, readAsk } from '../../src/core/asks';
import { FsStorage } from '../../src/core/storage';
import { run } from '../../src/cli/run';

// Jest compiles the ESM-only SDK to CommonJS; the real loader uses a native import().
jest.mock('../../src/agents/acp-sdk', () => ({ loadAcpSdk: () => import('@agentclientprotocol/sdk') }));

const FAKE = join(__dirname, '../fixtures/fake-acp-agent.js');
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-acp-')); mkdirSync(join(d, 'tasks')); return d; };

async function stack(d: string, args: string[]) {
  let out = '', err = '';
  const code = await run(['agent', 'run', ...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

/** Plays the owner: answers every permission ask that shows up. */
function owner(d: string, answer: 'go' | 'no') {
  const ctx = { storage: new FsStorage(d) };
  const seen = new Set<string>();
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      let files: string[] = [];
      try { files = readdirSync(join(d, 'tasks/asks')); } catch { /* not yet */ }
      for (const f of files.filter((x) => x.startsWith('perm-') && x.endsWith('.md'))) {
        const key = f.replace(/\.md$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        await answerAsk(ctx, key, { answer });
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  return { seen, stop: async () => { stop = true; await loop; } };
}

describe('stack agent run', () => {
  it('streams the assistant text and exits 0 on end_turn', async () => {
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'hello']);
    expect(r).toMatchObject({ code: 0, out: 'Hello world\n', err: '' });
  });

  it('prints one JSON object with --json', async () => {
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'hello', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, stopReason: 'end_turn', text: 'Hello world', sessionId: expect.stringMatching(/^fake-/) });
  });

  it('turns a permission request into an ask, waits for the owner, and obeys the answer', async () => {
    const d = dir();
    const o = owner(d, 'go');
    const r = await stack(d, [process.execPath, FAKE, '--prompt', 'ask']);
    await o.stop();
    expect(o.seen.size).toBe(1);
    expect(r.code).toBe(0);
    expect(r.out).toContain('permission=opt-allow');
    expect(r.err).toMatch(/^permission: Run: git push \(ask perm-[a-z0-9._-]+\)$/m);
  });

  it('denies when the owner says no', async () => {
    const d = dir();
    const o = owner(d, 'no');
    const r = await stack(d, [process.execPath, FAKE, '--prompt', 'ask']);
    await o.stop();
    expect(r.out).toContain('permission=opt-reject');
  });

  it('exits 1 with a redacted error when the agent fails', async () => {
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'crash']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error:');
    expect(r.err).toContain('fake agent crashed');
    expect(r.err + r.out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789ab');
  });

  it('exits 1 on a JSON-RPC error and says so in --json', async () => {
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'error', '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, stopReason: 'error' });
    expect(r.out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789ab');
  });

  it('cancels and closes the agent when --timeout expires', async () => {
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'slow', '--timeout', '1']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/timed out|cancelled/);
  });

  it('is a usage error (exit 2) without --prompt, without a command, or with an unknown subcommand', async () => {
    expect((await stack(dir(), [process.execPath, FAKE])).code).toBe(2);
    expect((await stack(dir(), ['--prompt', 'x'])).code).toBe(2);
    let err = '';
    expect(await run(['agent', 'bogus', '--dir', dir(), '--no-commit'], { out: () => undefined, err: (s) => { err += s; } })).toBe(2);
    expect(err).toContain('agent run');
  });

  it('exits 1 when the command does not exist', async () => {
    const r = await stack(dir(), [join(__dirname, 'no-such-binary'), '--prompt', 'x']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error:');
  });
});

/**
 * Cancel, timeout, and crash end cleanly: exit 1, a clear error, no child left, no signal handler left.
 * @req FR:acp-driver/cli.signal @req FR:acp-driver/cli.timeout @req FR:acp-driver/cli.crash @req FR:acp-driver/perm.flow
 */
describe('stack agent run: cancel, timeout, crash', () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const pidOf = (out: string) => Number(/fake-(\d+)/.exec(out)?.[1]);
  const sigints = () => process.listenerCount('SIGINT');
  /** Emits `SIGINT` `times` times, the first as soon as the command listens, then `gapMs` apart. */
  const interrupt = (base: number, times = 1, gapMs = 300) => (async () => {
    while (sigints() <= base) await new Promise((r) => setImmediate(r));
    for (let i = 0; i < times; i++) { if (i) await new Promise((r) => setTimeout(r, gapMs)); process.emit('SIGINT' as never); }
  })();

  it('a timeout closes an agent that ignores session/cancel, within timeout + grace', async () => {
    const t0 = Date.now();
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'stuck', '--timeout', '1', '--json']);
    expect(Date.now() - t0).toBeLessThan(9000);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, stopReason: 'cancelled', error: 'timed out after 1 s' });
    expect(alive(pidOf(r.out))).toBe(false);
  });

  it('SIGINT cancels the run, also before it started, and removes its handler', async () => {
    const base = sigints();
    const sig = interrupt(base);
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'slow']);
    await sig;
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: cancelled (SIGINT)');
    expect(sigints()).toBe(base);
  });

  it('a second SIGINT closes an agent that ignores session/cancel at once', async () => {
    const base = sigints();
    const sig = interrupt(base, 2, 500);
    const t0 = Date.now();
    const r = await stack(dir(), [process.execPath, FAKE, '--prompt', 'stuck', '--json']);
    await sig;
    expect(Date.now() - t0).toBeLessThan(2900);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, stopReason: 'cancelled', error: 'cancelled (SIGINT)' });
    expect(alive(pidOf(r.out))).toBe(false);
  });

  it('an agent that exits while asking: exit 1, the exit code, the stderr tail, and the ask resolved', async () => {
    const d = dir();
    const r = await stack(d, [process.execPath, FAKE, '--prompt', 'ask-die']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: Agent exited (code 4)');
    expect(r.err).toContain('agent stderr: fake agent died mid-ask');
    const keys = readdirSync(join(d, 'tasks/asks')).filter((f) => f.startsWith('perm-'));
    expect(keys).toHaveLength(1);
    await new Promise((res) => setTimeout(res, 100));
    const ask = await readAsk({ storage: new FsStorage(d) }, keys[0].replace(/\.md$/, ''));
    expect(ask?.ask).toMatchObject({ state: 'done', outcome: 'resolved' });
  });
});
