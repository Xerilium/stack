import { apiClient } from '../../src/bots/client';
import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { runCommand, parseCommand } from '../../src/bots/commands';

const NOW = new Date('2026-10-22T18:00:00Z');
const setup = async (headers: Record<string, string> = { 'x-bot': 'k' }) => {
  const storage = new MemoryStorage();
  const seen: string[] = [];
  const api = createApiHandler({
    storage, now: () => NOW,
    authorize: (req) => { seen.push(req.url); return req.headers.get('x-bot') === 'k'; },
  });
  const seed = apiClient(api, headers);
  await api(new Request('https://bots.invalid/api/projects', { method: 'POST', headers: { 'x-bot': 'k', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alpha' }) }));
  return { client: seed, seen, api };
};

// @req FR:chat-bots/cmd.client
describe('apiClient', () => {
  it('drives the api handler end to end without network', async () => {
    const { client, seen } = await setup();
    expect(await runCommand(client, parseCommand('add alpha Write tests 🟢'))).toMatch(/^Added alpha:\d+$/);
    expect(await runCommand(client, parseCommand('next'))).toMatch(/^Next: Write tests/);
    expect(await runCommand(client, parseCommand('start'))).toMatch(/^Started alpha:\d+$/);
    expect(await runCommand(client, parseCommand('done all good'))).toMatch(/^Completed alpha:\d+$/);
    expect(await runCommand(client, parseCommand('next'))).toBe('Nothing active');
    expect(seen.every((u) => u.startsWith('https://bots.invalid/api/'))).toBe(true);
  });
  it('unauthorized api yields Failed, not details', async () => {
    const { api } = await setup();
    const bad = apiClient(api, {});
    expect(await runCommand(bad, { kind: 'next' })).toBe('Failed');
  });
  it('unknown project is Not found or Invalid, never echoed', async () => {
    const { client } = await setup();
    const r = await runCommand(client, parseCommand('add nosuch SECRETTEXT'));
    expect(['Not found', 'Invalid input']).toContain(r);
    expect(r).not.toContain('SECRET');
  });
});
