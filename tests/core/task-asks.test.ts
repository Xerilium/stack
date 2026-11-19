/**
 * Asks as nested 🙋 task rows (`.xe/features/task-asks/spec.md`).
 */
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { answerAsk, archiveAsks, formatAsk, formatAskRow, handleAsk, importAsks, listAsks, putAsk, readAsk, readAskRows, type Ask } from '../../src/core/asks';
import { wakePath } from '../../src/core/ask-wake';
import { lintIds } from '../../src/core/task-ids';
import { lintProject } from '../../src/core/task-lint';
import { MemoryStorage, type FileWrite } from '../../src/core/storage';
import { run } from '../../src/cli/run';
import { dailyGoal, LifecycleError, nextTask, rankStack, removeCompleted } from '../../src/core/lifecycle';
import { generateSummaries } from '../../src/core/summaries';
import { getDefaults } from '../../src/core/config';
import { mailKey, resolveThreads } from '../../src/email/to-ask';

const NOW = new Date('2026-10-28T14:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

function mk(files: Record<string, string> = {}) {
  const storage = new MemoryStorage();
  for (const [p, c] of Object.entries(files)) storage.seed(p, c);
  let tick = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) };
  return { storage, ctx };
}
const base = { ask: 'Approve merging PR 879 into dev', kind: 'approve' as const, from: 'allyte-cos' };
const read = async (s: MemoryStorage, p: string) => (await s.read(p)).content;

const ALPHA = [
  '# Alpha', '',
  '## Active', '',
  '- [ ] 🚧 Ship v2',
  '  > id: ship-v2',
  '  - [ ] Write notes',
  '    more detail',
  '- [ ] Other task', '',
  '## Later', '',
  '- [ ] Someday', '',
].join('\n');

const SPEC_ROW = [
  '# Alpha', '', '## Active', '',
  '- [ ] 🚧 Ship v2',
  '  > id: ship-v2',
  '  - [ ] 🙋 ‼️ Approve merging PR 879 into dev',
  '    > id: pr-879-approve',
  '    > kind: approve',
  '    > from: allyte-cos',
  '    > why: Go-live is Oct 29; CI is green',
  '    > recommend: Approve',
  '    > default: Merges Oct 29 8:00am',
  '    > by: 2026-10-29T15:00:00Z',
  '    > link: https://github.com/o/r/pull/879',
  '    > created: 2026-10-28T13:00:00.000Z',
  '    > updated: 2026-10-28T13:00:00.000Z',
  '',
].join('\n');

const full = (over: Partial<Ask> = {}): Ask => ({
  key: 'pr-879-approve', state: 'open', ask: 'Approve merging PR 879 into dev', kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0,
  created: NOW.toISOString(), updated: NOW.toISOString(), detail: '', thread: [], extra: [], ...over,
});

// @req FR:task-asks/format.row
describe('ask rows', () => {
  it('reads a 🙋 row with kind as an ask keyed by its id', async () => {
    const { ctx } = mk({ 'tasks/alpha.md': SPEC_ROW });
    const r = await readAsk(ctx, 'pr-879-approve');
    expect(r?.path).toBe('tasks/alpha.md');
    expect(r?.ask).toMatchObject({ key: 'pr-879-approve', state: 'open', ask: 'Approve merging PR 879 into dev', kind: 'approve', from: 'allyte-cos', priority: 'high', why: 'Go-live is Oct 29; CI is green', by: '2026-10-29T15:00:00Z', link: 'https://github.com/o/r/pull/879' });
    expect((await listAsks(ctx, {}, NOW)).items.map((a) => a.key)).toEqual(['pr-879-approve']);
  });
  it('a 🙋 row without kind, or a kind row without 🙋, is not an ask', async () => {
    const src = ['# A', '', '## S', '', '- [ ] 🙋 Call the dentist', '  > id: dentist', '- [ ] Agent work', '  > id: work', '  > kind: approve', '  > from: x', '  > created: 2026-10-28T13:00:00.000Z', ''].join('\n');
    const { ctx } = mk({ 'tasks/a.md': src });
    expect((await listAsks(ctx, { state: 'all' }, NOW)).items).toEqual([]);
    expect(await readAsk(ctx, 'dentist')).toBeNull();
  });
  it('rows in a code fence are examples, not asks', () => {
    const src = ['# A', '', '## S', '', '```markdown', '- [ ] 🙋 Example', '  > id: ex', '  > kind: approve', '```', ''].join('\n');
    expect(readAskRows(src)).toEqual([]);
  });
});

// @req FR:task-asks/format.row
describe('ask rows and the task lint', () => {
  it('passes the lint with a long ask, dated fields, detail, and thread', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', { ...base, ask: `Approve ${'the long plan '.repeat(12)}`.trim(), by: '2026-10-29T15:00:00.000Z', detail: 'Done as of Oct 3; 3/5 merged' }, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'reply', text: 'shipped 50%' });
    const p = (await storage.list())[0];
    expect(lintProject(p, await read(storage, p))).toEqual([]);
  });
});

// @req FR:task-asks/format.fields
describe('ask fields', () => {
  it('round-trips every field through a row', () => {
    const a = full({
      project: 'alpha', why: 'Go-live', recommend: 'Approve', default: 'Merges', by: at(20), reversible: true, link: 'https://github.com/o/r/pull/879',
      priority: 'crit', effort: '2m', blocks: 3, answer: 'go', text: 'ok', answered: at(1), outcome: 'handled', handled: `${at(2)} by cos`, note: 'merged', snoozed: at(5), state: 'done',
      kind: 'decide', options: ['A', 'B'], flow: 'triage-oct29', seq: 2, ref: 'alpha:4', refText: '🚧 Ship v2', apply: 'set priority=🚨', applies: ['skip', 'complete'], writer: 'token:cos',
      detail: 'Long body.\n\n## Thread\n\\## Detail\nlast', thread: [`- ${at(1)} you: ok`], extra: ['color: red'],
    });
    const src = ['# A', '', '## S', '', ...formatAskRow(a), ''].join('\n');
    expect(readAskRows(src).map((r) => r.ask)).toEqual([a]);
  });
  it('maps priority to its emoji, effort to time, and state to the checkbox', () => {
    const lines = formatAskRow(full({ priority: 'high', effort: '5m' }));
    expect(lines[0]).toBe('- [ ] 🙋 ‼️ Approve merging PR 879 into dev');
    expect(lines).toContain('  > id: pr-879-approve');
    expect(lines).toContain('  > time: 5m');
    expect(lines.some((l) => /> (priority|effort|state):/.test(l))).toBe(false);
    expect(formatAskRow(full({ priority: 'crit' }))[0]).toContain('🙋 🚨 ');
    expect(formatAskRow(full({ priority: 'low' }))[0]).toContain('🙋 🔻 ');
    expect(formatAskRow(full({ state: 'done' }))[0]).toMatch(/^- \[x\] 🙋 /);
    expect(formatAskRow(full({ state: 'answered', answer: 'go' })).some((l) => l.includes('> state:'))).toBe(false);
    // the checkbox and answer cannot tell these: state is written
    expect(formatAskRow(full({ state: 'answered' }))).toContain('  > state: answered');
    expect(formatAskRow(full({ state: 'open', answer: 'go' }))).toContain('  > state: open');
  });
  it('reads state from the checkbox and answer', () => {
    const row = (box: string, extra: string[] = []) => readAskRows(['# A', '', '## S', '', `- [${box}] 🙋 Do it`, '  > id: k', '  > kind: approve', '  > from: a', '  > created: 2026-10-28T13:00:00.000Z', ...extra, ''].join('\n'))[0].ask.state;
    expect(row(' ')).toBe('open');
    expect(row('x')).toBe('done');
    expect(row(' ', ['  > answer: go'])).toBe('answered');
  });
  it('detail and thread lines are blockquote lines that never parse as tasks or metadata', () => {
    const lines = formatAskRow(full({ detail: '- [ ] not a task\nkey: value\n\nend', thread: ['- 2026-10-28T14:03:11Z owner: go'] }));
    expect(lines.slice(-7)).toEqual(['  > ## Detail', '  > - [ ] not a task', '  > key: value', '  >', '  > end', '  > ## Thread', '  > - 2026-10-28T14:03:11Z owner: go']);
  });
});

// @req FR:task-asks/format.roundtrip
describe('only the ask lines change', () => {
  it('keeps every other byte, CRLF stays CRLF', async () => {
    const crlf = ALPHA.replace(/\n/g, '\r\n');
    const { storage, ctx } = mk({ 'tasks/alpha.md': crlf });
    await putAsk(ctx, 'k1', { ...base, project: 'alpha' }, 'cos');
    const after = await read(storage, 'tasks/alpha.md');
    expect(after.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    const added = after.split('\r\n').filter((l) => !crlf.split('\r\n').includes(l));
    expect(added.every((l) => l.startsWith('- [ ] 🙋') || l.startsWith('  > '))).toBe(true);
    // removing the ask lines gives the original file back
    expect(after.split('\r\n').filter((l) => !added.includes(l)).join('\r\n')).toBe(crlf);
  });
  it('an update rewrites only the ask block in place', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': SPEC_ROW });
    await putAsk(ctx, 'pr-879-approve', { why: 'Changed' }, 'cos');
    const after = (await read(storage, 'tasks/alpha.md')).split('\n');
    const before = SPEC_ROW.split('\n');
    expect(after.slice(0, 7)).toEqual(before.slice(0, 7));
    expect(after).toContain('    > why: Changed');
    expect(after[after.length - 1]).toBe('');
    expect(after.filter((l) => l.includes('🙋'))).toHaveLength(1);
  });
});

// @req FR:task-asks/place.ref
describe('placement under a task', () => {
  it('writes the ask as the last child of the ref row', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    await putAsk(ctx, 'k1', { ...base, ref: 'alpha:4' }, 'cos');
    const lines = (await read(storage, 'tasks/alpha.md')).split('\n');
    const i = lines.indexOf('    more detail');
    expect(lines[i + 1]).toBe('  - [ ] 🙋 Approve merging PR 879 into dev');
    expect(lines[i + 2]).toBe('    > id: k1');
    expect(lines.indexOf('- [ ] Other task')).toBeGreaterThan(i + 2);
    expect((await readAsk(ctx, 'k1'))?.ask.ref).toBe('alpha:4');
  });
});

// @req FR:task-asks/place.project
describe('placement in a project', () => {
  it('writes the ask at the end of the first section', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    await putAsk(ctx, 'k1', { ...base, project: 'alpha' }, 'cos');
    const lines = (await read(storage, 'tasks/alpha.md')).split('\n');
    expect(lines[lines.indexOf('- [ ] Other task') + 1]).toBe('- [ ] 🙋 Approve merging PR 879 into dev');
    expect(lines.indexOf('## Later')).toBeGreaterThan(lines.indexOf('  > project: alpha'));
  });
  it('a project with no file goes to the default file', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', { ...base, project: 'FinOps hubs' }, 'cos');
    expect(await read(storage, 'tasks/asks.md')).toContain('> project: FinOps hubs');
  });
});

// @req FR:task-asks/place.default
describe('placement by default', () => {
  it('creates tasks/asks.md with a title and an Open section', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await putAsk(ctx, 'k2', { ...base, ask: 'Second' }, 'cos');
    const src = await read(storage, 'tasks/asks.md');
    expect(src.startsWith('# Asks\n\n## Open\n\n- [ ] 🙋 Approve merging PR 879 into dev\n  > id: k1\n')).toBe(true);
    expect(src.indexOf('- [ ] 🙋 Second')).toBeGreaterThan(src.indexOf('> id: k1'));
    expect(src.endsWith('\n')).toBe(true);
    expect(await storage.listAsks!()).toEqual([]);
  });
});

// @req FR:task-asks/place.unique
describe('one row per key', () => {
  it('a put on an existing key updates that row where it is', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': SPEC_ROW });
    const r = await putAsk(ctx, 'pr-879-approve', { project: 'beta' }, 'cos');
    expect(r).toEqual({ key: 'pr-879-approve', created: false });
    expect(await read(storage, 'tasks/alpha.md')).toContain('> project: beta');
    await expect(storage.read('tasks/asks.md')).rejects.toThrow();
  });
  it('the first row of a key wins across files', async () => {
    const other = SPEC_ROW.replace('Approve merging', 'Duplicate of');
    const { ctx } = mk({ 'tasks/alpha.md': SPEC_ROW, 'tasks/beta.md': other });
    expect((await listAsks(ctx, { state: 'all' }, NOW)).items.map((a) => a.ask)).toEqual(['Approve merging PR 879 into dev']);
  });
});

// @req FR:task-asks/core.contract
describe('same core contract', () => {
  it('put, answer, handle and list keep their results on rows', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    expect(await putAsk(ctx, 'k1', { ...base, project: 'alpha', priority: 'high' }, 'cos')).toEqual({ key: 'k1', created: true });
    const open = await listAsks(ctx, {}, NOW);
    expect(open.items[0]).toMatchObject({ key: 'k1', rank: 1, priority: 'high', project: 'alpha' });
    expect(await answerAsk(ctx, 'k1', { answer: 'reply', text: 'Ship it' })).toEqual({ changed: true });
    expect((await readAsk(ctx, 'k1'))?.ask).toMatchObject({ state: 'answered', answer: 'reply', text: 'Ship it' });
    expect(await read(storage, 'tasks/alpha.md')).toContain('  > ## Thread');
    expect(await handleAsk(ctx, 'k1', { outcome: 'handled', note: 'done' }, 'cos')).toEqual({ changed: true });
    expect(await read(storage, 'tasks/alpha.md')).toContain('- [x] 🙋 ‼️ Approve merging PR 879 into dev');
    expect((await listAsks(ctx, { state: 'done' }, NOW)).items.map((a) => a.key)).toEqual(['k1']);
    await expect(answerAsk(ctx, 'nope', { answer: 'go' })).rejects.toThrow('Ask not found');
  });
});

// @req FR:task-asks/core.archive
describe('archive', () => {
  it('deletes done rows older than days in one write and keeps the rest', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    await putAsk(ctx, 'old', { ...base, project: 'alpha' }, 'cos');
    await putAsk(ctx, 'keep', { ...base, ask: 'Keep me' }, 'cos');
    await handleAsk(ctx, 'old', { outcome: 'handled' }, 'cos');
    await handleAsk(ctx, 'keep', { outcome: 'handled' }, 'cos');
    await putAsk(ctx, 'open', { ...base, ask: 'Still open' }, 'cos');
    const writes: FileWrite[][] = [];
    const orig = storage.writeMany?.bind(storage);
    storage.writeMany = async (w: FileWrite[]) => { writes.push(w); return orig!(w); };
    const later = { storage, now: () => new Date(NOW.getTime() + 15 * 86_400_000) };
    expect(await archiveAsks(later, { days: 14 })).toEqual({ archived: ['keep', 'old'] });
    expect(writes).toHaveLength(1);
    expect(await read(storage, 'tasks/alpha.md')).toBe(ALPHA);
    expect(await read(storage, 'tasks/asks.md')).toContain('Still open');
    expect(await read(storage, 'tasks/asks.md')).not.toContain('Keep me');
  });
});

// @req FR:task-asks/core.wake
describe('wake files', () => {
  it('an answer writes the wake line, handle clears it', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'go' });
    expect(await read(storage, wakePath('allyte-cos'))).toMatch(/ k1 go$/m);
    await handleAsk(ctx, 'k1', { outcome: 'handled' }, 'cos');
    expect(await read(storage, wakePath('allyte-cos'))).not.toMatch(/ k1 /);
  });
});

const askFileOf = (a: Partial<Ask> & { key: string }) => formatAsk(full(a));

// @req FR:task-asks/import.cmd
describe('stack asks import', () => {
  it('turns open and answered ask files into rows in one write and leaves the files', async () => {
    const { storage, ctx } = mk({
      'tasks/alpha.md': ALPHA,
      'tasks/.stack/asks/a1.md': askFileOf({ key: 'a1', project: 'alpha' }),
      'tasks/.stack/asks/a2.md': askFileOf({ key: 'a2', ask: 'Answered one', state: 'answered', answer: 'go', answered: at(1) }),
      'tasks/.stack/asks/a3.md': askFileOf({ key: 'a3', ask: 'Done one', state: 'done', outcome: 'handled' }),
      'tasks/.stack/asks/a4.md': askFileOf({ key: 'a4', ask: 'Under ship', ref: 'alpha:4', refText: '🚧 Ship v2' }),
    });
    const writes: FileWrite[][] = [];
    const orig = storage.writeMany!.bind(storage);
    storage.writeMany = async (w: FileWrite[]) => { writes.push(w); return orig!(w); };
    const dry = await importAsks(ctx, { dryRun: true });
    expect(dry).toEqual({ imported: ['a1', 'a2', 'a4'], skipped: [], files: ['tasks/alpha.md', 'tasks/asks.md'] });
    expect(writes).toHaveLength(0);
    expect(await importAsks(ctx)).toEqual(dry);
    expect(writes).toHaveLength(1);
    expect((await readAsk(ctx, 'a1'))?.path).toBe('tasks/alpha.md');
    expect((await readAsk(ctx, 'a2'))?.ask).toMatchObject({ state: 'answered', answer: 'go' });
    expect((await readAsk(ctx, 'a4'))?.path).toBe('tasks/alpha.md');
    const lines = (await read(storage, 'tasks/alpha.md')).split('\n');
    expect(lines[lines.indexOf('    more detail') + 1]).toBe('  - [ ] 🙋 Under ship');
    expect(await readAsk(ctx, 'a3')).toBeNull();
    expect(await storage.listAsks!()).toHaveLength(4);
  });
  it('runs from the CLI with --dry-run', async () => {
    const d = mkdtempSync(join(tmpdir(), 'stack-import-'));
    mkdirSync(join(d, 'tasks/.stack/asks'), { recursive: true });
    writeFileSync(join(d, 'tasks/.stack/asks/a1.md'), askFileOf({ key: 'a1' }));
    let out = '';
    const go = (...a: string[]) => run(['asks', 'import', ...a, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: () => undefined });
    expect(await go('--dry-run')).toBe(0);
    expect(out).toContain('a1');
    expect(existsSync(join(d, 'tasks/asks.md'))).toBe(false);
    expect(await go()).toBe(0);
    expect(readFileSync(join(d, 'tasks/asks.md'), 'utf8')).toContain('  > id: a1');
  });
});

// @req FR:task-asks/import.idempotent
describe('import is idempotent', () => {
  it('skips a key already present as a row', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': SPEC_ROW, 'tasks/.stack/asks/pr-879-approve.md': askFileOf({ key: 'pr-879-approve' }), 'tasks/.stack/asks/b.md': askFileOf({ key: 'b' }) });
    expect(await importAsks(ctx)).toMatchObject({ imported: ['b'], skipped: ['pr-879-approve'] });
    const again = await importAsks(ctx);
    expect(again).toEqual({ imported: [], skipped: ['b', 'pr-879-approve'], files: [] });
    expect((await read(storage, 'tasks/asks.md')).match(/> id: b$/gm)).toHaveLength(1);
  });
});

const ACTIVE = ['# Alpha', '', '## 🔄 Active', '', '- [ ] Ship v2', '  > id: ship-v2', '- [ ] Other task', ''].join('\n');

// @req FR:task-asks/rank.skip
describe('ask rows are not ranked tasks', () => {
  it('rankStack and nextTask skip ask rows; the parent stays a leaf', async () => {
    const { ctx } = mk({ 'tasks/alpha.md': ACTIVE });
    await putAsk(ctx, 'k1', { ...base, ref: 'alpha:4' }, 'cos');
    await putAsk(ctx, 'k2', { ...base, ask: 'Top ask', project: 'alpha', priority: 'crit' }, 'cos');
    const texts = (await rankStack(ctx, NOW, undefined, { ignoreBlocks: true, owner: 'any' })).map((r) => r.text);
    expect(texts.sort()).toEqual(['Other task', 'Ship v2']);
    expect((await nextTask(ctx, NOW))?.text).not.toContain('🙋');
  });
  it('a file with only ask rows adds no ranked tasks', async () => {
    const { ctx } = mk({ 'tasks/asks.md': ['# Asks', '', '## 🔄 Active', '', ...formatAskRow(full({ priority: 'crit' })), ''].join('\n') });
    expect(await rankStack(ctx, NOW, undefined, { ignoreBlocks: true, owner: 'any' })).toEqual([]);
    expect(await nextTask(ctx, NOW)).toBeNull();
  });
  it('the summaries skip ask rows and do not count them as checkpoints', () => {
    const content = ['# Alpha', '', '## 🔄 Active', '', '- [ ] Ship v2', ...formatAskRow(full({ ask: 'Approve the ask row', detail: 'body' }), '  '), ''].join('\n');
    const out = generateSummaries({ projects: [{ fileName: 'alpha.md', content }], config: getDefaults(), now: NOW });
    expect(out.readme + out.stack + out.projects).not.toContain('Approve the ask row');
    expect(out.readme).not.toContain('checkpoint');
    expect(out.stack).toContain('Ship v2');
  });
  it('a handled ask is not a done task for the daily goal', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ACTIVE });
    await putAsk(ctx, 'k1', { ...base, ref: 'alpha:4' }, 'cos');
    await handleAsk(ctx, 'k1', { outcome: 'handled' }, 'cos');
    (storage as MemoryStorage & { lineActivity: (p: string) => Promise<number[]> }).lineActivity = async (p: string) => (await read(storage, p)).split('\n').map(() => Infinity);
    expect((await dailyGoal(ctx, NOW)).find((r) => r.name === 'alpha')?.done).toBe(false);
  });
});

// @req FR:task-asks/format.clean
describe('ask text cannot set row properties', () => {
  it('put strips Stack marks from the text; a leading priority emoji is not read as priority', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', { ...base, ask: '🚨 ‼️ 🚧 Approve 🅿️ 💤 ⭐️ 1️⃣ 🤖 🪄 🙋 📅 ⏰ ⏫ 🟢 ⬆️ 🌐 now' }, 'cos');
    const a = (await readAsk(ctx, 'k1'))!.ask;
    expect(a).toMatchObject({ ask: 'Approve now', priority: 'normal' });
    expect(await read(storage, 'tasks/asks.md')).toContain('- [ ] 🙋 Approve now\n');
    await expect(putAsk(ctx, 'k2', { ...base, ask: '🚨 ‼️' }, 'cos')).rejects.toThrow(LifecycleError);
  });
  it('import strips Stack marks from the text', async () => {
    const { ctx } = mk({ 'tasks/.stack/asks/a1.md': askFileOf({ key: 'a1', ask: '🚨 Pay 🅿️ it' }) });
    await importAsks(ctx);
    expect((await readAsk(ctx, 'a1'))!.ask).toMatchObject({ ask: 'Pay it', priority: 'normal' });
  });
});

// @req FR:task-asks/core.archive
describe('archive never loses owner content', () => {
  it('skips a done ask whose subtree holds an open row or an owner note', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'kid', { ...base, ask: 'Has a child' }, 'cos');
    await putAsk(ctx, 'note', { ...base, ask: 'Has a note' }, 'cos');
    await putAsk(ctx, 'plain', { ...base, ask: 'Plain' }, 'cos');
    for (const k of ['kid', 'note', 'plain']) await handleAsk(ctx, k, { outcome: 'handled' }, 'cos');
    const lines = (await read(storage, 'tasks/asks.md')).split('\n');
    // the last line of the ask's own block
    const after = (key: string) => { let i = lines.indexOf(`  > id: ${key}`); while (lines[i + 1]?.startsWith('  >')) i++; return i; };
    lines.splice(after('note') + 1, 0, '  - my note');
    lines.splice(after('kid') + 1, 0, '  - [ ] Follow up');
    storage.seed('tasks/asks.md', lines.join('\n'));
    const later = { storage, now: () => new Date(NOW.getTime() + 15 * 86_400_000) };
    expect(await archiveAsks(later, { days: 14 })).toEqual({ archived: ['plain'] });
    const src = await read(storage, 'tasks/asks.md');
    expect(src).toContain('  - [ ] Follow up');
    expect(src).toContain('  - my note');
    expect(src).not.toContain('Plain');
  });
  it('removeCompleted keeps done ask rows', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ACTIVE.replace('- [ ] Other task', '- [x] Other task') });
    await putAsk(ctx, 'k1', { ...base, ref: 'alpha:4' }, 'cos');
    await handleAsk(ctx, 'k1', { outcome: 'handled' }, 'cos');
    expect(await removeCompleted(ctx)).toMatchObject({ removed: 1 });
    expect(await read(storage, 'tasks/alpha.md')).not.toContain('Other task');
    expect((await readAsk(ctx, 'k1'))?.ask.state).toBe('done');
  });
});

// @req FR:task-asks/place.unique
describe('ask keys never collide', () => {
  it('refuses a new key that is a task id in any file', async () => {
    const { ctx } = mk({ 'tasks/alpha.md': ALPHA });
    await expect(putAsk(ctx, 'ship-v2', base, 'cos')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'ship-v2', base, 'cos')).rejects.toThrow(/task ID/);
  });
  it('two creates of one key in different files: the second updates the first', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA, 'tasks/beta.md': ALPHA.replace('# Alpha', '# Beta') });
    const [a, b] = await Promise.all([putAsk(ctx, 'k1', { ...base, project: 'alpha' }, 'cos'), putAsk(ctx, 'k1', { ...base, project: 'beta', why: 'second' }, 'cos')]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const all = (await read(storage, 'tasks/alpha.md')) + (await read(storage, 'tasks/beta.md'));
    expect(all.match(/> id: k1$/gm)).toHaveLength(1);
  });
  it('two creates of one key in one file: one row', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    const r = await Promise.all([putAsk(ctx, 'k1', { ...base, project: 'alpha' }, 'cos'), putAsk(ctx, 'k1', { ...base, project: 'alpha', why: 'second' }, 'cos')]);
    expect(r.map((x) => x.created).sort()).toEqual([false, true]);
    expect((await read(storage, 'tasks/alpha.md')).match(/> id: k1$/gm)).toHaveLength(1);
  });
});

// @req FR:task-asks/format.detail
describe('detail and thread anywhere in the subtree', () => {
  it('an owner note before the detail keeps it, and a write does not duplicate it', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', { ...base, detail: 'The body' }, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'reply', text: 'first' });
    const lines = (await read(storage, 'tasks/asks.md')).split('\n');
    lines.splice(lines.indexOf('  > ## Detail'), 0, '  - owner note');
    storage.seed('tasks/asks.md', lines.join('\n'));
    const a = (await readAsk(ctx, 'k1'))!.ask;
    expect(a.detail).toBe('The body');
    expect(a.thread).toHaveLength(1);
    await handleAsk(ctx, 'k1', { outcome: 'reopen', reply: 'second' }, 'cos');
    const src = await read(storage, 'tasks/asks.md');
    expect(src.match(/> ## Detail/g)).toHaveLength(1);
    expect(src.match(/> ## Thread/g)).toHaveLength(1);
    expect(src.match(/> The body/g)).toHaveLength(1);
    expect(src).toContain('  - owner note');
    expect((await readAsk(ctx, 'k1'))!.ask.thread).toHaveLength(2);
  });
});

// @req FR:task-asks/format.key
describe('the ID lint names the ask key rule on ask rows', () => {
  it('says the ask key rule, not the slug rule', () => {
    const src = ['# A', '', '## S', '', '- [ ] 🙋 Do it', '  > id: Bad Key', '  > kind: approve', ''].join('\n');
    const issues = lintIds([{ path: 'tasks/a.md', content: src }]);
    expect(issues.map((i) => i.rule)).toEqual(['id-slug']);
    expect(issues[0].message).toMatch(/ask key/i);
    expect(issues[0].message).not.toMatch(/not a slug/);
  });
});

// @req FR:task-asks/core.reads
describe('one read per attempt', () => {
  const counting = (storage: MemoryStorage) => {
    let n = 0;
    const orig = storage.list.bind(storage);
    storage.list = async () => { n++; return orig(); };
    return () => { const v = n; n = 0; return v; };
  };
  it('put, answer, and handle list the task files once each (a create adds one key check)', async () => {
    const { storage, ctx } = mk({ 'tasks/alpha.md': ALPHA });
    const lists = counting(storage);
    await putAsk(ctx, 'k1', { ...base, project: 'alpha' }, 'cos');
    expect(lists()).toBe(2);
    await putAsk(ctx, 'k1', { why: 'changed' }, 'cos');
    expect(lists()).toBe(1);
    await answerAsk(ctx, 'k1', { answer: 'go' });
    expect(lists()).toBe(1);
    await handleAsk(ctx, 'k1', { outcome: 'handled' }, 'cos');
    expect(lists()).toBe(1);
  });
  it('resolveThreads lists the asks once', async () => {
    const { storage, ctx } = mk();
    for (const c of ['c1', 'c2', 'c3']) await putAsk(ctx, mailKey(c), { ...base, from: 'email', detail: `mail ${c}` }, 'email');
    const lists = counting(storage);
    await resolveThreads(ctx, ['nope']);
    expect(lists()).toBeLessThanOrEqual(2);
  });
});

// @req FR:task-asks/format.row
describe('ask keys as task IDs (Decisions)', () => {
  it('the ID lint accepts ask keys with . and _ up to 80 on ask rows only', async () => {
    const key = `perm.${'a'.repeat(60)}_x`;
    const { storage, ctx } = mk();
    await putAsk(ctx, key, base, 'cos');
    const src = await read(storage, 'tasks/asks.md');
    expect(lintIds([{ path: 'tasks/asks.md', content: src }])).toEqual([]);
    const plain = ['# A', '', '## S', '', '- [ ] Plain', `  > id: ${key}`, ''].join('\n');
    expect(lintIds([{ path: 'tasks/a.md', content: plain }]).map((i) => i.rule)).toEqual(['id-slug']);
  });
});
