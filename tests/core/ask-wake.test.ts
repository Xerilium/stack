/** @req FR:ask-queue/wake.path @req FR:ask-queue/wake.write @req FR:ask-queue/wake.clear @req FR:ask-queue/wake.fail */
import { answerAsk, handleAsk, putAsk } from '../../src/core/asks';
import { wakePath } from '../../src/core/ask-wake';
import { MemoryStorage, PathError, validatePath } from '../../src/core/storage';

const NOW = new Date('2026-10-28T14:00:00Z');
function mk() {
  const storage = new MemoryStorage();
  let tick = 0;
  return { storage, ctx: { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) } };
}
const base = { ask: 'Approve PR 879', kind: 'approve' as const, from: 'Allyte CoS' };
const wake = async (s: MemoryStorage, slug = 'allyte-cos') => { try { return (await s.read(`tasks/wake/${slug}.md`)).content; } catch { return null; } };

describe('wake path', () => {
  it('slugs the agent and is a valid storage path', () => {
    expect(wakePath('Allyte CoS')).toBe('tasks/wake/allyte-cos.md');
    expect(validatePath('tasks/wake/allyte-cos.md')).toBe('tasks/wake/allyte-cos.md');
    expect(() => validatePath('tasks/wake/../x.md')).toThrow(PathError);
    expect(() => validatePath('tasks/wake/README.md')).toThrow(PathError);
  });
  it('is never a project', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'go' });
    expect(await storage.list()).toEqual([]);
  });
});

describe('wake write', () => {
  it('notes the answer for the originating agent, without answer text', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', { ...base, kind: 'answer' }, 'cos');
    expect(await wake(storage)).toBeNull();
    await answerAsk(ctx, 'k1', { answer: 'reply', text: 'secret words' });
    const w = (await wake(storage))!;
    expect(w).toContain('# Wake: allyte-cos');
    expect(w).toMatch(/^- 2026-10-28T14:00:\d\d\.000Z k1 reply$/m);
    expect(w).not.toContain('secret words');
  });
  it('keeps one line per key and one per ask', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await putAsk(ctx, 'k2', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'go' });
    await answerAsk(ctx, 'k2', { answer: 'no' });
    await answerAsk(ctx, 'k1', { answer: 'retract' });
    await answerAsk(ctx, 'k1', { answer: 'no' });
    const lines = (await wake(storage))!.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.includes(' k1 '))).toEqual([expect.stringMatching(/ k1 no$/)]);
  });
  it('does not write for defer', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'defer', until: '2026-10-30T00:00:00Z' });
    expect(await wake(storage)).toBeNull();
  });
});

describe('wake clear', () => {
  it('handle removes the line and keeps the file', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'go' });
    await handleAsk(ctx, 'k1', { outcome: 'handled' }, 'allyte-cos');
    const w = (await wake(storage))!;
    expect(w).toContain('# Wake: allyte-cos');
    expect(w).not.toContain(' k1 ');
  });
  it('retract removes the line', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    await answerAsk(ctx, 'k1', { answer: 'go' });
    await answerAsk(ctx, 'k1', { answer: 'retract' });
    expect((await wake(storage))!).not.toContain(' k1 ');
  });
});

describe('wake fail', () => {
  it('a wake write failure never undoes the answer', async () => {
    const { storage, ctx } = mk();
    await putAsk(ctx, 'k1', base, 'cos');
    const w = storage.write.bind(storage);
    storage.write = (async (p: string, ...r: any[]) => { if (p.startsWith('tasks/wake/')) throw new Error('disk'); return (w as any)(p, ...r); }) as any;
    await expect(answerAsk(ctx, 'k1', { answer: 'go' })).resolves.toEqual({ changed: true });
    expect((await storage.read('tasks/asks/k1.md')).content).toContain('state: answered');
  });
});
