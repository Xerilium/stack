import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const PLAN = { version: 1, asOf: '2026-11-18T19:00:00Z', projects: [{ project: 'Stack', agent: { name: 'stack-architect' }, tasks: [{ title: 'Ship QM' }], weeklyTokens: 2000000, preAckMin: 10, postReviewMin: null }] };
let cwd: string;
beforeEach(() => { process.env.STACK_HOME = tmp('stack-qmcli-'); cwd = tmp('stack-norepo-'); });
afterAll(() => { delete process.env.STACK_HOME; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; }, in: async () => null });
  return { code, out, err };
}

describe('stack qm', () => {
  // @req FR:qm-plan/cli.get @req FR:qm-plan/cli.put
  it('puts and reads the plan with no repo', async () => {
    expect(JSON.parse((await stack('qm', '--json')).out)).toEqual({ ok: true, plan: null });
    const f = join(cwd, 'p.json'); writeFileSync(f, JSON.stringify(PLAN));
    const p = await stack('qm', 'put', '--file', f, '--json');
    expect(p.code).toBe(0);
    expect(JSON.parse(readFileSync(join(process.env.STACK_HOME!, 'qm-plan.json'), 'utf8'))).toEqual(PLAN);
    expect(JSON.parse((await stack('qm', '--json')).out)).toEqual({ ok: true, plan: PLAN });
    const t = await stack('qm');
    expect(t.out).toContain('Stack');
    expect(t.out).toContain('stack-architect');
  });

  // @req FR:qm-plan/cli.put
  it('rejects a bad plan with exit 2 and issues', async () => {
    const f = join(cwd, 'bad.json'); writeFileSync(f, JSON.stringify({ version: 1 }));
    const r = await stack('qm', 'put', '--file', f, '--json');
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(['asOf', 'projects']));
    expect((await stack('qm', 'put')).code).toBe(2);
  });
});
