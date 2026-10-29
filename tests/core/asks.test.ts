import { answerAsk, archiveAsks, archivePath, asksPath, formatAsk, handleAsk, listAsks, parseAsk, putAsk, scoreAsk, type Ask } from '../../src/core/asks';
import { ConflictError, MemoryStorage, NotFoundError, PathError, validatePath } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';

const NOW = new Date('2026-10-28T14:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

function mk() {
  const storage = new MemoryStorage();
  let tick = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) };
  return { storage, ctx };
}
const base = { ask: 'Approve merging PR 879 into dev', kind: 'approve' as const, from: 'allyte-cos' };

const ask = (over: Partial<Ask> = {}): Ask => ({
  key: 'pr-879-approve', state: 'open', ask: 'Approve merging PR 879 into dev', kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0,
  created: NOW.toISOString(), updated: NOW.toISOString(), detail: '', thread: [], extra: [], ...over,
});

// @req FR:ask-queue/ask.path
describe('ask path', () => {
  it('accepts tasks/asks/<key>.md and never lists it as a project', async () => {
    expect(validatePath('tasks/asks/pr-879-approve.md')).toBe('tasks/asks/pr-879-approve.md');
    for (const bad of ['tasks/asks/../x.md', 'tasks/asks/.x.md', 'tasks/asks/a/b.md', 'tasks/asks/README.md', 'tasks/asks/Upper.md']) expect(() => validatePath(bad)).toThrow(PathError);
    expect(asksPath('pr-879-approve')).toBe('tasks/asks/pr-879-approve.md');
    expect(() => asksPath('Bad Key')).toThrow(LifecycleError);
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    expect(await storage.list()).toEqual([]);
    expect(await storage.listAsks!()).toEqual(['tasks/asks/k1.md']);
  });
});

// @req FR:ask-queue/ask.format
describe('ask format', () => {
  it('round-trips every field', () => {
    const a = ask({
      project: 'allyte', why: 'Go-live is Oct 29', recommend: 'Approve', default: 'Merges Oct 29 8:00am', by: at(20), reversible: true, link: 'https://github.com/o/r/pull/879',
      priority: 'high', effort: '2m', blocks: 3, answer: 'go', text: 'ok', answered: at(1), outcome: 'handled', handled: `${at(2)} by cos`, note: 'merged', snoozed: at(5), state: 'done',
      detail: 'Long body.\n\nSecond paragraph.', thread: [`- ${at(1)} you: ok`],
    });
    const text = formatAsk(a);
    expect(text).toContain('<!-- stack-ask v1');
    expect(parseAsk('pr-879-approve', text)).toEqual(a);
  });
  it('options for decide round-trip', () => {
    const a = ask({ kind: 'decide', options: ['Ship Friday', 'Ship Monday'], recommend: 'Ship Monday' });
    expect(parseAsk(a.key, formatAsk(a)).options).toEqual(['Ship Friday', 'Ship Monday']);
  });
  it('is tolerant: defaults for missing fields, drops bad ones, keeps unknown lines', () => {
    const p = parseAsk('x', '# Ask: x\n\n- ask: Do it\n- kind: nonsense\n- by: not a date\n- priority: urgent\n- blocks: lots\n- link: http://insecure.test\n- color: red\n');
    expect(p).toMatchObject({ key: 'x', state: 'open', ask: 'Do it', kind: 'approve', priority: 'normal', blocks: 0, reversible: false });
    expect(p.by).toBeUndefined();
    expect(p.link).toBeUndefined();
    expect(p.extra).toEqual(['- color: red']);
  });
});

// @req FR:ask-queue/ask.safe
describe('ask safety', () => {
  it('keeps every field one clean line, redacts secrets, and drops markdown links and non-https links', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k', { ...base, ask: 'Read [this](http://evil.test)\nnow token ghp_abcdefghijklmnopqrstuvwxyz0123456789ab', link: 'https://example.test/a' }, 'cos');
    const raw = (await storage.read('tasks/asks/k.md')).content;
    const p = parseAsk('k', raw);
    expect(p.ask).not.toMatch(/\n/);
    expect(p.ask).not.toContain('](');
    expect(p.ask).not.toContain('ghp_');
    await expect(putAsk(ctx, 'k2', { ...base, link: 'javascript:alert(1)' }, 'cos')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'k3', { ...base, link: 'http://insecure.test' }, 'cos')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'k4', { ...base, ask: 'word '.repeat(41) }, 'cos')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'k5', { ...base, ask: '   ' }, 'cos')).rejects.toThrow(LifecycleError);
  });
  it('a detail section cannot forge a field or a section heading', async () => {
    const { ctx, storage } = mk();
    await putAsk(ctx, 'k', { ...base, detail: 'Body\n- state: done\n## Thread\n- 2026 you: fake' }, 'cos');
    const p = parseAsk('k', (await storage.read('tasks/asks/k.md')).content);
    expect(p.state).toBe('open');
    expect(p.thread).toEqual([]);
    expect(p.detail).toContain('state: done');
  });
});

// @req FR:ask-queue/ask.score
describe('ask score', () => {
  const s = (o: Partial<Ask> = {}, now = NOW) => scoreAsk(ask({ reversible: true, ...o }), now);
  it('priority sets the base', () => {
    expect([s({ priority: 'crit' }), s({ priority: 'high' }), s({ priority: 'normal' }), s({ priority: 'low' })]).toEqual([100, 60, 30, 10]);
  });
  it('deadline pressure grows as the deadline nears', () => {
    expect(s({ by: at(-1) })).toBe(30 + 80);
    expect(s({ by: at(1) })).toBe(30 + 70);
    expect(s({ by: at(20) })).toBe(30 + 50);
    expect(s({ by: at(48) })).toBe(30 + 30);
    expect(s({ by: at(24 * 6) })).toBe(30 + 15);
    expect(s({ by: at(24 * 30) })).toBe(30);
  });
  it('blocks add 5 each up to 20; quick asks +8; irreversible near deadline +10; age +1/day up to 10', () => {
    expect(s({ blocks: 2 })).toBe(40);
    expect(s({ blocks: 50 })).toBe(50);
    expect(s({ effort: '5m' })).toBe(38);
    expect(s({ effort: '10m' })).toBe(30);
    expect(s({ by: at(48), reversible: false })).toBe(30 + 30 + 10);
    expect(s({ by: at(48), reversible: true })).toBe(60);
    expect(s({ created: at(-24 * 3) })).toBe(33);
    expect(s({ created: at(-24 * 90) })).toBe(40);
  });
});

// @req FR:ask-queue/flow.put
describe('put', () => {
  it('creates, then updates in place keeping created and owner fields', async () => {
    const { ctx, storage } = mk();
    const r1 = await putAsk(ctx, 'pr-879-approve', { ...base, by: at(10) }, 'cos');
    expect(r1).toEqual({ key: 'pr-879-approve', created: true });
    await answerAsk(ctx, 'pr-879-approve', { answer: 'reply', text: 'why?' });
    const first = parseAsk('pr-879-approve', (await storage.read('tasks/asks/pr-879-approve.md')).content);
    const r2 = await putAsk(ctx, 'pr-879-approve', { ...base, ask: 'Approve merging 879 now', by: at(2) }, 'cos');
    expect(r2.created).toBe(false);
    const p = parseAsk('pr-879-approve', (await storage.read('tasks/asks/pr-879-approve.md')).content);
    expect(p.ask).toBe('Approve merging 879 now');
    expect(p.created).toBe(first.created);
    expect(p.answer).toBe('reply');
    expect(p.updated > first.updated).toBe(true);
  });
  it('requires ask, kind and from on create; from defaults to the actor', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'a', { kind: 'approve', from: 'x' } as never, 'cos')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'b', { ask: 'x', from: 'x' } as never, 'cos')).rejects.toThrow(LifecycleError);
    await putAsk(ctx, 'c', { ask: 'x', kind: 'approve' }, 'cos');
    expect((await listAsks(ctx)).items[0].from).toBe('cos');
  });
  it('validates kind, options, priority, by, reversible, effort and blocks', async () => {
    const { ctx } = mk();
    for (const bad of [{ kind: 'nope' }, { options: ['only one'], kind: 'decide' }, { options: ['a', 'b', 'c', 'd', 'e'], kind: 'decide' }, { priority: 'urgent' }, { by: 'tomorrow-ish' }, { effort: 'long' }, { blocks: -1 }, { blocks: 100 }, { reversible: 'maybe' }]) {
      await expect(putAsk(ctx, 'v', { ...base, ...bad } as never, 'cos')).rejects.toThrow(LifecycleError);
    }
  });
  it('agents cannot write owner fields; a done ask needs reopen', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'o', { ...base, answer: 'go' } as never, 'cos')).rejects.toThrow(LifecycleError);
    await putAsk(ctx, 'd', base, 'cos');
    await answerAsk(ctx, 'd', { answer: 'go' });
    await handleAsk(ctx, 'd', { outcome: 'handled' }, 'cos');
    await expect(putAsk(ctx, 'd', base, 'cos')).rejects.toThrow(ConflictError);
    await putAsk(ctx, 'd', { ...base, reopen: true }, 'cos');
    const it = (await listAsks(ctx)).items.find((a) => a.key === 'd')!;
    expect(it.state).toBe('open');
    expect(it.answer).toBeUndefined();
  });
});

// @req FR:ask-queue/flow.answer
describe('answer', () => {
  it('go / no / done mark the ask answered', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await answerAsk(ctx, 'a', { answer: 'go' });
    const a = (await listAsks(ctx, { state: 'answered' })).items[0];
    expect(a).toMatchObject({ key: 'a', state: 'answered', answer: 'go' });
    expect(a.answered).toBeDefined();
    expect((await listAsks(ctx)).items).toHaveLength(0);
  });
  it('option must be one of the options; reply and ask need text', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'd', { ask: 'When to ship?', kind: 'decide', from: 'cos', options: ['Fri', 'Mon'] }, 'cos');
    await expect(answerAsk(ctx, 'd', { answer: 'option', text: 'Tue' })).rejects.toThrow(LifecycleError);
    await expect(answerAsk(ctx, 'd', { answer: 'reply' })).rejects.toThrow(LifecycleError);
    await expect(answerAsk(ctx, 'd', { answer: 'ask', text: 'word '.repeat(201) })).rejects.toThrow(LifecycleError);
    await answerAsk(ctx, 'd', { answer: 'option', text: 'Mon' });
    expect((await listAsks(ctx, { state: 'answered' })).items[0]).toMatchObject({ answer: 'option', text: 'Mon' });
  });
  it('reply and ask add a thread line', async () => {
    const { ctx, storage } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await answerAsk(ctx, 'a', { answer: 'ask', text: 'Is CI green?' });
    expect(parseAsk('a', (await storage.read('tasks/asks/a.md')).content).thread[0]).toMatch(/you: Is CI green\?$/);
  });
  it('defer snoozes the ask out of the list and brings it back after; clamps to by when reversible with a default', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await answerAsk(ctx, 'a', { answer: 'defer', until: at(5) });
    expect((await listAsks(ctx)).items).toHaveLength(0);
    expect((await listAsks(ctx)).snoozed).toBe(1);
    expect((await listAsks(ctx, { state: 'snoozed' })).items.map((i) => i.key)).toEqual(['a']);
    expect((await listAsks(ctx, {}, new Date(at(6)))).items).toHaveLength(1);
    expect((await listAsks(ctx, {}, new Date(at(6)))).snoozed).toBe(0);
    await putAsk(ctx, 'b', { ...base, reversible: true, default: 'Merges at 8', by: at(3) }, 'cos');
    await answerAsk(ctx, 'b', { answer: 'defer', until: at(30) });
    const b = (await listAsks(ctx, { state: 'all' })).items.find((x) => x.key === 'b')!;
    expect(b.snoozed).toBe(at(3));
    await putAsk(ctx, 'c', { ...base, reversible: true, default: 'Merges at 8', by: at(-3) }, 'cos');
    await answerAsk(ctx, 'c', { answer: 'defer', until: at(30) });
    expect((await listAsks(ctx, { state: 'all' })).items.find((x) => x.key === 'c')!.snoozed).toBe(at(30));
    await expect(answerAsk(ctx, 'a', { answer: 'defer' })).rejects.toThrow(LifecycleError);
    await expect(answerAsk(ctx, 'a', { answer: 'defer', until: at(-5) })).rejects.toThrow(LifecycleError);
  });
  it('retract returns an answered ask to open; answering a non-open ask is a conflict', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await answerAsk(ctx, 'a', { answer: 'go' });
    await expect(answerAsk(ctx, 'a', { answer: 'no' })).rejects.toThrow(ConflictError);
    await answerAsk(ctx, 'a', { answer: 'retract' });
    const a = (await listAsks(ctx)).items[0];
    expect(a.state).toBe('open');
    expect(a.answer).toBeUndefined();
    await expect(answerAsk(ctx, 'a', { answer: 'retract' })).rejects.toThrow(ConflictError);
    await expect(answerAsk(ctx, 'zzz', { answer: 'go' })).rejects.toThrow(NotFoundError);
  });
});

// @req FR:ask-queue/flow.handle @req FR:ask-queue/flow.thread
describe('handle', () => {
  it('handled / resolved / defaulted close the ask; second call changes nothing', async () => {
    const { ctx } = mk();
    for (const outcome of ['handled', 'resolved', 'defaulted'] as const) {
      await putAsk(ctx, outcome, base, 'cos');
      expect(await handleAsk(ctx, outcome, { outcome, note: 'did it' }, 'cos')).toEqual({ changed: true });
      expect(await handleAsk(ctx, outcome, { outcome }, 'cos')).toEqual({ changed: false });
    }
    const done = (await listAsks(ctx, { state: 'done' })).items;
    expect(done.map((d) => d.outcome).sort()).toEqual(['defaulted', 'handled', 'resolved']);
    expect(done[0].handled).toMatch(/ by cos$/);
  });
  it('reopen answers the owner: back to open with the agent reply in the thread', async () => {
    const { ctx, storage } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await answerAsk(ctx, 'a', { answer: 'ask', text: 'Is CI green?' });
    await handleAsk(ctx, 'a', { outcome: 'reopen', reply: 'Yes, all 14 checks pass.' }, 'cos');
    const raw = parseAsk('a', (await storage.read('tasks/asks/a.md')).content);
    expect(raw.state).toBe('open');
    expect(raw.answer).toBeUndefined();
    expect(raw.thread).toHaveLength(2);
    expect(raw.thread[1]).toMatch(/cos: Yes, all 14 checks pass\.$/);
    expect((await listAsks(ctx)).items[0].agentReply).toBe('Yes, all 14 checks pass.');
  });
  it('unknown key is not found; bad outcome is rejected', async () => {
    const { ctx } = mk();
    await expect(handleAsk(ctx, 'nope', { outcome: 'handled' }, 'cos')).rejects.toThrow(NotFoundError);
    await putAsk(ctx, 'a', base, 'cos');
    await expect(handleAsk(ctx, 'a', { outcome: 'bogus' as never }, 'cos')).rejects.toThrow(LifecycleError);
  });
});

// @req FR:ask-queue/ask.rank @req FR:ask-queue/flow.default
describe('list and rank', () => {
  it('sorts by score, then earlier by, then older created; marks overdue', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'low', { ...base, priority: 'low' }, 'cos');
    await putAsk(ctx, 'late', { ...base, by: at(-1) }, 'cos');
    await putAsk(ctx, 'crit', { ...base, priority: 'crit' }, 'cos');
    await putAsk(ctx, 'b-tie', base, 'cos');
    await putAsk(ctx, 'a-tie', base, 'cos');
    const { items, total } = await listAsks(ctx, {}, NOW);
    expect(items.map((i) => i.key)).toEqual(['late', 'crit', 'b-tie', 'a-tie', 'low']);
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(items.find((i) => i.key === 'late')!.overdue).toBe(true);
    expect(total).toBe(5);
  });
  it('limit, latest, and state filters', async () => {
    const { ctx } = mk();
    for (const k of ['a', 'b', 'c']) await putAsk(ctx, k, base, 'cos');
    const r = await listAsks(ctx, { limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(3);
    expect(r.latest).toBeDefined();
    await answerAsk(ctx, 'a', { answer: 'go' });
    expect((await listAsks(ctx, { state: 'all' })).items).toHaveLength(3);
    expect((await listAsks(ctx, { state: 'answered' })).items.map((i) => i.key)).toEqual(['a']);
    await expect(listAsks(ctx, { state: 'bogus' as never })).rejects.toThrow(LifecycleError);
  });
  it('a bad file is skipped, not fatal', async () => {
    const { ctx, storage } = mk();
    await storage.write('tasks/asks/junk.md', '\u0000\u0000 not an ask');
    await putAsk(ctx, 'good', base, 'cos');
    expect((await listAsks(ctx)).items.map((i) => i.key)).toEqual(['good']);
  });
});

// @req FR:ask-queue/ask.archive
describe('archiveAsks', () => {
  it('moves done asks older than the window to tasks/asks/archive in one write; open, answered and recent ones stay', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'old-done', base, 'cos');
    await handleAsk(ctx, 'old-done', { outcome: 'handled' }, 'cos');
    await putAsk(ctx, 'open', base, 'cos');
    await putAsk(ctx, 'answered', base, 'cos');
    await answerAsk(ctx, 'answered', { answer: 'go' });
    const later = { storage, now: () => new Date(NOW.getTime() + 20 * 86_400_000) };
    await putAsk(later, 'new-done', base, 'cos');
    await handleAsk(later, 'new-done', { outcome: 'resolved' }, 'cos');
    const writes: string[][] = [];
    const orig = storage.writeMany.bind(storage);
    storage.writeMany = async (w) => { writes.push(w.map((x) => x.path)); return orig(w); };
    expect(await archiveAsks(later, { days: 14 })).toEqual({ archived: ['old-done'] });
    expect(writes).toEqual([[archivePath('old-done'), asksPath('old-done')]]);
    expect((await storage.read(archivePath('old-done'))).content).toContain('- state: done');
    await expect(storage.read(asksPath('old-done'))).rejects.toBeInstanceOf(NotFoundError);
    expect((await listAsks(later, { state: 'all' })).items.map((a) => a.key).sort()).toEqual(['answered', 'new-done', 'open']);
    expect(await archiveAsks(later, { days: 14 })).toEqual({ archived: [] });
    expect(await archiveAsks(later, { days: 0 })).toEqual({ archived: ['new-done'] });
    await expect(archiveAsks(later, { days: -1 })).rejects.toThrow(LifecycleError);
    expect(() => validatePath('tasks/asks/archive/Bad.md')).toThrow(PathError);
  });
  it('never overwrites an earlier archive of a reused key', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'mail-1', base, 'cos');
    await handleAsk(ctx, 'mail-1', { outcome: 'resolved' }, 'cos');
    await archiveAsks(ctx, { days: 0 });
    const first = (await storage.read(archivePath('mail-1'))).content;
    await putAsk(ctx, 'mail-1', { ...base, ask: 'The thread came back' }, 'cos');
    await handleAsk(ctx, 'mail-1', { outcome: 'handled' }, 'cos');
    expect(await archiveAsks(ctx, { days: 0 })).toEqual({ archived: ['mail-1'] });
    expect((await storage.read(archivePath('mail-1'))).content).toBe(first);
    expect((await storage.read(archivePath('mail-1.20261028'))).content).toContain('The thread came back');
    await putAsk(ctx, 'mail-1', base, 'cos');
    await handleAsk(ctx, 'mail-1', { outcome: 'handled' }, 'cos');
    expect(await archiveAsks(ctx, { days: 0 })).toEqual({ archived: [] });
    expect((await listAsks(ctx, { state: 'done' })).items.map((a) => a.key)).toEqual(['mail-1']);
    // the longest allowed key still gets a dated name within the path limit
    const long = 'k'.repeat(80);
    for (let i = 0; i < 2; i++) { await putAsk(ctx, long, base, 'cos'); await handleAsk(ctx, long, { outcome: 'handled' }, 'cos'); expect(await archiveAsks(ctx, { days: 0 })).toEqual({ archived: [long] }); }
    expect(await storage.listAsks!()).toEqual([asksPath('mail-1')]);
    expect(await storage.read(archivePath(`${'k'.repeat(71)}.20261028`))).toBeTruthy();
    // a done ask whose updated cannot be read is left in place
    await storage.write(asksPath('odd'), formatAsk(ask({ key: 'odd', state: 'done', updated: 'yesterday' })));
    expect(await archiveAsks(ctx, { days: 0 })).toEqual({ archived: [] });
  });
});

describe('listAsks cache', () => {
  it('parses a file once per version and forgets files that went away', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'a', base, 'cos');
    await putAsk(ctx, 'b', base, 'cos');
    const reads: string[] = [];
    const origRead = storage.read.bind(storage);
    storage.read = async (p) => { reads.push(p); return origRead(p); };
    const first = await listAsks(ctx);
    const second = await listAsks(ctx);
    expect(second.items).toEqual(first.items);
    expect(reads.length).toBe(4); // every file is still read (its version decides), but the parse is reused
    await answerAsk(ctx, 'a', { answer: 'go' });
    expect((await listAsks(ctx)).items.map((i) => i.key)).toEqual(['b']);
    await archiveAsks({ storage, now: () => new Date(NOW.getTime() + 30 * 86_400_000) }, { days: 0 });
    expect((await listAsks(ctx, { state: 'all' })).items.map((i) => i.key)).toEqual(['a', 'b']);
  });
});

