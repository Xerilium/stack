import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
let home: string; let cwd: string; let sessions: string;
beforeEach(() => {
  home = tmp('stack-home-'); cwd = tmp('stack-norepo-'); sessions = tmp('stack-sess-');
  process.env.STACK_HOME = home; process.env.STACK_SESSIONS_DIR = sessions; process.env.STACK_TRANSCRIPTS_DIR = tmp('stack-tx-');
});
afterAll(() => { delete process.env.STACK_HOME; delete process.env.STACK_SESSIONS_DIR; delete process.env.STACK_TRANSCRIPTS_DIR; });

async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack sessions', () => {
  // @req FR:session-inventory/cli.sessions
  it('prints counts, ranked Needs you with links, and archive candidates; no repo needed', async () => {
    const d = join(sessions, 'a', 'b'); mkdirSync(d, { recursive: true });
    const now = Date.now();
    writeFileSync(join(d, 'local_1.json'), JSON.stringify({ sessionId: 'local_1', cwd: '/Users/u/dev/todo', title: 'Stack work', isArchived: false, lastActivityAt: now - 3600_000, interruptedAwaitingPerson: true }));
    writeFileSync(join(d, 'local_2.json'), JSON.stringify({ sessionId: 'local_2', cwd: '/Users/u/dev/finops-hubs', title: 'FH fix', isArchived: false, lastActivityAt: now - 3600_000, lastTurnEdgeAt: now - 3600_000, prs: [{ url: 'https://github.com/o/r/pull/1', state: 'MERGED' }] }));
    const r = await stack('sessions');
    expect(r.code).toBe(0);
    expect(r.out).toBe([
      'sessions: 2 (running 0, waiting 1, stuck 0, done 1, pinned 0, idle 0)',
      'needs you:',
      '1. [xerilium] waiting Stack work - needs-user claude://claude.ai/epitaxy/local_1',
      'archive candidates: 1', '',
    ].join('\n'));
    const j = JSON.parse((await stack('sessions', '--json')).out);
    expect(j).toMatchObject({ ok: true, total: 2, archive: [{ id: 'local_2', reason: 'pr-merged' }] });
    expect(existsSync(join(home, 'sessions.json'))).toBe(true);
  });
  it('rejects extra arguments', async () => {
    expect((await stack('sessions', 'x')).code).toBe(2);
  });
});

describe('stack pris', () => {
  // @req FR:session-inventory/cli.pris @req FR:session-inventory/pris.seed.once
  it('prints a hint with none, seeds once, then prints the list', async () => {
    expect((await stack('pris')).out).toBe('no priorities (run: stack pris seed --file <md>)\n');
    const md = join(cwd, 'p.md'); writeFileSync(md, '1. Ship: spec; tests.\n2. Rest\n');
    expect(await stack('pris', 'seed', '--file', md)).toMatchObject({ code: 0, out: 'seeded 2 priorities\n' });
    expect(await stack('pris', 'seed', '--file', md)).toMatchObject({ code: 0, out: 'already seeded (2 priorities)\n' });
    expect((await stack('pris')).out).toBe('1. Ship [active]\n   - spec\n   - tests\n2. Rest [active]\n');
    const j = JSON.parse((await stack('pris', '--json')).out);
    expect(j).toMatchObject({ ok: true, rev: 1, pris: [{ id: 'p1' }, { id: 'p2' }] });
    expect(JSON.parse(readFileSync(join(home, 'pris.json'), 'utf8')).seed.source).toBe(md);
  });
  it('seed errors exit 2', async () => {
    expect((await stack('pris', 'seed')).code).toBe(2);
    expect((await stack('pris', 'seed', '--file', join(cwd, 'none.md'))).code).toBe(2);
    expect((await stack('pris', 'nope')).code).toBe(2);
  });
});
