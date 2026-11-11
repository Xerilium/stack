/**
 * Opt-in: the ACP driver against a real agent. Skipped unless STACK_ACP_AGENT holds the agent command line, for example
 * `STACK_ACP_AGENT="gemini --acp" pnpm exec jest tests/agents/acp-real.test.ts`. The agent must be logged in first (docs/acp.md).
 * Uses the model and the network; never runs in CI. Every permission request is denied.
 * @req FR:acp-driver/test.real
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAcpDriver, type AcpDriver, type PermissionRequest, type Update } from '../../src/agents';

const line = process.env.STACK_ACP_AGENT?.trim();
const loadSdk = () => import('@agentclientprotocol/sdk') as never;
const maybe = line ? describe : describe.skip;

maybe(`real ACP agent: ${line ?? '(set STACK_ACP_AGENT)'}`, () => {
  let driver: AcpDriver;
  const cwd = mkdtempSync(join(tmpdir(), 'stack-acp-real-'));

  beforeAll(() => {
    const [command, ...args] = (line as string).split(/\s+/);
    driver = createAcpDriver({ command, args, cwd, loadSdk, startTimeoutMs: 60_000 });
  });
  afterAll(async () => { await driver?.close(); });

  it('answers one prompt with end_turn and text; permission requests are denied', async () => {
    const asked: PermissionRequest[] = [];
    const run = await driver.prompt({ cwd, text: 'Reply with the single word: pong. Do not use any tools.', onPermission: async (r) => { asked.push(r); return { optionId: 'deny' }; } });
    const updates: Update[] = [];
    for await (const u of run.updates) updates.push(u);
    const done = updates[updates.length - 1] as Extract<Update, { type: 'done' }>;
    if (done.stopReason !== 'end_turn') throw new Error(`stopReason ${done.stopReason}: ${done.error ?? ''}\nagent stderr: ${driver.stderr()}`);
    expect(updates[0]).toMatchObject({ type: 'session', sessionId: expect.any(String) });
    expect((done.text ?? '').toLowerCase()).toContain('pong');
    for (const r of asked) expect(r.options.length).toBeGreaterThan(0);
  }, 180_000);
});
