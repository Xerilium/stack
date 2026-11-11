/**
 * End to end: the ACP driver against the fake agent, its permission requests through the broker into the ask queue,
 * the owner's answer back to the agent. Storage is in memory; the agent is a real child process over stdio.
 * @req FR:acp-driver/perm.flow @req FR:acp-driver/perm.risky @req FR:acp-driver/perm.broker
 */
import { join } from 'path';
import { createAcpDriver, createPermissionBroker, permKey, type AcpDriver, type PermissionBroker, type Update } from '../../src/agents';
import { answerAsk, listAsks, readAsk, type AnswerInput } from '../../src/core/asks';
import { MemoryStorage } from '../../src/core/storage';
import { setup } from '../security/helpers';

const FAKE = join(__dirname, '../fixtures/fake-acp-agent.js');
const loadSdk = () => import('@agentclientprotocol/sdk') as never;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const drivers: AcpDriver[] = [];
afterEach(async () => { await Promise.all(drivers.splice(0).map((d) => d.close())); });

function mk(timeoutMs = 60_000) {
  const ctx = { storage: new MemoryStorage() };
  const broker = createPermissionBroker(ctx, { pollMs: 20, timeoutMs });
  const driver = createAcpDriver({ command: process.execPath, args: [FAKE], loadSdk, killAfterMs: 500 });
  drivers.push(driver);
  return { ctx, broker, driver };
}

/** Starts a run whose permissions go through the broker, like `stack agent run` does. */
async function start(m: ReturnType<typeof mk>, text: string) {
  let sessionId = '';
  let runId = '';
  const run = await m.driver.prompt({ cwd: process.cwd(), text, onPermission: (req) => (m.broker as PermissionBroker).ask({ id: sessionId, title: 'agent:fake', cwd: process.cwd() }, req, runId) });
  runId = run.id; sessionId = run.sessionId ?? '';
  const updates: Update[] = [];
  const done = (async () => { for await (const u of run.updates) { updates.push(u); } m.broker.release(runId); return updates[updates.length - 1] as Extract<Update, { type: 'done' }>; })();
  return { run, updates, done };
}

/** Waits for the one permission ask of the run to land on disk. */
async function theAsk(m: ReturnType<typeof mk>) {
  for (let i = 0; i < 200; i++) {
    const a = (await listAsks(m.ctx, { state: 'all' })).items.find((x) => x.key.startsWith('perm-'));
    if (a) return a;
    await wait(20);
  }
  throw new Error('no permission ask');
}
const answer = async (m: ReturnType<typeof mk>, input: AnswerInput) => { const a = await theAsk(m); await answerAsk(m.ctx, a.key, input); return a.key; };
const stateOf = async (m: ReturnType<typeof mk>, key: string) => (await readAsk(m.ctx, key))?.ask;

describe('permission request to ask to agent', () => {
  it('puts the ask with the request, and the owner go resumes the agent with the first option', async () => {
    const m = mk();
    const s = await start(m, 'ask');
    const a = await theAsk(m);
    expect(a.key).toBe(permKey(s.run.sessionId as string, a.key.split('-').pop() as string));
    expect(a.key).toMatch(/^perm-fake-\d+-[0-9a-f]{8}$/);
    expect(a).toMatchObject({ state: 'open', kind: 'decide', ask: 'Run: git push', options: ['Allow once', 'Reject'] });
    expect(a.why).toContain('git push');
    expect(a.by).toBeTruthy();
    await answerAsk(m.ctx, a.key, { answer: 'go' });
    const done = await s.done;
    expect(done).toMatchObject({ stopReason: 'end_turn', text: expect.stringContaining('permission=opt-allow') });
    expect(await stateOf(m, a.key)).toMatchObject({ state: 'done', outcome: 'handled' });
  });

  it('an option name picks that option', async () => {
    const m = mk();
    const s = await start(m, 'ask');
    const key = await answer(m, { answer: 'option', text: 'Reject' });
    expect((await s.done).text).toContain('permission=opt-reject');
    expect(await stateOf(m, key)).toMatchObject({ state: 'done', outcome: 'handled', note: 'Reject' });
  });

  it('no and a reply deny', async () => {
    for (const input of [{ answer: 'no' }, { answer: 'reply', text: 'not now' }] as AnswerInput[]) {
      const m = mk();
      const s = await start(m, 'ask');
      await answer(m, input);
      expect((await s.done).text).toContain('permission=opt-reject');
    }
  });

  it('no answer by the deadline denies and marks the ask defaulted', async () => {
    const m = mk(300);
    const s = await start(m, 'ask');
    const a = await theAsk(m);
    expect((await s.done).text).toContain('permission=opt-reject');
    expect(await stateOf(m, a.key)).toMatchObject({ state: 'done', outcome: 'defaulted' });
  });

  it('a cancelled run resolves its open ask and the agent gets cancelled', async () => {
    const m = mk();
    const s = await start(m, 'ask');
    const a = await theAsk(m);
    expect(await m.driver.cancel(s.run.id)).toBe(true);
    const done = await s.done;
    expect(done.stopReason).toBe('cancelled');
    await wait(50);
    expect(await stateOf(m, a.key)).toMatchObject({ state: 'done', outcome: 'resolved' });
  });

  it('an agent that dies while asking ends the run with an error and resolves the ask', async () => {
    const m = mk();
    const s = await start(m, 'ask-die');
    const a = await theAsk(m);
    const done = await s.done;
    expect(done).toMatchObject({ stopReason: 'error', error: expect.stringContaining('code 4') });
    await wait(50);
    expect(await stateOf(m, a.key)).toMatchObject({ state: 'done', outcome: 'resolved' });
  });
});

describe('failure never allows', () => {
  it('an ask that cannot be written denies the request (cancelled), and the run goes on', async () => {
    const m = mk();
    m.ctx.storage.write = async () => { throw new Error('disk full'); };
    const s = await start(m, 'ask');
    const done = await s.done;
    expect(done).toMatchObject({ stopReason: 'end_turn', text: expect.stringContaining('permission=cancelled') });
    expect(done.text).not.toContain('opt-allow');
  });
});

describe('owner-only perm-* writes (security review H4)', () => {
  it('the broker writes perm-* asks as Stack; the owner answers them through the API and the agent resumes', async () => {
    const api = setup();
    const broker = createPermissionBroker({ storage: api.storage }, { pollMs: 20 });
    const driver = createAcpDriver({ command: process.execPath, args: [FAKE], loadSdk, killAfterMs: 500 });
    drivers.push(driver);
    const m = { ctx: { storage: api.storage }, broker, driver } as unknown as ReturnType<typeof mk>;
    const s = await start(m, 'ask');
    const a = await theAsk(m);
    expect(a.from).toBe('session:agent:fake');
    const r = await api.call('POST', `/api/asks/${a.key}/answer`, { session: true, body: { answer: 'go' } });
    expect(r.status).toBe(200);
    expect((await s.done).text).toContain('permission=opt-allow');
  });
});

describe('risky', () => {
  it('an execute tool is risky: the ask recommends Deny', async () => {
    const m = mk();
    const s = await start(m, 'ask');
    expect((await theAsk(m)).recommend).toBe('Deny');
    await m.driver.cancel(s.run.id); await s.done;
  });

  it('a read tool is not risky: the ask recommends the first option', async () => {
    const m = mk();
    const s = await start(m, 'ask-read');
    expect((await theAsk(m)).recommend).toBe('Allow once');
    await m.driver.cancel(s.run.id); await s.done;
  });
});
