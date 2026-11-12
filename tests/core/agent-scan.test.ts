/** @req FR:agent-team/agent.team.scan */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listTeam } from '../../src/core/agents';
import { scanAgents } from '../../src/core/agent-scan';
import { MemoryStorage } from '../../src/core/storage';

const md = (fm: string, body = '# Title\n\nSECRET_BODY token=abc\n') => `---\n${fm}\n---\n\n${body}`;
function tree() {
  const home = mkdtempSync(join(tmpdir(), 'stack-scan-'));
  const dev = join(home, 'dev');
  const put = (rel: string, content: string) => { const p = join(home, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, content); return p; };
  put('.claude/agents/helper.md', md('name: helper\ndescription: User helper. Does things.'));
  put('dev/f4-music/.claude/agents/cid-divine-manager.md', md('name: "cid-divine-manager"\ndescription: "Manages Cid Divine."\nicon: fluent:headphone'));
  put('dev/f4-music-wt-x/.claude/agents/wt-only.md', md('name: wt-only'));
  put('dev/fh.worktrees/a/.claude/agents/wt2.md', md('name: wt2'));
  put('dev/.hidden/.claude/agents/hid.md', md('name: hid'));
  put('dev/todo/.claude/agents/cos.md', md('name: cos'));
  put('dev/finops-hubs/.claude/agents/sre.md', md('name: sre\ndescription: SRE.\nreports-to: allyte-cos'));
  put('dev/finops-hubs/.claude/agents/README.md', '# readme');
  put('dev/nofm/.claude/agents/broken.md', 'no frontmatter');
  return { home, dev, put };
}
const repos = [{ project: 'flantastic-4', names: ['flantastic-4', 'f4-music'] }, { project: 'allyte', names: ['allyte', 'finops-hubs'] }];

describe('scanAgents', () => {
  it('reads user level and each repo under the roots; skips the content repo, hidden and worktree folders; frontmatter only', async () => {
    const { home, dev } = tree();
    const got = await scanAgents({ home, roots: [dev], repos, skip: [join(dev, 'todo')] });
    expect(got.map((g) => [g.def.slug, g.home])).toEqual([['helper', 'user'], ['cid-divine-manager', 'flantastic-4'], ['sre', 'allyte']]);
    expect(got[1].def).toMatchObject({ name: 'Cid Divine Manager', role: 'Manages Cid Divine', icon: 'fluent:headphone', prompt: '' });
    expect(got[2].def.reportsTo).toBe('allyte-cos');
    expect(JSON.stringify(got)).not.toContain('SECRET_BODY');
  });
  it('defaults the roots to ~/dev and caches a file by mtime', async () => {
    const { home, put } = tree();
    const a = await scanAgents({ home, repos });
    expect(a.map((g) => g.def.slug)).toContain('cos');
    const p = put('dev/f4-music/.claude/agents/cid-divine-manager.md', md('name: cid-divine-manager\ndescription: Changed.'));
    const t = new Date('2020-01-01T00:00:00Z');
    utimesSync(p, t, t);
    const b = await scanAgents({ home, repos });
    expect(b.find((g) => g.def.slug === 'cid-divine-manager')?.def.role).toBe('Changed');
    const c = await scanAgents({ home, repos });
    expect(c.find((g) => g.def.slug === 'cid-divine-manager')?.def).toBe(b.find((g) => g.def.slug === 'cid-divine-manager')?.def);
  });
  it('returns nothing for missing roots', async () => {
    expect(await scanAgents({ home: join(tmpdir(), 'nope-stack-scan'), roots: ['/nope/x'] })).toEqual([]);
  });
});

describe('listTeam with scanned agents', () => {
  it('adds scanned agents after the content repo files, first slug wins, home project as scope', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/allyte.md', '# Allyte\n\n## Active\n\n- [ ] x\n');
    await storage.write('tasks/flantastic-4.md', '# F4\n\n## Active\n\n- [ ] x\n');
    storage.seed('.claude/agents/cos.md', md('name: cos\ndescription: Chief of Staff. Focus.', '# CoS: Chief of Staff\n'));
    const { home, dev } = tree();
    const scanned = await scanAgents({ home, roots: [dev], repos });
    scanned.push({ ...scanned[1], def: { ...scanned[1].def, slug: 'cos' } });
    const team = await listTeam({ storage }, scanned);
    expect(team.map((a) => [a.slug, a.source, a.home ?? null, a.scope, a.reportsTo ?? null])).toEqual([
      ['cos', 'claude', null, ['*'], null],
      ['helper', 'claude', 'user', [], 'cos'],
      ['cid-divine-manager', 'claude', 'flantastic-4', ['flantastic-4'], 'cos'],
      ['sre', 'claude', 'allyte', ['allyte'], 'cos'],
    ]);
    expect(team[0].name).toBe('Chief of Staff');
  });
});
