/** `stack inbox sources [--json]`. @req FR:inbox-page/cli.sources @req FR:inbox-page/src.safe */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';
import { FileTokenCache } from '../../src/graph/auth';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const repo = () => { const d = tmp('stack-src-'); mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks/a.md'), '# A\n\n## Active\n\n- [ ] Ship\n'); return d; };
async function stack(d: string, ...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack inbox sources', () => {
  const env = { cache: process.env.STACK_GRAPH_CACHE, gh: process.env.GITHUB_TOKEN };
  afterEach(() => {
    if (env.cache === undefined) delete process.env.STACK_GRAPH_CACHE; else process.env.STACK_GRAPH_CACHE = env.cache;
    if (env.gh === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = env.gh;
  });

  // @req FR:inbox-page/cli.sources
  it('lists each source with its state and step; exit 4 while one needs attention', async () => {
    const caches = tmp('stack-cache-');
    process.env.STACK_GRAPH_CACHE = join(caches, 'graph-token.json');
    process.env.GITHUB_TOKEN = 'SECRET-GH';
    await new FileTokenCache(join(caches, 'graph-token-a@outlook.com.json')).write({ version: 1, tenant: 'consumers', clientId: '11111111-2222-3333-4444-555555555555', scopes: ['Mail.Read'], refreshToken: 'SECRET-REFRESH', account: 'a@outlook.com' });
    const d = repo();
    mkdirSync(join(d, '.xe/config'), { recursive: true });
    writeFileSync(join(d, '.xe/config/stack.json'), JSON.stringify({ inbox: { accounts: ['b@outlook.com'] } }));
    const t = await stack(d, 'inbox', 'sources');
    expect(t.code).toBe(4);
    expect(t.out).toContain('2 of 3 sources connected');
    expect(t.out).toMatch(/email\s+a@outlook\.com\s+connecting/);
    expect(t.out).toMatch(/email\s+b@outlook\.com\s+not-connected/);
    expect(t.out).toContain('stack graph login --client-id 11111111-2222-3333-4444-555555555555 --account b@outlook.com --with mail');
    expect(t.out).toMatch(/teams .*planned/);
    const j = JSON.parse((await stack(d, 'inbox', 'sources', '--json')).out);
    expect(j.summary).toMatchObject({ connected: 2, total: 3, attention: true });
    expect(j.sources.map((s: { kind: string }) => s.kind)).toEqual(['email', 'email', 'github', 'teams', 'slack']);
    expect(t.out + JSON.stringify(j)).not.toMatch(/SECRET/);
  });
});
