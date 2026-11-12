import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
let cwd: string;
beforeEach(() => { process.env.STACK_HOME = tmp('stack-fbcli-'); cwd = tmp('stack-norepo-'); });
afterAll(() => { delete process.env.STACK_HOME; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; }, in: async () => null });
  return { code, out, err };
}

describe('stack feedback', () => {
  // @req FR:feedback-button/cli.add @req FR:feedback-button/cli.list @req FR:feedback-button/cli.done
  it('adds, lists, and marks done with no repo', async () => {
    const a = await stack('feedback', 'add', 'Rail', 'too', 'wide', '--route', '/#list', '--json');
    expect(a.code).toBe(0);
    const id = JSON.parse(a.out).item.id as string;
    expect(JSON.parse(a.out).item).toMatchObject({ text: 'Rail too wide', route: '/#list' });
    const b = await stack('feedback', 'add', 'second');
    expect(b).toMatchObject({ code: 0, out: expect.stringMatching(/^fb-\S+\n$/) });
    const l = await stack('feedback', 'list', '--json');
    expect(JSON.parse(l.out).items.map((x: { text: string; done: boolean }) => [x.text, x.done])).toEqual([['Rail too wide', false], ['second', false]]);
    expect(JSON.parse((await stack('feedback', 'list', '--since', id, '--json')).out).items).toHaveLength(1);
    expect((await stack('feedback', 'done', id)).code).toBe(0);
    expect((await stack('feedback', 'list')).out).toContain(`${id} done`);
    expect((await stack('feedback', 'done', 'fb-missing')).code).toBe(4);
  });

  it('is a usage error without text or subcommand', async () => {
    expect((await stack('feedback', 'add')).code).toBe(2);
    expect((await stack('feedback')).code).toBe(2);
  });
});
