/** @req FR:quick-triage/flow.fields @req FR:quick-triage/flow.actions @req FR:quick-triage/flow.apply @req FR:quick-triage/flow.text @req FR:quick-triage/flow.order */
import { answerAsk, formatAsk, listAsks, parseAsk, putAsk, type Ask } from '../../src/core/asks';
import { parseAction } from '../../src/core/ask-actions';
import { ConflictError, MemoryStorage } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';

const NOW = new Date('2026-10-29T14:00:00Z');
const FILE = `# Finance\n\n## 🔄 Active\n\n- [ ] Pay bills 💰 🟢\n- [ ] Renew the car registration\n  > due in November\n- [ ] Reply to the insurer\n`;

function mk() {
  const storage = new MemoryStorage();
  let tick = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) };
  return { storage, ctx };
}
const seed = async (storage: MemoryStorage) => { await storage.write('tasks/finance.md', FILE); };
const row = async (storage: MemoryStorage, n: number) => (await storage.read('tasks/finance.md')).content.split('\n')[n - 1];
const askOf = async (storage: MemoryStorage, key: string) => parseAsk(key, (await storage.read(`tasks/asks/${key}.md`)).content);
const base = { from: 'finance-cos', project: 'finance' };

describe('flow fields', () => {
  it('round-trip through the file format; bad values are dropped on parse', () => {
    const a: Ask = { key: 'q1', state: 'open', ask: 'Pay bills first?', kind: 'decide', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: NOW.toISOString(), updated: NOW.toISOString(), detail: '', thread: [], extra: [],
      options: ['Yes, critical', 'Later'], flow: 'triage-oct29', seq: 2, ref: 'finance:5', applies: ['set priority=🚨', 'suspend 7d'] };
    const p = parseAsk('q1', formatAsk(a));
    expect(p).toMatchObject({ flow: 'triage-oct29', seq: 2, ref: 'finance:5', applies: ['set priority=🚨', 'suspend 7d'] });
    const bad = parseAsk('q1', formatAsk(a).replace('seq: 2', 'seq: 500').replace('flow: triage-oct29', 'flow: Bad Flow').replace('ref: finance:5', 'ref: nope'));
    expect(bad.seq).toBeUndefined(); expect(bad.flow).toBeUndefined(); expect(bad.ref).toBeUndefined();
  });
  it('put refuses a bad flow, seq, ref (missing row), action, or applies count', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    const put = (over: object) => putAsk(ctx, 'q', { ...base, ask: 'Q', kind: 'approve', ...over }, 'cos');
    await expect(put({ flow: 'Bad Flow' })).rejects.toThrow(LifecycleError);
    await expect(put({ seq: 0 })).rejects.toThrow(LifecycleError);
    await expect(put({ ref: 'finance:99', apply: 'skip' })).rejects.toThrow(LifecycleError);
    await expect(put({ ref: 'finance:5', apply: 'delete' })).rejects.toThrow(LifecycleError);
    await expect(put({ ref: 'finance:5', kind: 'decide', options: ['A', 'B'], applies: ['skip'] })).rejects.toThrow(LifecycleError);
    await expect(put({ ref: 'finance:5', apply: 'set priority=🚨 effort=🟡' })).resolves.toMatchObject({ created: true });
  });
});

describe('actions', () => {
  it('parses the vocabulary and nothing else', () => {
    expect(parseAction('set priority=🚨 effort=🟡')).toEqual({ kind: 'set', props: { priority: '🚨', effort: '🟡' } });
    expect(parseAction('due Nov 3')).toEqual({ kind: 'due', date: 'Nov 3' });
    expect(parseAction('suspend 7d')).toEqual({ kind: 'suspend', days: 7 });
    expect(parseAction('suspend 2h')).toEqual({ kind: 'suspend', hours: 2 });
    for (const k of ['skip', 'complete', 'start', 'resume']) expect(parseAction(k)).toEqual({ kind: k });
    expect(parseAction('note Draft the denial letter')).toEqual({ kind: 'note', text: 'Draft the denial letter' });
    expect(parseAction('-')).toBeNull();
    for (const bad of ['delete', 'set color=red', 'set priority=🟢', 'suspend soon', 'due tomorrow', '']) expect(() => parseAction(bad)).toThrow(LifecycleError);
  });
});

describe('apply on answer', () => {
  it('go runs apply on the row and records it in the thread, in one write', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'q1', { ...base, ask: 'Make Pay bills critical?', kind: 'approve', ref: 'finance:4', apply: 'set priority=🚨', reversible: true }, 'cos');
    await answerAsk(ctx, 'q1', { answer: 'go' });
    expect(await row(storage, 5)).toBe('- [ ] 🚨 Pay bills 💰 🟢');
    const a = await askOf(storage, 'q1');
    expect(a.state).toBe('answered');
    expect(a.thread.at(-1)).toMatch(/^- \S+ applied: set priority=🚨 → - \[ \] 🚨 Pay bills 💰 🟢$/);
  });
  it('option runs the matching applies entry; "-" runs nothing; no runs nothing', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'q2', { ...base, ask: 'Car registration?', kind: 'decide', ref: 'finance:5', options: ['Add deadline', 'Park it', 'Leave'], applies: ['due Nov 3', 'suspend 7d', '-'] }, 'cos');
    await answerAsk(ctx, 'q2', { answer: 'option', text: 'Add deadline' });
    expect(await row(storage, 6)).toBe('- [ ] 📅 Nov 3: Renew the car registration');
    await putAsk(ctx, 'q3', { ...base, ask: 'Insurer?', kind: 'decide', ref: 'finance:7', options: ['Skip', 'Leave'], applies: ['skip', '-'] }, 'cos');
    await answerAsk(ctx, 'q3', { answer: 'option', text: 'Leave' });
    expect(await row(storage, 8)).toBe('- [ ] Reply to the insurer');
    await putAsk(ctx, 'q4', { ...base, ask: 'Skip the insurer?', kind: 'approve', ref: 'finance:7', apply: 'skip' }, 'cos');
    await answerAsk(ctx, 'q4', { answer: 'no' });
    expect(await row(storage, 8)).toBe('- [ ] Reply to the insurer');
  });
  it('a failed action records no answer and is a conflict', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'q5', { ...base, ask: 'Done with bills?', kind: 'approve', ref: 'finance:4', apply: 'complete' }, 'cos');
    await storage.write('tasks/finance.md', FILE.replace('- [ ] Pay bills 💰 🟢\n', ''));
    await expect(answerAsk(ctx, 'q5', { answer: 'go' })).rejects.toThrow(ConflictError);
    expect((await askOf(storage, 'q5')).state).toBe('open');
  });
  it('a note above a row moves it; a later ask still finds the row by its text; a reply retries once after a failed action', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'n1', { ...base, ask: 'Top of mind?', kind: 'answer', ref: 'finance:4' }, 'cos');
    await putAsk(ctx, 'n2', { ...base, ask: 'Make the registration critical?', kind: 'approve', ref: 'finance:5', apply: 'set priority=🚨' }, 'cos');
    await answerAsk(ctx, 'n1', { answer: 'reply', text: 'Taxes' }); // inserts a line after row 4: row 5 is now row 6
    await answerAsk(ctx, 'n2', { answer: 'go' });
    expect(await row(storage, 7)).toBe('- [ ] 🚨 Renew the car registration');
    expect((await askOf(storage, 'n2')).thread.at(-1)).toMatch(/applied: set priority=🚨/);
    // an edited row is a conflict: the ask reopens, nothing applied, and a retry would run once
    await putAsk(ctx, 'n3', { ...base, ask: 'Skip the insurer?', kind: 'approve', ref: 'finance:8', apply: 'skip' }, 'cos'); // the insurer row, one down after the note
    const file = (await storage.read('tasks/finance.md')).content;
    await storage.write('tasks/finance.md', file.replace('Reply to the insurer', 'Reply to the insurer today'));
    await expect(answerAsk(ctx, 'n3', { answer: 'go' })).rejects.toThrow(ConflictError);
    expect((await askOf(storage, 'n3')).state).toBe('open');
  });
  it('an answer to a question with a ref lands under the row as a note', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'q6', { ...base, ask: 'What is top of mind?', kind: 'answer', ref: 'finance:4' }, 'cos');
    await answerAsk(ctx, 'q6', { answer: 'reply', text: 'Taxes before anything else' });
    expect(await row(storage, 6)).toBe('  > 🙋 2026-10-29: Taxes before anything else');
    expect(await row(storage, 7)).toBe('- [ ] Renew the car registration');
  });
});

describe('flow order', () => {
  it('a flow lists together by seq at its best ask, with progress', async () => {
    const { storage, ctx } = mk(); await seed(storage);
    await putAsk(ctx, 'other', { ...base, ask: 'Unrelated', kind: 'approve', priority: 'high' }, 'cos');
    await putAsk(ctx, 'f2', { ...base, ask: 'Second', kind: 'approve', flow: 'tri', seq: 2 }, 'cos');
    await putAsk(ctx, 'f1', { ...base, ask: 'First', kind: 'answer', flow: 'tri', seq: 1 }, 'cos');
    await putAsk(ctx, 'f3', { ...base, ask: 'Third', kind: 'approve', flow: 'tri', seq: 3, priority: 'crit' }, 'cos');
    const list = await listAsks(ctx, { state: 'open' });
    expect(list.items.map((i) => i.key)).toEqual(['f1', 'f2', 'f3', 'other']);
    expect(list.items[0]).toMatchObject({ flow: 'tri', seq: 1, flowTotal: 3, flowDone: 0 });
    await answerAsk(ctx, 'f1', { answer: 'reply', text: 'ok' });
    const after = await listAsks(ctx, { state: 'open' });
    expect(after.items.map((i) => i.key)).toEqual(['f2', 'f3', 'other']);
    expect(after.items[0]).toMatchObject({ seq: 2, flowTotal: 3, flowDone: 1 });
  });
});
