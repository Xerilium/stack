import { answerNeed, NEEDS_PATH, readNeeds } from '../../src/core/needs-you';
import { MemoryStorage, NotFoundError, StorageError } from '../../src/core/storage';

const item = (over: Record<string, unknown> = {}) => ({ id: 'pay-bills', title: 'Pay bills tonight', recommendation: 'Pay USAA first', default: 'I wait', link: 'https://example.com/x', ...over });
const mk = async (items: unknown, extra: Record<string, unknown> = {}) => {
  const s = new MemoryStorage();
  await s.writeAux(NEEDS_PATH, JSON.stringify({ items, ...extra }), { expectedVersion: null });
  return s;
};
const NOW = new Date('2026-11-01T20:00:00Z');

describe('readNeeds', () => {
  // @req FR:ask-queue/needs.@json @req FR:ask-queue/needs.read @req FR:ask-queue/$need
  it('returns the valid items in file order and skips the rest; no file or a broken file has none', async () => {
    const s = await mk([
      item({ id: 'back', link: '/\\evil.example' }), item({ id: 'slash', link: '/etc/passwd' }), item({ id: 'bs', link: 'docs\\x.md' }),
      item(), item({ id: 'b', title: '' }), item({ id: 'Bad Id' }), item({ id: 'c', link: 'javascript:alert(1)' }),
      item({ id: 'd', recommendation: '' }), item({ id: 'e', link: 'docs/plan.md', ref: 'finance:12', project: 'finance' }), 'junk', null,
    ]);
    expect((await readNeeds(s)).map((n) => n.id)).toEqual(['pay-bills', 'e']);
    expect(await readNeeds(new MemoryStorage())).toEqual([]);
    const bad = new MemoryStorage(); await bad.writeAux(NEEDS_PATH, '{oops', { expectedVersion: null });
    expect(await readNeeds(bad)).toEqual([]);
  });
});

describe('answerNeed', () => {
  // @req FR:ask-queue/needs.answer
  it('writes the answer onto the item, stamped, and keeps everything else in the file as written', async () => {
    const s = await mk([item(), item({ id: 'two', extra: 'kept' })], { note: 'CoS note' });
    await answerNeed(s, 'pay-bills', { choice: 'go' }, NOW);
    const raw = JSON.parse((await s.readAux!(NEEDS_PATH))!.content);
    expect(raw.note).toBe('CoS note');
    expect(raw.items[1]).toMatchObject({ id: 'two', extra: 'kept' });
    expect(raw.items[0].answer).toEqual({ choice: 'go', at: NOW.toISOString() });
    expect((await readNeeds(s))[0].answer?.choice).toBe('go');
  });
  // @req FR:ask-queue/needs.answer
  it('defer needs until, reply needs text; undo clears the answer', async () => {
    const s = await mk([item()]);
    await expect(answerNeed(s, 'pay-bills', { choice: 'defer' }, NOW)).rejects.toBeInstanceOf(StorageError);
    await expect(answerNeed(s, 'pay-bills', { choice: 'reply', text: ' ' }, NOW)).rejects.toBeInstanceOf(StorageError);
    await answerNeed(s, 'pay-bills', { choice: 'defer', until: '2026-12-01T09:00:00Z' }, NOW);
    expect((await readNeeds(s))[0].answer).toMatchObject({ choice: 'defer', until: '2026-12-01T09:00:00Z' });
    await answerNeed(s, 'pay-bills', { choice: 'reply', text: 'Pay Visa first' }, NOW);
    expect((await readNeeds(s))[0].answer).toMatchObject({ choice: 'reply', text: 'Pay Visa first' });
    await answerNeed(s, 'pay-bills', { choice: 'undo' }, NOW);
    expect((await readNeeds(s))[0].answer).toBeUndefined();
  });
  // @req FR:ask-queue/needs.answer
  it('a defer needs a real time, and a lost race with the CoS is retried once on the fresh file', async () => {
    const s = await mk([item()]);
    await expect(answerNeed(s, 'pay-bills', { choice: 'defer', until: 'tomorrow-ish' }, NOW)).rejects.toBeInstanceOf(StorageError);
    const real = s.writeAux.bind(s);
    let raced = false;
    s.writeAux = async (p, c, o) => { if (!raced) { raced = true; await real(p, JSON.stringify({ items: [item(), item({ id: 'cos-added' })] }), { expectedVersion: o.expectedVersion }); } return real(p, c, o); };
    await answerNeed(s, 'pay-bills', { choice: 'go' }, NOW);
    const got = await readNeeds(s);
    expect(got.map((n) => n.id)).toEqual(['pay-bills', 'cos-added']); // the CoS edit survived
    expect(got[0].answer?.choice).toBe('go');
  });
  // @req FR:ask-queue/needs.answer.missing
  it('an unknown id is NotFoundError and nothing is written', async () => {
    const s = await mk([item()]);
    const before = (await s.readAux!(NEEDS_PATH))!.version;
    await expect(answerNeed(s, 'nope', { choice: 'go' }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect((await s.readAux!(NEEDS_PATH))!.version).toBe(before);
    await expect(answerNeed(new MemoryStorage(), 'x', { choice: 'go' }, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});
