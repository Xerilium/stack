/** @req FR:pris-aware-ranking/explain.cli @req FR:pris-aware-ranking/explain.json @req FR:pris-aware-ranking/cos.link @req FR:pris-aware-ranking/cos.note @req FR:pris-aware-ranking/cos.gaps.cli */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const FIX = join(__dirname, '../fixtures/pris-aware-ranking');
const NOW = '2026-11-11T17:00:00Z';
let home: string; let dir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stack-home-'));
  dir = mkdtempSync(join(tmpdir(), 'stack-pris-'));
  cpSync(join(FIX, 'tasks'), join(dir, 'tasks'), { recursive: true });
  process.env.STACK_HOME = home;
});
afterAll(() => { delete process.env.STACK_HOME; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', dir, '--no-commit', '--now', NOW], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const seed = () => writeFileSync(join(home, 'pris.json'), readFileSync(join(FIX, 'pris.json')));

describe('stack rank --engine pris', () => {
  it('ranks linked tasks by priority order and explains the priority served', async () => {
    seed();
    const r = await stack('rank', '--engine', 'pris', '--explain', '--top', '4');
    expect(r.code).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/unblock=4000 .* pri=1000\] serves=9:p9 "Catalyst 0.3.4 \/ 0.4" via keyword "0.3.4" .*Catalyst 0.3.4 release/);
    expect(lines[1]).toMatch(/pri=3000\] serves=1:p1 "Quota-maxxing \(window ends Thu 10am PT\)" via keyword "PR quality pass"/);
    const j = JSON.parse((await stack('rank', '--engine', 'pris', '--explain', '--top', '2', '--json')).out);
    expect(j.items[1].parts).toMatchObject({ pri: 3000, link: { id: 'p1', rank: 1, via: 'keyword', term: 'PR quality pass', boost: 3000 } });
  });
  it('equals autopri with no pris.json; rejects bad engines', async () => {
    const a = (await stack('rank', '--engine', 'autopri')).out;
    expect((await stack('rank', '--engine', 'pris')).out).toBe(a);
    expect((await stack('rank', '--engine', 'nope')).code).toBe(2);
    expect((await stack('rank', '--engine', 'stack', '--explain')).code).toBe(2);
  });
});

describe('stack pris link, note, gaps', () => {
  it('lists gaps, then link and note close them', async () => {
    seed();
    const g = await stack('pris', 'gaps');
    expect(g.code).toBe(0);
    const lines = g.out.trim().split('\n');
    expect(lines).toHaveLength(12); // seeded: no status anywhere
    expect(lines[0]).toBe('1. p1 Quota-maxxing (window ends Thu 10am PT): no-status -> stack pris note p1 "..."');
    expect(await stack('pris', 'link', 'p1', '--keywords', 'nothing matches this')).toMatchObject({ code: 0, out: 'p1 linked: projects=- keywords=nothing matches this refs=-\n' });
    expect((await stack('pris', 'gaps')).out.split('\n')[0]).toBe('1. p1 Quota-maxxing (window ends Thu 10am PT): no-status, no-tasks -> stack pris note p1 "..."');
    expect((await stack('pris', 'link', 'p1', '--keywords', 'PR quality pass')).code).toBe(0);
    expect((await stack('pris', 'note', 'p1', 'PR', 'pass', 'half done')).out).toMatch(/^p1 noted \(\d{4}-W\d{2}\)\n$/);
    const after = JSON.parse((await stack('pris', 'gaps', '--json')).out);
    expect(after.gaps.map((x: { id: string }) => x.id)).not.toContain('p1');
    const file = JSON.parse(readFileSync(join(home, 'pris.json'), 'utf8'));
    expect(file.pris[0]).toMatchObject({ keywords: ['PR quality pass'], weekly: [{ text: 'PR pass half done' }] });
    expect(file.rev).toBe(4);
  });
  it('says when clearing every list brings back automatic title terms', async () => {
    seed();
    expect((await stack('pris', 'link', 'p1', '--keywords', '')).out).toBe('p1 linked: projects=- keywords=- refs=- (no terms: automatic terms from the title apply)\n');
  });
  it('rejects unknown ids, missing flags and text', async () => {
    seed();
    expect((await stack('pris', 'link', 'zz', '--keywords', 'x')).code).toBe(2);
    expect((await stack('pris', 'link', 'p1')).code).toBe(2);
    expect((await stack('pris', 'note', 'p1')).code).toBe(2);
    expect((await stack('pris', 'gaps', 'x')).code).toBe(2);
    expect((await stack('pris', '--keywords', 'x')).code).toBe(2);
  });
  it('prints no gaps when every priority is current and linked', async () => {
    writeFileSync(join(home, 'pris.json'), JSON.stringify({ version: 1, rev: 1, pris: [{ id: 'p1', title: 'Stack v2', status: 'active', items: [], backlog: [], weekly: [], statusAt: '2026-11-10T00:00:00Z' }] }));
    expect((await stack('pris', 'gaps')).out).toBe('no gaps\n');
  });
});
