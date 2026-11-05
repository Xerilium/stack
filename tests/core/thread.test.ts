/** @req FR:agent-thread/ask.ref @req FR:agent-thread/reply.entry */
import { apiRefOf, listAsks, parseAsk, putAsk } from '../../src/core/asks';
import { formatEntry, listInbox, parseInbox, replyFromAgent, sendToInbox } from '../../src/core/inbox';
import { MemoryStorage, NotFoundError } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';

const F4 = '# 🎧 Flantastic 4\n\n## 🔄 Active\n\n- [ ] Release the single 🟡\n- [ ] 🤖 Ship labels\n';
function mk() {
  const storage = new MemoryStorage();
  let t = 0;
  const ctx = { storage, now: () => new Date(Date.parse('2026-10-29T10:00:00Z') + 1000 * t++) };
  return { storage, ctx };
}

describe('asks belong to tasks', () => {
  it('stores the task as an api ref with its row text, lists it as an api ref, and follows a moved row', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await putAsk(ctx, 'q1', { ask: 'Which cover?', kind: 'answer', from: 'cid-manager', ref: 'flantastic-4:4' }, 'cid-manager');
    const raw = (await storage.read('tasks/asks/q1.md')).content;
    expect(raw).toContain('- ref: flantastic-4:4');
    expect(raw).toContain('- reftext: Release the single 🟡');
    expect(parseAsk('q1', raw)).toMatchObject({ ref: 'flantastic-4:4', refText: 'Release the single 🟡' });
    let list = await listAsks(ctx, { state: 'open' });
    expect(list.items[0]).toMatchObject({ key: 'q1', ref: 'flantastic-4:4', row: 'flantastic-4:4', task: 'Release the single 🟡' });
    expect(apiRefOf('tasks/a b.md:12')).toBe('a b:11');
    // A row added above moves the task; the ask still points at it.
    await storage.write('tasks/flantastic-4.md', F4.replace('- [ ] Release', '- [ ] New first\n- [ ] Release'));
    list = await listAsks(ctx, { state: 'open' });
    expect(list.items[0]).toMatchObject({ ref: 'flantastic-4:4', row: 'flantastic-4:5' });
  });
  it('refuses a bad or missing ref; an ask without one has no ref', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await expect(putAsk(ctx, 'q2', { ask: 'x', kind: 'answer', from: 'a', ref: 'nope' }, 'a')).rejects.toThrow(LifecycleError);
    await expect(putAsk(ctx, 'q2', { ask: 'x', kind: 'answer', from: 'a', ref: 'flantastic-4:99' }, 'a')).rejects.toThrow(NotFoundError);
    await expect(putAsk(ctx, 'q2', { ask: 'x', kind: 'answer', from: 'a', ref: 'ghost:1' }, 'a')).rejects.toThrow(NotFoundError);
    await putAsk(ctx, 'q3', { ask: 'x', kind: 'answer', from: 'a' }, 'a');
    const a = (await listAsks(ctx, { state: 'open' })).items[0];
    expect(a.ref).toBeUndefined();
    expect(a.row).toBeUndefined();
  });
});

describe('agent replies', () => {
  it('writes an entry from the agent, to the owner, already handled; v1 entries read as the owner', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await sendToInbox(ctx, { path: 'tasks/flantastic-4.md', line: 4 }, 'Can you take this?', 'reply');
    const r = await replyFromAgent(ctx, { path: 'tasks/flantastic-4.md', line: 4 }, 'Yes: cover first, then DistroKid. One question coming as an ask.', 'cid-manager');
    const raw = (await storage.read(r.path)).content;
    expect(raw).toContain('- from: agent\n- agent: cid-manager\n- ref: tasks/flantastic-4.md:5');
    const entries = parseInbox(raw);
    expect(entries[0].from).toBeUndefined();
    expect(entries[1]).toMatchObject({ from: 'agent', agent: 'cid-manager', to: 'human', state: 'handled', kind: 'reply', text: 'Yes: cover first, then DistroKid. One question coming as an ask.' });
    expect(parseInbox(formatEntry(entries[1]))[0]).toEqual(entries[1]);
    // The agent's reply is not in anyone's open queue; the owner's message still is.
    const open = await listInbox(ctx);
    expect(open.map((e) => e.text)).toEqual(['Can you take this?']);
    expect((await listInbox(ctx, { state: 'all' })).filter((e) => e.from === 'agent')).toHaveLength(1);
    await expect(replyFromAgent(ctx, { path: 'tasks/flantastic-4.md', line: 4 }, 'x', '')).rejects.toThrow(/agent is required/);
    await expect(replyFromAgent(ctx, { path: 'tasks/flantastic-4.md', line: 99 }, 'x', 'a')).rejects.toThrow(/not found/i);
  });
});
