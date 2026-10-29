import { formatEntry, handleEntry, INBOX_HEADER, listInbox, parseInbox, sendToInbox, type InboxEntry } from '../../src/core/inbox';
import { parseProject } from '../../src/core/parser';
import { ConflictError, MemoryStorage, PathError, validatePath } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';

const NOW = new Date('2026-10-28T14:03:11Z');
const DOC = `# Alpha

## 🔄 Active

- [ ] Ship the web app
  - [ ] 🪄 Draft the release notes https://github.com/o/r/pull/7
  - [ ] 🙋 Pick a launch date
`;

async function mk(doc = DOC) {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', doc);
  let tick = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) };
  return { storage, ctx };
}

const entry = (over: Partial<InboxEntry> = {}): InboxEntry => ({
  id: 'in-20261028T140311Z-3f9a', at: '2026-10-28T14:03:11.000Z', state: 'open', kind: 'reply', to: 'agent',
  ref: 'tasks/alpha.md:6', task: 'Draft the release notes', text: 'Keep it short.', extra: [], ...over,
});

// @req FR:agent-inbox/inbox.path
describe('inbox path', () => {
  it('accepts tasks/inbox/<name>.md and never lists it as a project', async () => {
    expect(validatePath('tasks/inbox/alpha.md')).toBe('tasks/inbox/alpha.md');
    for (const bad of ['tasks/inbox/../x.md', 'tasks/inbox/.x.md', 'tasks/inbox/a/b.md', 'tasks/inbox/README.md']) expect(() => validatePath(bad)).toThrow(PathError);
    const { storage, ctx } = await mk();
    await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'hi', 'reply');
    expect(await storage.list()).toEqual(['tasks/alpha.md']);
  });
});

// @req FR:agent-inbox/inbox.format
describe('inbox format', () => {
  it('round-trips an entry and keeps unknown lines', () => {
    const e = entry({ extra: ['- custom: kept'] });
    const text = `${INBOX_HEADER('Alpha')}${formatEntry(e)}`;
    expect(text).toContain('# Alpha inbox');
    expect(text).toContain('<!-- stack-inbox v1');
    expect(formatEntry(e)).toBe([
      '## in-20261028T140311Z-3f9a', '', '- at: 2026-10-28T14:03:11.000Z', '- state: open', '- kind: reply', '- to: agent',
      '- ref: tasks/alpha.md:6', '- task: Draft the release notes', '- text: Keep it short.', '- custom: kept', '',
    ].join('\n'));
    expect(parseInbox(text)).toEqual([e]);
  });
  it('parses handled entries with a note', () => {
    const e = entry({ state: 'handled', handled: '2026-10-28T15:00:00.000Z by token:abc', note: 'Done in PR 9' });
    expect(parseInbox(formatEntry(e))).toEqual([e]);
  });
});

// @req FR:agent-inbox/inbox.send @req FR:agent-inbox/inbox.id
describe('send', () => {
  it('appends an entry for the row and leaves the task file alone', async () => {
    const { storage, ctx } = await mk();
    const r = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'Keep it short.', 'reply');
    expect(r.id).toMatch(/^in-20261028T140311Z-[0-9a-f]{4}$/);
    expect(r.path).toBe('tasks/inbox/alpha.md');
    const f = (await storage.read('tasks/inbox/alpha.md')).content;
    expect(f.startsWith('# Alpha inbox\n')).toBe(true);
    expect(parseInbox(f)).toEqual([expect.objectContaining({ id: r.id, kind: 'reply', to: 'agent', ref: 'tasks/alpha.md:6', task: 'Draft the release notes https://github.com/o/r/pull/7', text: 'Keep it short.', state: 'open' })]);
    expect((await storage.read('tasks/alpha.md')).content).toBe(DOC);
    const r2 = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 6 }, 'June 3', 'decision');
    expect(r2.id).not.toBe(r.id);
    expect(parseInbox((await storage.read('tasks/inbox/alpha.md')).content).map((e) => [e.kind, e.to])).toEqual([['reply', 'agent'], ['decision', 'human']]);
  });
  it('marks plain rows as to: none', async () => {
    const { storage, ctx } = await mk();
    await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 4 }, 'x', 'reply');
    expect(parseInbox((await storage.read('tasks/inbox/alpha.md')).content)[0].to).toBe('none');
  });
  it('refuses a missing row, a stale expect, and bad text', async () => {
    const { ctx } = await mk();
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 2 }, 'x', 'reply')).rejects.toThrow(LifecycleError);
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'x', 'reply', 'other text')).rejects.toThrow(ConflictError);
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, '', 'reply')).rejects.toThrow(LifecycleError);
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'a\nb', 'reply')).rejects.toThrow(LifecycleError);
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'x'.repeat(1001), 'reply')).rejects.toThrow(LifecycleError);
  });
  it('compares expect with the row text as the parser reads it (one space after the checkbox)', async () => {
    const doc = '# Alpha\n\n## Active\n\n- [ ]  🤖 Two spaces\n';
    const { ctx } = await mk(doc);
    const row = parseProject(doc).sections.flatMap((x) => x.tasks)[0];
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 4 }, 'x', 'reply', row.text)).resolves.toMatchObject({ path: 'tasks/inbox/alpha.md' });
  });
  it('redacts secrets and escapes markdown', async () => {
    const { storage, ctx } = await mk();
    await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'use token ghp_abcdefghijklmnop and ![x](https://evil.test/a.png)', 'reply');
    const f = (await storage.read('tasks/inbox/alpha.md')).content;
    expect(f).not.toContain('ghp_');
    expect(f).toContain('\\[x\\]');
  });
});

// @req FR:agent-inbox/inbox.list
describe('list', () => {
  it('returns open entries by default, all on request, filtered by project', async () => {
    const { storage, ctx } = await mk();
    await storage.write('tasks/beta.md', '# Beta\n\n## Active\n\n- [ ] 🤖 Fix build\n');
    const a = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'one', 'reply');
    await sendToInbox(ctx, { path: 'tasks/beta.md', line: 4 }, 'two', 'reply');
    await handleEntry(ctx, a.id, 'token:x');
    expect((await listInbox(ctx)).map((e) => e.text)).toEqual(['two']);
    expect((await listInbox(ctx, { state: 'all' })).map((e) => [e.project, e.text, e.state])).toEqual([['alpha', 'one', 'handled'], ['beta', 'two', 'open']]);
    expect((await listInbox(ctx, { project: 'alpha', state: 'all' })).map((e) => e.text)).toEqual(['one']);
  });
});

// @req FR:agent-inbox/inbox.handle
describe('handle', () => {
  it('marks one entry handled and changes nothing else', async () => {
    const { storage, ctx } = await mk();
    const a = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'one', 'reply');
    const b = await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 6 }, 'two', 'decision');
    const before = (await storage.read('tasks/inbox/alpha.md')).content;
    expect(await handleEntry(ctx, b.id, 'token:x', 'Booked')).toEqual({ changed: true });
    const after = (await storage.read('tasks/inbox/alpha.md')).content;
    const es = parseInbox(after);
    expect(es[0]).toEqual(parseInbox(before)[0]);
    expect(es[1]).toMatchObject({ id: b.id, state: 'handled', note: 'Booked', handled: expect.stringMatching(/ by token:x$/) });
    expect(after.slice(0, after.indexOf(`## ${b.id}`))).toBe(before.slice(0, before.indexOf(`## ${b.id}`)));
    expect(await handleEntry(ctx, b.id, 'token:x')).toEqual({ changed: false });
    await expect(handleEntry(ctx, 'in-nope', 'token:x')).rejects.toThrow('Inbox entry not found');
    expect(a.id).toBeTruthy();
  });
});

// @req FR:agent-inbox/inbox.cap
describe('cap', () => {
  it('drops handled entries when full, then refuses', async () => {
    const { storage, ctx } = await mk();
    const big = 'x'.repeat(900);
    const head = '# Alpha inbox\n\n';
    const many = (state: 'open' | 'handled') => Array.from({ length: 300 }, (_, i) => formatEntry(entry({ id: `in-20261028T000000Z-${i.toString(16).padStart(4, '0')}`, state, text: big }))).join('\n');
    await storage.write('tasks/inbox/alpha.md', head + many('handled'));
    await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'fits', 'reply');
    const kept = parseInbox((await storage.read('tasks/inbox/alpha.md')).content);
    expect(kept.at(-1)!.text).toBe('fits');
    expect(kept.length).toBeLessThan(300);
    await storage.write('tasks/inbox/alpha.md', head + many('open'));
    await expect(sendToInbox(ctx, { path: 'tasks/alpha.md', line: 5 }, 'no room', 'reply')).rejects.toThrow('Inbox is full');
  });
});
