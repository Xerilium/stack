/** `GET /api/next` and `stack next` give one answer: the first priority action, else the first owner task. */
/* @req FR:pri-first-ranking/api.next @req FR:pri-first-ranking/api.next.one @req FR:pri-first-ranking/api.next.owner @req FR:api/routes.next */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler } from '../../src/api/handler';
import { formatRef } from '../../src/api/validate';
import { run } from '../../src/cli/run';
import { nextStep } from '../../src/core/lifecycle';
import { PriStore } from '../../src/core/pris';
import { FsStorage } from '../../src/core/storage';

const BASE = join(__dirname, '../fixtures/pris-aware-ranking');
const NOTES: Record<string, string> = JSON.parse(readFileSync(join(__dirname, '../fixtures/pri-first-ranking/notes-2026-11-17.json'), 'utf8'));
const NOW = '2026-11-17T17:00:00Z';
const OWNER = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64');
let home: string; let dir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stack-home-'));
  dir = mkdtempSync(join(tmpdir(), 'stack-nextparity-'));
  cpSync(join(BASE, 'tasks'), join(dir, 'tasks'), { recursive: true });
  process.env.STACK_HOME = home;
});
afterAll(() => { delete process.env.STACK_HOME; });

/** The owner priorities; with `notes`, each has its weekly note (the source of the action rows). */
const seed = (notes: boolean) => {
  const f = JSON.parse(readFileSync(join(BASE, 'pris.json'), 'utf8'));
  for (const p of f.pris) p.weekly = notes ? [{ week: '2026-W47', text: NOTES[p.id] }] : [];
  writeFileSync(join(home, 'pris.json'), JSON.stringify(f));
};
interface Answer { ref?: string; text?: string; project?: string; score?: number; pri?: { id: string; rank: number; title: string } }
/** `stack next --json`, with the ref in the API form. */
async function cli(): Promise<Answer> {
  let out = '';
  await run(['next', '--json', '--dir', dir, '--no-commit', '--now', NOW], { out: (s) => { out += s; }, err: () => {} });
  const { ok, ref, ...rest } = JSON.parse(out) as { ok: boolean; ref?: { path: string; line: number } } & Omit<Answer, 'ref'>;
  expect(ok).toBe(true);
  return { ...rest, ...(ref ? { ref: formatRef({ path: ref.path, line: ref.line - 1 }) } : {}) } as Answer;
}
async function api(): Promise<{ task: Answer | null; action: Answer | null }> {
  const h = createApiHandler({ storage: new FsStorage(dir), authorize: () => true, now: () => new Date(NOW), pris: new PriStore(home) });
  return (await (await h(new Request('https://x.test/api/next', { headers: { 'x-ms-client-principal': OWNER } }))).json()) as { task: Answer | null; action: Answer | null };
}

describe('GET /api/next is the answer of stack next', () => {
  it('gives the first priority action that stack next prints, and the first task under it', async () => {
    seed(true);
    const c = await cli();
    const a = await api();
    expect(c.pri).toMatchObject({ rank: 2 });
    expect(a.action).toEqual({ pri: c.pri, text: c.text, score: c.score });
    expect(a.task).not.toBeNull();
    expect(typeof a.task!.ref).toBe('string');
  });
  it('gives the same task as stack next when no priority has an action', async () => {
    seed(false);
    const c = await cli();
    const a = await api();
    expect(a.action).toBeNull();
    expect(c.ref).toBeDefined();
    expect(a.task).toEqual({ ref: c.ref, text: c.text, project: c.project, score: c.score });
  });
  it('never gives an agent row or a mixed row, even when it would rank first', async () => {
    seed(false);
    const before = await api();
    appendFileSync(join(dir, 'tasks/allyte.md'), '- [ ] 🤖 Agent sweep 🚨 ‼️ 📅 Nov 10: 💰💰💰💰 ⬆️\n- [ ] 🙋 🪄 Mixed review 🚨 ‼️ 📅 Nov 10: 💰💰💰💰 ⬆️\n');
    const a = await api();
    const c = await cli();
    expect(a.task!.text).not.toMatch(/Agent sweep|Mixed review/);
    expect(a.task!.ref).toBe(c.ref);
    expect(a.task!.text).toBe(before.task!.text);
  });
  it('is one core function for both', async () => {
    seed(true);
    const s = await nextStep({ storage: new FsStorage(dir), now: () => new Date(NOW), pris: () => new PriStore(home).read().pris });
    const a = await api();
    expect(a.action).toEqual({ pri: { id: s.action!.id, rank: s.action!.rank, title: s.action!.title }, text: s.action!.text, score: s.action!.score });
    expect(a.task!.text).toBe(s.task!.text);
  });
});
