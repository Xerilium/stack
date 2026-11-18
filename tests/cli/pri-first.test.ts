/** The owner's 12 priorities with the 2026-11-17 notes, on the pris-aware-ranking tasks plus blog backlog and sweep rows. */
/* @req FR:pri-first-ranking/proof.fixture @req FR:pri-first-ranking/proof.top @req FR:pri-first-ranking/proof.backlog */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const BASE = join(__dirname, '../fixtures/pris-aware-ranking');
const NOTES: Record<string, string> = JSON.parse(readFileSync(join(__dirname, '../fixtures/pri-first-ranking/notes-2026-11-17.json'), 'utf8'));
const NOW = '2026-11-17T17:00:00Z';
const BLOG = 'Blog backlog: AI model guide post';
const SWEEP = 'Sweep: PR sweep across all repos';
let home: string; let dir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stack-home-'));
  dir = mkdtempSync(join(tmpdir(), 'stack-prifirst-'));
  cpSync(join(BASE, 'tasks'), join(dir, 'tasks'), { recursive: true });
  // Rows that used to beat the priorities: urgent, due, valuable, unlinked.
  appendFileSync(join(dir, 'tasks/allyte.md'), `- [ ] ${BLOG} 🚨 📅 Nov 10: 💰💰 🟢\n`);
  appendFileSync(join(dir, 'tasks/xerilium.md'), `- [ ] ${SWEEP} 🚨 📅 Nov 10: 🟢\n`);
  process.env.STACK_HOME = home;
});
afterAll(() => { delete process.env.STACK_HOME; });

const seed = () => {
  const f = JSON.parse(readFileSync(join(BASE, 'pris.json'), 'utf8'));
  for (const p of f.pris) p.weekly = [{ week: '2026-W47', text: NOTES[p.id] }];
  writeFileSync(join(home, 'pris.json'), JSON.stringify(f));
};
async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', dir, '--no-commit', '--now', NOW], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err, lines: out.trim().split('\n') };
}

describe('stack next on the owner priorities', () => {
  // @req FR:pri-first-ranking/proof.fixture @req FR:pri-first-ranking/proof.top @req FR:pri-first-ranking/cli.@cli @req FR:pri-first-ranking/cli.read @req FR:pri-first-ranking/cli.rows
  it('shows the six priority actions first, in priority order', async () => {
    seed();
    const r = await stack('next', '--top', '6');
    expect(r.code).toBe(0);
    expect(r.lines.map((l) => l.split(' ')[0])).toEqual(['pri:2', 'pri:3', 'pri:4', 'pri:6', 'pri:7', 'pri:10']);
    expect(r.lines[0]).toBe('pri:2 2750 Autopilot PR progress live-validate https://github.com/allytehq/finops-hubs/pull/430');
    expect(r.lines[5]).toMatch(/^pri:10 \d+(\.\d)? Allyte blog for office hours today retire pri or undraft https:\/\/github.com\/allytehq\/allyte-web\/pull\/296$/);
    expect((await stack('next')).out).toBe(`${r.lines[0]}\n`);
  });
  // @req FR:pri-first-ranking/proof.backlog @req FR:pri-first-ranking/order.linked @req FR:pri-first-ranking/order.unlinked
  it('ranks blog backlog and sweep rows below every action and every linked task', async () => {
    seed();
    const { lines } = await stack('next', '--top', '50');
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at(BLOG)).toBeGreaterThan(5);
    expect(at(SWEEP)).toBeGreaterThan(5);
    const j = JSON.parse((await stack('rank', '--explain', '--json')).out);
    const lastLinked = Math.max(...j.items.map((x: { link?: unknown }, i: number) => (x.link ? i : -1)));
    const idx = (s: string) => j.items.findIndex((x: { text: string }) => x.text.includes(s));
    expect(idx(BLOG)).toBeGreaterThan(lastLinked);
    expect(idx(SWEEP)).toBeGreaterThan(lastLinked);
  });
  // @req FR:pri-first-ranking/cli.json @req FR:pri-first-ranking/cli.rows.score
  it('gives JSON action rows pri and no ref', async () => {
    seed();
    const j = JSON.parse((await stack('next', '--top', '7', '--json')).out);
    expect(j.items[0]).toEqual({ pri: { id: 'p2', rank: 2, title: 'Autopilot PR progress' }, project: 'Autopilot PR progress', score: 2750, text: 'live-validate https://github.com/allytehq/finops-hubs/pull/430' });
    expect(j.items[6].ref).toBeDefined();
    expect(j.items[6].pri).toBeUndefined();
  });
  // @req FR:pri-first-ranking/cli.explain @req FR:pri-first-ranking/cli.explain.action @req FR:pri-first-ranking/cli.explain.json
  it('explains the priority each row serves', async () => {
    seed();
    const r = await stack('rank', '--explain', '--top', '8');
    expect(r.lines[0]).toMatch(/^1\. pri:2 2750 Autopilot PR progress: live-validate .* serves=2:p2 "Autopilot PR progress" via note$/);
    expect(r.lines[6]).toMatch(/serves=1:p1 "Quota-maxxing \(window ends Thu 10am PT\)" via keyword "PR quality pass"$/);
    const j = JSON.parse((await stack('rank', '--explain', '--top', '7', '--json')).out);
    expect(j.items[6].link).toMatchObject({ id: 'p1', rank: 1, via: 'keyword' });
    expect(j.items[0]).toMatchObject({ pri: { id: 'p2', rank: 2 } });
    expect(j.items[0].ref).toBeUndefined();
  });
  // @req FR:pri-first-ranking/order.next
  it('starts the first ranked task when no ref is given', async () => {
    seed();
    const first = (await stack('next', '--top', '7', '--json')).out;
    const t = JSON.parse(first).items[6];
    expect((await stack('start')).code).toBe(0);
    expect(readFileSync(join(dir, t.ref.path), 'utf8').split('\n')[t.ref.line - 1]).toContain('🚧');
  });
  // @req FR:pri-first-ranking/order.none @req FR:pri-first-ranking/cli.read.bad
  it('keeps the engine order with no, or an invalid, pris.json; explicit engines keep their own order', async () => {
    const plain = (await stack('next', '--top', '50')).out;
    expect(plain).not.toMatch(/^pri:/m);
    writeFileSync(join(home, 'pris.json'), '{not json');
    expect((await stack('next', '--top', '50')).out).toBe(plain);
    seed();
    const a = await stack('rank', '--engine', 'autopri');
    expect(a.out).not.toMatch(/^pri:/m);
    writeFileSync(join(home, 'pris.json'), '{"version":1,"rev":1,"pris":[]}');
    expect((await stack('rank', '--engine', 'autopri')).out).toBe(a.out);
  });
});

describe('stack pris put and the day order', () => {
  const put = () => {
    const list = JSON.parse(readFileSync(join(__dirname, '../fixtures/pri-first-ranking/pris-current.json'), 'utf8'));
    for (const p of list) if (p.id === 'qm' || p.id === 'premium') p.weekly = [{ week: '2026-W47', text: `Michael: do ${p.id}` }];
    const f = join(home, 'in.json');
    writeFileSync(f, JSON.stringify(list));
    return f;
  };
  async function at(now: string, ...args: string[]) {
    let out = '';
    const code = await run([...args, '--dir', dir, '--no-commit', '--now', now], { out: (s) => { out += s; }, err: () => {} });
    return { code, lines: out.trim().split('\n') };
  }
  // @req FR:pri-first-ranking/day.cli @req FR:pri-first-ranking/day.cli.put @req FR:pri-first-ranking/day.input @req FR:pri-first-ranking/day.off
  it('replaces the list, then ranks the actions in the order of the day', async () => {
    const r = await stack('pris', 'put', '--file', put());
    expect(r.code).toBe(0);
    expect(r.out).toBe('put 14 priorities\n');
    expect(JSON.parse(readFileSync(join(home, 'pris.json'), 'utf8')).pris.map((p: { id: string }) => p.id)[7]).toBe('qm');
    const wed = await at('2026-11-18T17:00:00Z', 'next', '--top', '2');
    expect(wed.lines.map((l) => l.split(' ').slice(0, 1).concat(l.split(' ').slice(-2)).join(' '))).toEqual(['pri:2 do qm', 'pri:3 do premium']);
    const thu = await at('2026-11-19T17:00:00Z', 'next', '--top', '1');
    expect(thu.lines[0]).toMatch(/^pri:3 .* do premium$/);
    expect(thu.lines.join('\n')).not.toMatch(/do qm/);
  });
  // @req FR:pri-first-ranking/day.cli.put
  it('rejects a missing or invalid file', async () => {
    expect((await stack('pris', 'put')).code).toBe(2);
    expect((await stack('pris', 'put', '--file', join(home, 'nope.json'))).code).toBe(2);
    writeFileSync(join(home, 'bad.json'), '[{"id":"x"}]');
    expect((await stack('pris', 'put', '--file', join(home, 'bad.json'))).code).not.toBe(0);
  });
});

describe('stack next --daily', () => {
  // @req FR:pri-first-ranking/daily.@cli @req FR:pri-first-ranking/daily.cli
  it('prints one line per project with its pick and done today', async () => {
    const r = await stack('next', '--daily');
    expect(r.code).toBe(0);
    expect(r.lines.length).toBeGreaterThan(3);
    for (const l of r.lines) expect(l).toMatch(/^\S+ done=(yes|no) (\S+:\d+ .+|-)$/);
    expect(new Set(r.lines.map((l) => l.split(' ')[0])).size).toBe(r.lines.length);
    const top = (await stack('next', '--top', '1')).lines[0].split(' ')[0];
    expect(r.lines[0].split(' ')[2]).toBe(top);
    const j = JSON.parse((await stack('rank', '--daily', '--json')).out);
    expect(j.items[0]).toMatchObject({ done: false, pick: { ref: top } });
  });
});
