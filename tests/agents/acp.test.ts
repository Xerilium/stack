/**
 * Runs the ACP driver against the fake ACP agent (tests/fixtures/fake-acp-agent.js) over real stdio, with the real SDK.
 * @req FR:acp-driver/conn.spawn @req FR:acp-driver/conn.init @req FR:acp-driver/conn.session @req FR:acp-driver/conn.close
 * @req FR:acp-driver/run.prompt @req FR:acp-driver/run.updates @req FR:acp-driver/run.cancel @req FR:acp-driver/run.errors
 * @req FR:acp-driver/perm.ask @req FR:acp-driver/perm.answer @req NFR:acp-driver/acp.seam @req NFR:acp-driver/acp.lazy @req NFR:acp-driver/acp.log
 */
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { AcpError, createAcpDriver, SessionBusy, type AcpDriverOptions, type AgentDriver, type PermissionAnswer, type PermissionRequest, type Update } from '../../src/agents';

const FAKE = join(__dirname, '../fixtures/fake-acp-agent.js');
const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789ab';

/** Jest compiles `import()` to `require`, which is how the ESM-only SDK is loaded in tests. */
const loadSdk = () => import('@agentclientprotocol/sdk') as never;

const children: ChildProcess[] = [];
const drivers: Array<{ close(): Promise<void> }> = [];
function make(over: Partial<AcpDriverOptions> = {}) {
  const d = createAcpDriver({
    command: process.execPath, args: [FAKE], loadSdk, killAfterMs: 500,
    spawn: ((...a: Parameters<typeof nodeSpawn>) => { const c = nodeSpawn(...a); children.push(c); return c; }) as never,
    ...over,
  });
  drivers.push(d);
  return d;
}
async function collect(d: AgentDriver, text: string, onPermission: (r: PermissionRequest) => Promise<PermissionAnswer> = async () => ({ optionId: 'allow' }), req: { sessionId?: string } = {}) {
  const run = await d.prompt({ cwd: process.cwd(), text, onPermission, ...req });
  const updates: Update[] = [];
  for await (const u of run.updates) updates.push(u);
  return { run, updates, done: updates[updates.length - 1] as Extract<Update, { type: 'done' }> };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

afterEach(async () => { await Promise.all(drivers.splice(0).map((d) => d.close())); children.length = 0; delete process.env.GH_TOKEN; });

describe('conn', () => {
  it('does not spawn until the first prompt, and keeps secrets out of the child environment', async () => {
    process.env.GH_TOKEN = SECRET;
    process.env.GITHUB_TOKEN = SECRET;
    const d = make({ env: { FAKE_FLAG: 'yes' } });
    expect(children).toHaveLength(0);
    const { done, updates } = await collect(d, 'env');
    expect(children).toHaveLength(1);
    const text = updates.filter((u) => u.type === 'message_chunk').map((u) => (u as { text: string }).text).join('');
    expect(text).toContain('GH_TOKEN=unset');
    expect(text).toContain('FAKE_FLAG=yes');
    expect(done.stopReason).toBe('end_turn');
    delete process.env.GITHUB_TOKEN;
  });

  it('fails with AcpError when the agent speaks a protocol version the driver does not support', async () => {
    const d = make({ env: { FAKE_ACP_VERSION: '99' } });
    await expect(d.prompt({ cwd: process.cwd(), text: 'hi', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(AcpError);
    await d.close();
  });

  it('fails with AcpError when the agent does not answer initialize in time', async () => {
    const d = make({ args: ['-e', 'setInterval(() => {}, 1000)'], startTimeoutMs: 200 });
    await expect(d.prompt({ cwd: process.cwd(), text: 'hi', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(/did not answer|timed out/i);
  });

  it('fails with AcpError when the command does not exist', async () => {
    const d = make({ command: join(__dirname, 'no-such-agent-binary'), args: [] });
    await expect(d.prompt({ cwd: process.cwd(), text: 'hi', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(AcpError);
  });

  it('creates a session once, reuses it by id, and refuses an unknown id', async () => {
    const d = make();
    const first = await collect(d, 'one');
    const sid = (first.updates[0] as { sessionId: string }).sessionId;
    expect(first.updates[0]).toEqual({ type: 'session', sessionId: sid });
    expect(first.run.sessionId).toBe(sid);
    const second = await collect(d, 'two', undefined, { sessionId: sid });
    expect(second.updates.some((u) => u.type === 'session')).toBe(false);
    expect(second.done.stopReason).toBe('end_turn');
    await expect(d.prompt({ sessionId: 'nope', text: 'x', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(AcpError);
    expect((await d.listSessions()).map((s) => s.id)).toEqual([sid]);
  });

  it('close ends the child, is idempotent, and fails later prompts', async () => {
    const d = make();
    await collect(d, 'hi');
    const pid = children[0].pid!;
    expect(alive(pid)).toBe(true);
    await d.close();
    await d.close();
    expect(alive(pid)).toBe(false);
    await expect(d.prompt({ cwd: process.cwd(), text: 'again', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(AcpError);
  });

  it('kills a child that ignores stdin closing', async () => {
    const d = make({ args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], startTimeoutMs: 300 });
    await expect(d.prompt({ cwd: process.cwd(), text: 'hi', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(AcpError);
    await d.close();
    expect(alive(children[0].pid!)).toBe(false);
  });
});

describe('run', () => {
  it('streams session, text chunks, tool call and update, then done with the joined text', async () => {
    const d = make();
    const { updates, done } = await collect(d, 'ask');
    expect(updates.map((u) => u.type)).toEqual(['session', 'message_chunk', 'tool_call', 'permission', 'message_chunk', 'tool_update', 'message_chunk', 'done']);
    expect(updates.find((u) => u.type === 'tool_call')).toMatchObject({ callId: 't1', title: 'Run: git push', kind: 'execute', status: 'pending' });
    expect(updates.find((u) => u.type === 'tool_update')).toMatchObject({ callId: 't1', status: 'completed', output: 'pushed' });
    expect(done).toMatchObject({ stopReason: 'end_turn', text: 'Hello permission=opt-allow world', cost: { usd: 0, tokens: 0 } });
  });

  it('ignores update types outside the driver vocabulary: thoughts, plans and non-text chunks never reach the stream', async () => {
    const d = make();
    const { updates, done } = await collect(d, 'think');
    expect(updates.map((u) => u.type)).toEqual(['session', 'message_chunk', 'message_chunk', 'done']);
    expect(done.text).toBe('Hello world');
    expect(JSON.stringify(updates)).not.toContain('Weighing the options.');
    expect(JSON.stringify(updates)).not.toContain('Answer the prompt');
  });

  it('clips tool output to 4000 characters', async () => {
    const d = make();
    const { updates } = await collect(d, 'big');
    const tool = updates.find((u) => u.type === 'tool_update') as { output: string };
    expect(tool.output).toHaveLength(4000);
  });

  it('returns the run at once and refuses a second prompt on a busy session', async () => {
    const d = make();
    const run = await d.prompt({ cwd: process.cwd(), text: 'slow', onPermission: async () => ({ optionId: 'allow' }) });
    const it = run.updates[Symbol.asyncIterator]();
    const sid = ((await it.next()).value as { sessionId: string }).sessionId;
    await expect(d.prompt({ sessionId: sid, text: 'again', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(SessionBusy);
    await d.cancel(run.id);
    for (let r = await it.next(); !r.done; r = await it.next()) { /* drain */ }
  });

  it('cancel sends session/cancel and the run ends cancelled; a second cancel is false', async () => {
    const d = make();
    const run = await d.prompt({ cwd: process.cwd(), text: 'slow', onPermission: async () => ({ optionId: 'allow' }) });
    const updates: Update[] = [];
    const reading = (async () => { for await (const u of run.updates) updates.push(u); })();
    await new Promise((r) => setTimeout(r, 200));
    expect(await d.cancel(run.id)).toBe(true);
    await reading;
    expect(updates[updates.length - 1]).toMatchObject({ type: 'done', stopReason: 'cancelled' });
    expect(await d.cancel(run.id)).toBe(false);
    expect(await d.cancel('unknown')).toBe(false);
  });

  it('maps ACP stop reasons other than end_turn and cancelled to error', async () => {
    const d = make();
    expect((await collect(d, 'refusal')).done).toMatchObject({ stopReason: 'error', error: expect.stringContaining('refusal') });
  });

  it('ends the run with a redacted error when session/prompt fails', async () => {
    const d = make();
    const { done } = await collect(d, 'error');
    expect(done.stopReason).toBe('error');
    expect(done.error).toContain('Internal error');
    expect(done.error).not.toContain(SECRET);
  });

  it('fails the run (not the stream) when the agent exits mid-run, without leaking its stderr', async () => {
    const d = make();
    const { done } = await collect(d, 'crash');
    expect(done.stopReason).toBe('error');
    expect(JSON.stringify(done)).not.toContain(SECRET);
    const next = d.prompt({ cwd: process.cwd(), text: 'hi', onPermission: async () => ({ optionId: 'allow' }) });
    await expect(next).rejects.toThrow(AcpError);
  });
});

describe('perm', () => {
  const output = (u: Update[]) => u.find((x) => x.type === 'tool_update') as { status: string; output: string };

  it('passes a redacted request to onPermission and emits a permission update', async () => {
    const d = make();
    const seen: PermissionRequest[] = [];
    const { updates } = await collect(d, 'ask', async (r) => { seen.push(r); return { optionId: 'allow' }; });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ callId: 't1', title: 'Run: git push', input: { command: 'git push' } });
    expect(seen[0].options).toEqual([
      { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' },
    ]);
    expect(updates.find((u) => u.type === 'permission')).toMatchObject({ requestId: seen[0].requestId, callId: 't1', title: 'Run: git push' });
  });

  it('maps the broker ids allow and deny to the first offered option of that kind', async () => {
    expect(output((await collect(make(), 'ask', async () => ({ optionId: 'allow' }))).updates)).toMatchObject({ status: 'completed', output: 'pushed' });
    expect(output((await collect(make(), 'ask', async () => ({ optionId: 'deny', message: 'no' }))).updates)).toMatchObject({ status: 'failed', output: 'denied' });
  });

  it('returns an offered option id as is', async () => {
    const { done } = await collect(make(), 'ask', async () => ({ optionId: 'opt-reject' }));
    expect(done.text).toContain('permission=opt-reject');
  });

  it('cancels the permission when the id is unknown or onPermission throws: a failure never allows', async () => {
    const unknown = await collect(make(), 'ask', async () => ({ optionId: 'something-else' }));
    expect(unknown.done.text).toContain('permission=cancelled');
    const thrown = await collect(make(), 'ask', async () => { throw new Error('boom'); });
    expect(thrown.done.text).toContain('permission=cancelled');
    expect(output(thrown.updates).status).toBe('failed');
  });
});

describe('seam', () => {
  it('importing src/agents does not load the ACP SDK or spawn anything', () => {
    jest.isolateModules(() => {
      jest.doMock('@agentclientprotocol/sdk', () => { throw new Error('SDK loaded at import time'); });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous load
      expect(() => require('../../src/agents')).not.toThrow();
    });
    jest.dontMock('@agentclientprotocol/sdk');
  });
});
