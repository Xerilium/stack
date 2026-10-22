import { parseCommand, runCommand, type Client } from '../../src/bots/commands';
import { BotApiError } from '../../src/bots/client';

// @req FR:chat-bots/cmd.parse
describe('parseCommand', () => {
  it.each(['next', "what's next", 'Whats Next', 'what next', '?', '/stack next', '  NEXT  '])('next: %s', (t) => {
    expect(parseCommand(t)).toEqual({ kind: 'next' });
  });
  it('add', () => {
    expect(parseCommand('add alpha Buy milk 🟢')).toEqual({ kind: 'add', project: 'alpha', text: 'Buy milk 🟢' });
    expect(parseCommand('/stack add alpha x')).toEqual({ kind: 'add', project: 'alpha', text: 'x' });
    expect(parseCommand('add alpha')).toEqual({ kind: 'help' });
    expect(parseCommand('add')).toEqual({ kind: 'help' });
  });
  // @req FR:chat-bots/cmd.ref
  it('complete / done with optional ref and summary', () => {
    expect(parseCommand('complete')).toEqual({ kind: 'complete' });
    expect(parseCommand('done alpha:3')).toEqual({ kind: 'complete', ref: 'alpha:3' });
    expect(parseCommand('done alpha:3 shipped it')).toEqual({ kind: 'complete', ref: 'alpha:3', summary: 'shipped it' });
    expect(parseCommand('done shipped it')).toEqual({ kind: 'complete', summary: 'shipped it' });
  });
  it('start / skip', () => {
    expect(parseCommand('start')).toEqual({ kind: 'start' });
    expect(parseCommand('skip a:1')).toEqual({ kind: 'skip', ref: 'a:1' });
    expect(parseCommand('start nonsense')).toEqual({ kind: 'help' });
  });
  it('unknown and empty are help', () => {
    expect(parseCommand('hello')).toEqual({ kind: 'help' });
    expect(parseCommand('')).toEqual({ kind: 'help' });
    expect(parseCommand('help')).toEqual({ kind: 'help' });
  });
  // @req FR:chat-bots/cmd.limits
  it('rejects oversize and multi-line text', () => {
    expect(parseCommand('add a ' + 'x'.repeat(2000))).toEqual({ kind: 'invalid' });
    for (const nl of ['\n', '\r', '\u0085', ' ', ' ']) expect(parseCommand(`add a x${nl}- [ ] y`)).toEqual({ kind: 'invalid' });
  });
});

const fake = (over: Partial<Client> = {}): Client & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  const rec = (n: string, r: unknown) => async (...a: unknown[]) => { calls.push([n, ...a]); return r; };
  return {
    calls,
    next: rec('next', { ref: 'a:1', text: 'Do it', project: 'a' }) as Client['next'],
    add: rec('add', { ref: 'a:2' }) as Client['add'],
    start: rec('start', { ref: 'a:1' }) as Client['start'],
    complete: rec('complete', { ref: 'a:1' }) as Client['complete'],
    skip: rec('skip', { ref: 'a:3' }) as Client['skip'],
    ...over,
  };
};

// @req FR:chat-bots/cmd.run
describe('runCommand', () => {
  it('formats replies', async () => {
    const c = fake();
    expect(await runCommand(c, { kind: 'next' })).toBe('Next: Do it (a) [a:1]');
    expect(await runCommand(c, { kind: 'add', project: 'a', text: 'T' })).toBe('Added a:2');
    expect(await runCommand(c, { kind: 'start', ref: 'a:1' })).toBe('Started a:1');
    expect(await runCommand(c, { kind: 'complete', ref: 'a:1', summary: 's' })).toBe('Completed a:1');
    expect(await runCommand(c, { kind: 'skip' })).toBe('Skipped a:3');
    expect(c.calls[3]).toEqual(['complete', 'a:1', 's']);
  });
  it('nothing active, help, invalid', async () => {
    expect(await runCommand(fake({ next: async () => null }), { kind: 'next' })).toBe('Nothing active');
    expect(await runCommand(fake(), { kind: "help" })).toMatch(/^Commands:/);
    expect(await runCommand(fake(), { kind: 'invalid' })).toBe('Invalid input');
  });
  it('maps client failures to fixed text without echoing', async () => {
    const e = (status: number) => Object.assign(new Error('SECRET task text'), { status });
    const t = async (status: number) => runCommand(fake({ start: async () => { throw e(status); } }), { kind: 'start' });
    expect(await t(404)).toBe('Not found');
    expect(await t(422)).toBe('Invalid input');
    expect(await t(500)).toBe('Failed');
    for (const st of [401, 403]) {
      const errs: string[] = [];
      const out = await runCommand(fake({ start: async () => { throw new BotApiError(st); } }), { kind: 'start' }, (n) => errs.push(n));
      expect(out).toBe('Failed');
      expect(errs).toEqual(['BotApiError']);
    }
    expect(await runCommand(fake({ start: async () => { throw new Error('SECRET'); } }), { kind: 'start' })).toBe('Failed');
  });
});
