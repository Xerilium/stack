/** Per-command help, the short command list, and the unknown-command hint. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { run } from '../../src/cli/run';

async function cli(...args: string[]) {
  let out = ''; let err = '';
  const code = await run(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack help', () => {
  // @req FR:cli/run.help @req FR:cli/run.help.short @req FR:cli/run.help.width
  it('lists one short line per command, none wider than 100 characters', async () => {
    const top = await cli('--help');
    expect(top.code).toBe(0);
    expect(top.out).toMatch(/^ {2}add +add a task$/m);
    expect(top.out).toMatch(/^ {2}rank +\S/m);
    for (const l of top.out.split('\n')) expect(l.length).toBeLessThanOrEqual(100);
    const rows = [...top.out.matchAll(/^ {2}([a-z-]+) +(.+)$/gm)];
    expect(rows.length).toBeGreaterThan(20);
    for (const [, , summary] of rows) expect(summary.length).toBeLessThanOrEqual(60);
    expect((await cli('help')).out).toBe(top.out);
    expect(await cli('help', 'help')).toEqual({ code: 0, out: top.out, err: '' });
    expect(top.out).toContain('Docs: https://github.com/Xerilium/stack/blob/main/docs/cli.md\n');
    expect((await cli()).out).toBe(top.out);
  });

  // @req FR:cli/run.help.cmd
  it('prints only one command for <command> --help and help <command>', async () => {
    const r = await cli('add', '--help');
    expect(r.code).toBe(0);
    expect(r.out).toBe('Usage: stack add <project> <text...> [--section name] [--parent ref]\n\nadd a task\n\nSee https://github.com/Xerilium/stack/blob/main/docs/cli.md#add\n');
    expect((await cli('help', 'add')).out).toBe(r.out);
    const rank = await cli('help', 'rank');
    expect(rank.out).toContain('Usage: stack rank ');
    expect(rank.out).toContain('--explain shows why');
    expect(rank.out).not.toContain('add-project');
    expect((await cli('park', '--help')).out).toContain('See https://github.com/Xerilium/stack/blob/main/docs/cli.md#park');
  });

  // @req FR:cli/run.help.cmd
  it('links an anchor that exists in docs/cli.md for every command', async () => {
    const doc = readFileSync(resolve(__dirname, '../../docs/cli.md'), 'utf8');
    const src = readFileSync(resolve(__dirname, '../../src/cli/run.ts'), 'utf8');
    const names = [...src.matchAll(/^ {2}'?([a-z-]+)'?: \{ flags:/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const cmd of names) {
      const link = /cli\.md#([a-z-]+)/.exec((await cli('help', cmd)).out)?.[1];
      expect(doc).toContain(`<a id="${link}"></a>`);
    }
  });

  // @req FR:cli/run.help.unknown @req FR:cli/run.help.near
  it('names the next step and the nearest command for an unknown command', async () => {
    const r = await cli('rnak');
    expect(r.code).toBe(2);
    expect(r.err).toBe('error: Unknown command: rnak. Run stack --help to see commands. Did you mean: rank?\n');
    expect((await cli('frobnicate')).err).toBe('error: Unknown command: frobnicate. Run stack --help to see commands.\n');
    expect((await cli('help', 'frobnicate')).code).toBe(2);
    for (const short of ['x', 'go', 'ls']) expect((await cli(short)).err).not.toContain('Did you mean');
    expect((await cli('hlep')).err).toContain('Did you mean: help?');
  });
});
