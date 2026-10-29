/** @req FR:agent-sessions/perm.ask @req FR:agent-sessions/perm.answer @req FR:agent-sessions/perm.timeout */
import { createPermissionBroker, permKey, type PermissionRequest } from '../../src/agents';
import { answerAsk, listAsks } from '../../src/core/asks';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T10:00:00Z');
const req = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'req-1', callId: 'tu1', tool: 'Bash', title: 'Allow Bash: git push origin main', input: { command: 'git push origin main', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789ab' },
  options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'allow-session', name: 'Allow for this session', kind: 'allow_always' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }],
  ...over,
});
const session = { id: 'a1b2c3d4-0000-0000-0000-000000000002', title: 'stack: fix parser', cwd: '/Users/me/dev/stack' };

function mk() {
  const storage = new MemoryStorage();
  let t = NOW.getTime();
  const clock = { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
  const ctx = { storage, now: clock.now };
  const broker = createPermissionBroker(ctx, { pollMs: 5, timeoutMs: 10 * 60_000 });
  return { storage, ctx, clock, broker };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('permission broker', () => {
  it('writes an ask with the title, why, options, recommendation, default, and deadline', async () => {
    const { ctx, broker } = mk();
    const pending = broker.ask(session, req(), 'run-1');
    await wait(10);
    const { items } = await listAsks(ctx);
    expect(items).toHaveLength(1);
    const a = items[0];
    expect(a.key).toBe(permKey(session.id, 'req-1'));
    expect(a.key).toBe('perm-a1b2c3d4-req-1');
    expect(a).toMatchObject({ kind: 'decide', from: 'session:stack: fix parser', project: 'stack', ask: 'Allow Bash: git push origin main', options: ['Allow once', 'Allow for this session', 'Deny'], recommend: 'Allow once', default: 'Denied; the agent continues without it', reversible: true, priority: 'high', effort: '1m' });
    expect(a.why).toContain('git push origin main');
    expect(a.why).not.toContain('ghp_');
    expect(a.detail).toContain('"command"');
    expect(a.detail).not.toContain('ghp_');
    expect(a.by).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString());
    await answerAsk(ctx, a.key, { answer: 'option', text: 'Allow once' });
    expect(await pending).toEqual({ optionId: 'allow' });
    expect((await listAsks(ctx, { state: 'done' })).items[0]).toMatchObject({ key: a.key, outcome: 'handled', note: 'Allow once' });
  });
  it('a risky request recommends Deny', async () => {
    const { ctx, broker } = mk();
    const p = broker.ask(session, req({ risky: true }), 'run-1');
    await wait(10);
    const a = (await listAsks(ctx)).items[0];
    expect(a.recommend).toBe('Deny');
    await answerAsk(ctx, a.key, { answer: 'option', text: 'Deny' });
    expect(await p).toEqual({ optionId: 'deny' });
  });
  it('no, reply, and ask answers deny; the owner words reach the agent', async () => {
    const { ctx, broker } = mk();
    for (const [answer, text, want] of [['no', undefined, 'Denied by the owner'], ['reply', 'Not on main, use a branch', 'Not on main, use a branch'], ['ask', 'Why push now?', 'Why push now?']] as const) {
      const p = broker.ask(session, req({ requestId: `r-${answer}` }), 'run-1');
      await wait(10);
      const a = (await listAsks(ctx)).items.find((x) => x.key.endsWith(`r-${answer}`))!;
      await answerAsk(ctx, a.key, { answer, ...(text ? { text } : {}) });
      expect(await p).toEqual({ optionId: 'deny', message: want });
    }
  });
  it('allow-session remembers the tool for the run and does not ask again', async () => {
    const { ctx, broker } = mk();
    const p = broker.ask(session, req(), 'run-1');
    await wait(10);
    await answerAsk(ctx, (await listAsks(ctx)).items[0].key, { answer: 'option', text: 'Allow for this session' });
    expect(await p).toEqual({ optionId: 'allow-session' });
    expect(await broker.ask(session, req({ requestId: 'req-2' }), 'run-1')).toEqual({ optionId: 'allow' });
    expect((await listAsks(ctx, { state: 'all' })).items).toHaveLength(1);
    const other = broker.ask(session, req({ requestId: 'req-3' }), 'run-2');
    await wait(10);
    expect((await listAsks(ctx)).items).toHaveLength(1);
    broker.release('run-2');
    expect(await other).toEqual({ optionId: 'deny', message: 'Run cancelled' });
    expect((await listAsks(ctx, { state: 'done' })).items.find((x) => x.key.endsWith('req-3'))).toMatchObject({ outcome: 'resolved' });
  });
  it('times out to deny and marks the ask defaulted', async () => {
    const { ctx, broker, clock } = mk();
    const p = broker.ask(session, req(), 'run-1');
    await wait(10);
    clock.advance(11 * 60_000);
    expect(await p).toEqual({ optionId: 'deny', message: 'No answer in 10 minutes' });
    expect((await listAsks(ctx, { state: 'done' })).items[0]).toMatchObject({ outcome: 'defaulted' });
  });
  it('open() lists sessions with an open permission ask', async () => {
    const { ctx, broker } = mk();
    const p = broker.ask(session, req(), 'run-1');
    await wait(10);
    expect(await broker.open()).toEqual(new Set([session.id]));
    await answerAsk(ctx, (await listAsks(ctx)).items[0].key, { answer: 'option', text: 'Deny' });
    await p;
    expect(await broker.open()).toEqual(new Set());
  });
});
