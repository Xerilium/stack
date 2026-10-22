import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDefaults } from '../../src/core/config';
import {
  addProject, addTask, applyTaskProps, completeTask, formatSuspendDate, kebabCase, LifecycleError, nextTask,
  parkTask, removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask, sweep, sweepStartDates,
  sweepSuspended,
} from '../../src/core/lifecycle';
import { ConflictError, FsStorage, MemoryStorage, Storage } from '../../src/core/storage';

const BOM = '﻿';
// Thu Oct 22 2026 10:00 PDT (Work block)
const NOW = new Date('2026-10-22T17:00:00Z');

async function mem(files: Record<string, string>): Promise<MemoryStorage> {
  const s = new MemoryStorage();
  for (const [p, c] of Object.entries(files)) await s.write(p, c);
  return s;
}
const ctx = (storage: Storage, now: Date = NOW) => ({ storage, config: getDefaults(), now: () => now });
const text = async (s: Storage, p: string) => (await s.read(p)).content;

const ALPHA = `${BOM}# Alpha

- **Project value:** 💰💰

## 🔄 Active

- [ ] Write spec 🟢
  - [ ] Draft outline 🟢
  - [ ] Review 🟡
- [ ] 🔺 Pay bills 🟡 ⬆️
- [x] Old thing 🟢

## ⏭️ Up next

- [ ] Later
`;

describe('document handling', () => {
  // @req FR:task-lifecycle/doc.target @req FR:task-lifecycle/doc.result
  it('acts on an explicit ref and returns before/after', async () => {
    const s = await mem({ 'tasks/alpha.md': ALPHA });
    const r = await startTask(ctx(s), { path: 'tasks/alpha.md', line: 9 });
    expect(r).toMatchObject({ changed: true, before: '- [ ] 🔺 Pay bills 🟡 ⬆️', after: '- [ ] 🔺 🚧 Pay bills 🟡 ⬆️' });
    expect(r.ref).toEqual({ path: 'tasks/alpha.md', line: 9 });
  });

  // @req FR:task-lifecycle/doc.target
  it('rejects refs that are not task lines', async () => {
    const s = await mem({ 'tasks/alpha.md': ALPHA });
    await expect(startTask(ctx(s), { path: 'tasks/alpha.md', line: 0 })).rejects.toThrow(LifecycleError);
    await expect(startTask(ctx(s), { path: 'tasks/alpha.md', line: 999 })).rejects.toThrow(LifecycleError);
    await expect(startTask(ctx(s), { path: 'tasks/nope.md', line: 1 })).rejects.toThrow();
  });

  // @req FR:task-lifecycle/doc.lossless
  it('changes only the edited line (BOM, trailing whitespace, odd lines survive)', async () => {
    const src = `${BOM}# A  \n\nweird line   \n## 🔄 Active\n- [ ] one \t\n- [ ] two\n\n\ttab line\n`;
    const s = await mem({ 'tasks/a.md': src });
    await startTask(ctx(s), { path: 'tasks/a.md', line: 5 });
    const out = await text(s, 'tasks/a.md');
    const a = src.split('\n');
    const b = out.split('\n');
    expect(b).toHaveLength(a.length);
    b.forEach((l, i) => { if (i !== 5) expect(l).toBe(a[i]); });
    expect(b[5]).toBe('- [ ] 🚧 two');
  });

  // @req FR:task-lifecycle/doc.crlf
  it('keeps CRLF on edited lines and uses it for inserted lines', async () => {
    const src = '# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] one\r\n- [ ] two\r\n';
    const s = await mem({ 'tasks/a.md': src });
    await startTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(await text(s, 'tasks/a.md')).toBe('# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] 🚧 one\r\n- [ ] two\r\n');
    await addTask(ctx(s), { project: 'a', text: 'three' });
    expect(await text(s, 'tasks/a.md')).toBe('# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] 🚧 one\r\n- [ ] two\r\n- [ ] three\r\n');
  });

  // @req FR:task-lifecycle/doc.version
  it('surfaces concurrent changes as ConflictError', async () => {
    const inner = await mem({ 'tasks/a.md': ALPHA });
    const racing: Storage = {
      list: () => inner.list(),
      async read(p) {
        const f = await inner.read(p);
        await inner.write(p, f.content + '- [ ] sneaky\n'); // someone else edits after our read
        return f;
      },
      write: (p, c, o) => inner.write(p, c, o),
    };
    await expect(startTask(ctx(racing), { path: 'tasks/a.md', line: 9 })).rejects.toThrow(ConflictError);
    expect(await text(inner, 'tasks/a.md')).toBe(ALPHA + '- [ ] sneaky\n');
  });

  // @req FR:task-lifecycle/doc.noop
  it('does not write when nothing changes', async () => {
    const inner = await mem({ 'tasks/a.md': ALPHA });
    const write = jest.fn(inner.write.bind(inner));
    const s: Storage = { list: () => inner.list(), read: (p) => inner.read(p), write };
    const r = await skipTask(ctx(s), { path: 'tasks/a.md', line: 9 });
    expect(r.changed).toBe(true);
    write.mockClear();
    const r2 = await skipTask(ctx(s), { path: 'tasks/a.md', line: 9 });
    expect(r2.changed).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  // @req FR:task-lifecycle/doc.load
  it('works through FsStorage', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lifecycle-'));
    try {
      await fs.mkdir(join(dir, 'tasks'));
      await fs.writeFile(join(dir, 'tasks', 'alpha.md'), ALPHA);
      const s = new FsStorage(dir);
      await completeTask(ctx(s), { path: 'tasks/alpha.md', line: 9 });
      expect(await fs.readFile(join(dir, 'tasks', 'alpha.md'), 'utf8')).toContain('- [x] 🔺 Pay bills 🟡 ⬆️');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // @req FR:task-lifecycle/doc.result
  it('reports changed:false instead of throwing when there is nothing to act on', async () => {
    const s = await mem({ 'tasks/e.md': '# E\n\n## 🔄 Active\n\n' });
    for (const op of [startTask, completeTask, skipTask, resumeTask, suspendTask] as const) {
      const r = await (op as (c: ReturnType<typeof ctx>) => Promise<{ changed: boolean; message?: string }>)(ctx(s));
      expect(r.changed).toBe(false);
      expect(r.message).toBeTruthy();
    }
  });
});

describe('nextTask', () => {
  const BETA = `# Beta

## 🔄 Active

- [ ] Urgent thing 🚨 🟢 💰💰💰
- [ ] Parked thing 🅿️ 🚨 🟢
`;
  // @req FR:task-lifecycle/next.@function @req FR:task-lifecycle/next.rank @req FR:task-lifecycle/next.map
  it('returns the top-scoring leaf with a ref to its exact line', async () => {
    const s = await mem({ 'tasks/alpha.md': ALPHA, 'tasks/beta.md': BETA });
    const n = await nextTask(ctx(s));
    expect(n).not.toBeNull();
    expect(n!.text).toContain('Urgent thing');
    expect(n!.project).toBe('Beta');
    expect(n!.ref).toEqual({ path: 'tasks/beta.md', line: 4 });
    expect(n!.score).toBeGreaterThan(0);
    const lines = (await text(s, n!.ref.path)).split('\n');
    expect(lines[n!.ref.line]).toContain('Urgent thing');
  });

  // @req FR:task-lifecycle/next.map
  it('maps nested rows and skips checked rows', async () => {
    const s = await mem({ 'tasks/alpha.md': ALPHA });
    const n = await nextTask(ctx(s));
    const lines = (await text(s, 'tasks/alpha.md')).split('\n');
    expect(lines[n!.ref.line]).toContain(n!.text);
    expect(n!.text).not.toContain('Old thing');
  });

  // @req FR:task-lifecycle/next.none
  it('returns null when nothing qualifies', async () => {
    expect(await nextTask(ctx(await mem({})))).toBeNull();
    const s = await mem({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] 🅿️ parked\n- [x] done\n' });
    expect(await nextTask(ctx(s))).toBeNull();
  });

  // @req FR:task-lifecycle/next.rank
  it('uses the engine time filter at the given instant', async () => {
    const s = await mem({
      'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] Home thing 🏠 🔺 🟢\n- [ ] Work thing ☀️ 🟢\n',
    });
    const work = await nextTask(ctx(s), new Date('2026-10-22T17:00:00Z')); // Thu 10:00 PDT
    const evening = await nextTask(ctx(s), new Date('2026-10-22T23:30:00Z')); // Thu 16:30 PDT
    expect(work!.text).toContain('Work thing');
    expect(evening!.text).toContain('Home thing');
  });

  // @req FR:task-lifecycle/doc.target
  it('lets operations default to the next task', async () => {
    const s = await mem({ 'tasks/alpha.md': ALPHA, 'tasks/beta.md': BETA });
    const r = await startTask(ctx(s));
    expect(r.ref).toEqual({ path: 'tasks/beta.md', line: 4 });
    expect(await text(s, 'tasks/beta.md')).toContain('- [ ] 🚧 Urgent thing 🚨');
  });
});

describe('startTask', () => {
  // @req FR:task-lifecycle/start.status
  it('adds 🚧 after a leading priority, drops other status and 💤', () => {
    expect(applyTaskProps('- [ ] 🚨 Do it 🟢', { status: '🚧' })).toBe('- [ ] 🚨 🚧 Do it 🟢');
    expect(applyTaskProps('- [ ] Do it', { status: '🚧' })).toBe('- [ ] 🚧 Do it');
    expect(applyTaskProps('- [ ] ⏳ Do   it', { status: '🚧' })).toBe('- [ ] 🚧 Do it');
    expect(applyTaskProps('- [ ] 💤 Oct 23: Do it', { status: '🚧' })).toBe('- [ ] 🚧 Do it');
    expect(applyTaskProps('  - [ ] Nested', { status: '🚧' })).toBe('  - [ ] 🚧 Nested');
  });

  // @req FR:task-lifecycle/start.already
  it('leaves started tasks alone', async () => {
    const s = await mem({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] 🚧 going\n' });
    const r = await startTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r.changed).toBe(false);
    expect(await text(s, 'tasks/a.md')).toBe('# A\n\n## 🔄 Active\n\n- [ ] 🚧 going\n');
  });
});

describe('startTask checked rows', () => {
  // @req FR:task-lifecycle/start.already
  it('is a no-op on checked rows', async () => {
    const src = '# A\n\n## 🔄 Active\n\n- [x] done\n';
    const s = await mem({ 'tasks/a.md': src });
    const r = await startTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r.changed).toBe(false);
    expect(await text(s, 'tasks/a.md')).toBe(src);
  });
});

describe('editLine BOM', () => {
  // @req FR:task-lifecycle/doc.lossless
  it('keeps the BOM when the edited task is on line 0', async () => {
    const s = await mem({ 'tasks/a.md': `${BOM}- [ ] first\n- [ ] second\n` });
    const r = await startTask(ctx(s), { path: 'tasks/a.md', line: 0 });
    expect(r.changed).toBe(true);
    expect(await text(s, 'tasks/a.md')).toBe(`${BOM}- [ ] 🚧 first\n- [ ] second\n`);
  });
});

describe('completeTask', () => {
  const doc = (body: string) => `# A\n\n## 🔄 Active\n\n${body}`;

  // @req FR:task-lifecycle/complete.check
  it('checks the box, strips status and suspend markers, collapses whitespace', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 🚧 Ship   it 🟢\n- [ ] other\n') });
    const r = await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r.after).toBe('- [x] Ship it 🟢');
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [x] Ship it 🟢\n- [ ] other\n'));
  });

  // @req FR:task-lifecycle/complete.already
  it('ignores checked tasks', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [x] done\n') });
    expect((await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 })).changed).toBe(false);
  });

  // @req FR:task-lifecycle/complete.summary
  it('replaces a prompt note with the completion summary', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] Task\n  > Prompt: do the thing\n  > more\n- [ ] next\n') });
    await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 }, { summary: 'Did it' });
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [x] Task\n  > ✅ **COMPLETED**: Did it\n  > more\n- [ ] next\n'));
  });

  // @req FR:task-lifecycle/complete.summary
  it('inserts a summary line when there is no prompt, and stops at the next task', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] Task\n- [ ] next\n  > Prompt: not mine\n  - [ ] sub\n') });
    await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 }, { summary: 'Done' });
    expect(await text(s, 'tasks/a.md')).toBe(
      doc('- [x] Task\n  > ✅ **COMPLETED**: Done\n- [ ] next\n  > Prompt: not mine\n  - [ ] sub\n'));
    await completeTask(ctx(s), { path: 'tasks/a.md', line: 8 }, { summary: 'Nested' });
    expect(await text(s, 'tasks/a.md')).toContain('  - [x] sub\n    > ✅ **COMPLETED**: Nested\n');
  });

  // @req FR:task-lifecycle/complete.remove
  it('removes the task block with remove:true', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] Task\n  - [ ] sub\n\n  note\n- [ ] keep\n') });
    const r = await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 }, { remove: true });
    expect(r.changed).toBe(true);
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [ ] keep\n'));
  });

  // @req FR:task-lifecycle/complete.recurring
  it('rolls a recurring row in place and resets subtasks', async () => {
    const s = await mem({
      'tasks/a.md': doc('- [ ] 📅 Oct 22, 2026: 🔄 Monthly: Pay bills 🟡\n  - [x] Mortgage\n  - [ ] Card\n- [ ] other\n'),
    });
    const r = await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r).toMatchObject({ changed: true, rolled: true });
    expect(await text(s, 'tasks/a.md')).toBe(
      doc('- [ ] 📅 Nov 23, 2026: 🔄 Monthly: Pay bills 🟡 <!--nominal:2026-11-22-->\n  - [ ] Mortgage\n  - [ ] Card\n- [ ] other\n'));
  });

  // @req FR:task-lifecycle/complete.recurring
  it('remove:true rolls a recurring row instead of deleting it', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 📅 Oct 22, 2026: 🔄 Monthly: Pay bills\n  - [x] a\n- [ ] other\n') });
    const r = await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 }, { remove: true });
    expect(r).toMatchObject({ changed: true, rolled: true });
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [ ] 📅 Nov 23, 2026: 🔄 Monthly: Pay bills <!--nominal:2026-11-22-->\n  - [ ] a\n- [ ] other\n'));
  });

  // @req FR:task-lifecycle/complete.recurring
  it('remove:true deletes a recurring row whose roll is null', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 📅 Feb 31, 2026: 🔄 Monthly: Bad\n- [ ] keep\n') });
    await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 }, { remove: true });
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [ ] keep\n'));
  });

  // @req FR:task-lifecycle/complete.recurring
  it('rolls CRLF rows and strips 🚧 from the rolled row', async () => {
    const src = '# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] 📅 Oct 22, 2026: 🔄 Weekly: 🚧 Review\r\n  - [x] a\r\n';
    const s = await mem({ 'tasks/a.md': src });
    await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(await text(s, 'tasks/a.md')).toBe(
      '# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] 📅 Oct 29, 2026: 🔄 Weekly: Review\r\n  - [ ] a\r\n');
  });

  // @req FR:task-lifecycle/complete.recurring
  it('completes normally when the roll returns null (invalid date)', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 📅 Feb 31, 2026: 🔄 Monthly: Bad\n') });
    const r = await completeTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r.rolled).toBeFalsy();
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [x] 📅 Feb 31, 2026: 🔄 Monthly: Bad\n'));
  });
});

describe('skipTask / resumeTask', () => {
  const doc = (body: string) => `# A\n\n## 🔄 Active\n\n${body}`;

  // @req FR:task-lifecycle/skip.park
  it('prefixes 🅿️ without touching whitespace', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] Do   it  🟢\n') });
    const r = await skipTask(ctx(s), { path: 'tasks/a.md', line: 4 });
    expect(r.after).toBe('- [ ] 🅿️ Do   it  🟢');
  });

  // @req FR:task-lifecycle/skip.park
  it('does not park checked rows', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [x] done\n') });
    await expect(skipTask(ctx(s), { path: 'tasks/a.md', line: 4 })).rejects.toThrow(LifecycleError);
  });

  // @req FR:task-lifecycle/skip.already @req FR:task-lifecycle/skip.alias
  it('is idempotent and has a parkTask alias', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 🅿️ parked\n') });
    expect((await parkTask(ctx(s), { path: 'tasks/a.md', line: 4 })).changed).toBe(false);
    expect(parkTask).toBe(skipTask);
  });

  // @req FR:task-lifecycle/resume.first @req FR:task-lifecycle/resume.remove
  it('resumes the first parked task in file order', async () => {
    const s = await mem({
      'tasks/a.md': doc('- [ ] free\n- [ ] 🅿️ first parked\n'),
      'tasks/b.md': doc('- [ ] 🅿️ second parked\n'),
    });
    const r = await resumeTask(ctx(s));
    expect(r.ref).toEqual({ path: 'tasks/a.md', line: 5 });
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [ ] free\n- [ ] first parked\n'));
    expect(await text(s, 'tasks/b.md')).toBe(doc('- [ ] 🅿️ second parked\n'));
    const r2 = await resumeTask(ctx(s));
    expect(r2.ref!.path).toBe('tasks/b.md');
  });

  // @req FR:task-lifecycle/resume.remove
  it('removes only the leading 🅿️ and following whitespace; mid-text 🅿️ warns', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 🅿️   spaced   out\n- [ ] odd 🅿️ place\n') });
    expect((await resumeTask(ctx(s), { path: 'tasks/a.md', line: 4 })).after).toBe('- [ ] spaced   out');
    const r = await resumeTask(ctx(s), { path: 'tasks/a.md', line: 5 });
    expect(r.changed).toBe(false);
    expect(r.message).toMatch(/not at the start/);
  });

  // @req FR:task-lifecycle/resume.none
  it('reports nothing to resume', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] free\n') });
    expect((await resumeTask(ctx(s))).changed).toBe(false);
  });
});

describe('suspendTask', () => {
  const doc = (body: string) => `# A\n\n## 🔄 Active\n\n${body}`;
  const at = { path: 'tasks/a.md', line: 4 };

  // @req FR:task-lifecycle/suspend.marker @req FR:task-lifecycle/suspend.days
  it('defaults to one day and writes a date-only marker', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] Task   here 🟢\n') });
    const r = await suspendTask(ctx(s), at);
    expect(r.after).toBe('- [ ] 💤 Oct 23: Task   here 🟢');
    const r3 = await suspendTask(ctx(await mem({ 'tasks/a.md': doc('- [ ] T\n') })), at, { days: 3 });
    expect(r3.after).toBe('- [ ] 💤 Oct 25: T');
  });

  // @req FR:task-lifecycle/suspend.hours @req FR:task-lifecycle/suspend.clock
  it('formats hours as HH:mm today or MMM d HH:mm later (wall clock in config timezone)', async () => {
    const mk = () => mem({ 'tasks/a.md': doc('- [ ] T\n') });
    expect((await suspendTask(ctx(await mk()), at, { hours: 2 })).after).toBe('- [ ] 💤 12:00: T');
    expect((await suspendTask(ctx(await mk()), at, { hours: 20 })).after).toBe('- [ ] 💤 Oct 23 06:00: T');
    expect((await suspendTask(ctx(await mk()), at, { hours: 48 })).after).toBe('- [ ] 💤 Oct 24: T');
    expect((await suspendTask(ctx(await mk()), at, { hours: 30 })).after).toBe('- [ ] 💤 Oct 23 16:00: T');
  });

  // @req FR:task-lifecycle/suspend.clock
  it('formats dates across a month boundary and DST', () => {
    expect(formatSuspendDate(new Date('2026-10-31T17:00:00Z'), 'America/Los_Angeles', { days: 1 })).toBe('Nov 1');
    expect(formatSuspendDate(new Date('2026-11-01T07:30:00Z'), 'America/Los_Angeles', { hours: 1 })).toBe('01:30');
  });

  // @req FR:task-lifecycle/suspend.marker
  it('replaces an earlier marker', () => {
    expect(applyTaskProps('- [ ] 💤 Oct 23: T', { suspend: 'Oct 25' })).toBe('- [ ] 💤 Oct 25: T');
    expect(applyTaskProps('- [ ] 💤 Oct 23: T', { suspend: '' })).toBe('- [ ] T');
  });

  // @req FR:task-lifecycle/suspend.already
  it('ignores suspended and checked rows', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 💤 Oct 30: T\n- [x] D\n') });
    expect((await suspendTask(ctx(s), at)).changed).toBe(false);
    expect((await suspendTask(ctx(s), { path: 'tasks/a.md', line: 5 })).changed).toBe(false);
  });

  // @req FR:task-lifecycle/suspend.validate
  it('validates inputs', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] T\n') });
    await expect(suspendTask(ctx(s), at, { days: 1, hours: 1 })).rejects.toThrow(LifecycleError);
    await expect(suspendTask(ctx(s), at, { days: 0 })).rejects.toThrow(LifecycleError);
    await expect(suspendTask(ctx(s), at, { days: 366 })).rejects.toThrow(LifecycleError);
    await expect(suspendTask(ctx(s), at, { hours: 8761 })).rejects.toThrow(LifecycleError);
    await expect(suspendTask(ctx(s), at, { hours: 1.5 })).rejects.toThrow(LifecycleError);
  });
});

describe('setProperties', () => {
  // @req FR:task-lifecycle/set.props @req FR:task-lifecycle/set.placement
  it('places each category per legacy rules and replaces same-category emojis', () => {
    expect(applyTaskProps('- [ ] Task 🟡 ⬆️', { priority: '🚨' })).toBe('- [ ] 🚨 Task 🟡 ⬆️');
    expect(applyTaskProps('- [ ] 🔻 Task', { priority: '‼️' })).toBe('- [ ] ‼️ Task');
    expect(applyTaskProps('- [ ] Task ⬆️', { effort: '🔴' })).toBe('- [ ] Task 🔴 ⬆️');
    expect(applyTaskProps('- [ ] Task', { effort: '🔴' })).toBe('- [ ] Task 🔴');
    expect(applyTaskProps('- [ ] Task 🟢', { effort: '🔴' })).toBe('- [ ] Task 🔴');
    expect(applyTaskProps('- [ ] Task', { impact: '⬇️' })).toBe('- [ ] Task ⬇️');
    expect(applyTaskProps('- [ ] Task ⬆️ 🟢', { impact: 'None', effort: 'None' })).toBe('- [ ] Task');
    expect(applyTaskProps('- [ ] 🚨 Task', { status: '👀' })).toBe('- [ ] 🚨 👀 Task');
  });

  // @req FR:task-lifecycle/set.props
  it('handles checkbox, removeAllEmojis, and suspend', () => {
    expect(applyTaskProps('- [x] Task', { checkbox: 'Incomplete' })).toBe('- [ ] Task');
    expect(applyTaskProps('- [ ] Task', { checkbox: 'Complete' })).toBe('- [x] Task');
    expect(applyTaskProps('- [ ] 🚨 💤 Oct 23: Task 🟢 ⬆️ 🅿️', { removeAllEmojis: true })).toBe('- [ ] Task');
    expect(applyTaskProps('- [ ] Task', { suspend: '13:00' })).toBe('- [ ] 💤 13:00: Task');
  });

  // @req FR:task-lifecycle/set.invalid
  it('rejects emojis from the wrong category', async () => {
    expect(() => applyTaskProps('- [ ] T', { priority: '🟢' as never })).toThrow(LifecycleError);
    expect(() => applyTaskProps('- [ ] T', { status: 'x' as never })).toThrow(LifecycleError);
    expect(() => applyTaskProps('not a task', { status: '🚧' })).toThrow(LifecycleError);
  });

  // @req FR:task-lifecycle/set.props
  it('writes through storage', async () => {
    const s = await mem({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] Task\n' });
    const r = await setProperties(ctx(s), { path: 'tasks/a.md', line: 4 }, { priority: '🔺', effort: '🟢' });
    expect(r.after).toBe('- [ ] 🔺 Task 🟢');
  });
});

describe('removeCompleted', () => {
  const A = '# A\n\n## 🔄 Active\n\n- [x] done\n  - [ ] nested stays with it\n\n- [ ] keep\n  - [x] sub done\n  - [ ] sub keep\n## ⏭️ Up next\n\n- [x] done two\n- [X] upper stays\n';
  // @req FR:task-lifecycle/remove.blocks @req FR:task-lifecycle/remove.count
  it('removes [x] rows with their blocks across files', async () => {
    const s = await mem({ 'tasks/a.md': A, 'tasks/b.md': '# B\n\n## 🔄 Active\n\n- [ ] untouched\n' });
    const r = await removeCompleted(ctx(s));
    expect(r.removed).toBe(3);
    expect(r.files).toEqual(['tasks/a.md']);
    expect(await text(s, 'tasks/a.md')).toBe(
      '# A\n\n## 🔄 Active\n\n- [ ] keep\n  - [ ] sub keep\n## ⏭️ Up next\n\n- [X] upper stays\n');
  });

  // @req FR:task-lifecycle/remove.blocks
  it('limits to one project by file base name', async () => {
    const s = await mem({ 'tasks/a.md': A, 'tasks/b.md': '# B\n\n## 🔄 Active\n\n- [x] gone\n' });
    const r = await removeCompleted(ctx(s), { project: 'b' });
    expect(r).toMatchObject({ removed: 1, files: ['tasks/b.md'] });
    expect(await text(s, 'tasks/a.md')).toBe(A);
  });

  // @req FR:task-lifecycle/remove.missing
  it('rejects unknown projects', async () => {
    await expect(removeCompleted(ctx(await mem({})), { project: 'zz' })).rejects.toThrow(LifecycleError);
  });

  // @req FR:task-lifecycle/remove.count
  it('writes nothing when no task is complete', async () => {
    const s = await mem({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] x\n' });
    expect(await removeCompleted(ctx(s))).toEqual({ removed: 0, files: [] });
  });
});

describe('addProject', () => {
  // @req FR:task-lifecycle/project.file
  it('creates the legacy template', async () => {
    const s = await mem({});
    const r = await addProject(ctx(s), {
      name: 'My Cool Project', description: 'About it.', repositoryUrl: 'https://github.com/acme/cool',
      aliases: ['cool', 'mcp'], priority: 2, capacity: { Work: 10, Project: 4 },
    });
    expect(r.path).toBe('tasks/my-cool-project.md');
    expect(await text(s, r.path)).toBe(`${BOM}# My Cool Project

About it.

- **Repository:** [acme/cool](https://github.com/acme/cool)
- **Aliases:** cool, mcp
- **Project priority:** 2
- **Work capacity:** 10h
- **Project capacity:** 4h

## 🔄 Active

Current work that needs to be done.

- [ ] 

## ⏭️ Up next

Tasks to pick up when active work is completed.

- [ ] 

## 📋 Backlog

Future work and ideas.

- [ ] 

`);
  });

  // @req FR:task-lifecycle/project.capacity
  it('skips unknown time blocks and maps weeklyCapacity to Work', async () => {
    const s = await mem({});
    const r = await addProject(ctx(s), { name: 'P', capacity: { Nope: 3 }, weeklyCapacity: 5 });
    expect(await text(s, r.path)).not.toContain('Nope');
    const r2 = await addProject(ctx(s), { name: 'Q', weeklyCapacity: 5 });
    expect(await text(s, r2.path)).toContain('- **Work capacity:** 5h\n');
    const r3 = await addProject(ctx(s), { name: 'R', weeklyCapacity: 5, capacity: { Project: 1 } });
    const c = await text(s, r3.path);
    expect(c).toContain('- **Project capacity:** 1h\n');
    expect(c).not.toContain('Work capacity');
  });

  // @req FR:task-lifecycle/project.exists
  it('refuses to overwrite unless forced', async () => {
    const s = await mem({ 'tasks/p.md': 'old' });
    await expect(addProject(ctx(s), { name: 'P' })).rejects.toThrow(ConflictError);
    await addProject(ctx(s), { name: 'P', force: true });
    expect(await text(s, 'tasks/p.md')).toContain('# P');
  });

  // @req FR:task-lifecycle/project.name
  it('derives kebab-case file names and rejects empty ones', async () => {
    expect(kebabCase('  My  Cool_Project!! v2 ')).toBe('my-cool_project-v2');
    expect(kebabCase('A - B')).toBe('a-b');
    expect(() => kebabCase('!!!')).toThrow(LifecycleError);
    await expect(addProject(ctx(await mem({})), { name: '???' })).rejects.toThrow(LifecycleError);
    const r = await addProject(ctx(await mem({})), { name: 'Named', fileName: 'custom' });
    expect(r.path).toBe('tasks/custom.md');
  });
});

describe('addTask', () => {
  const P = '# P\n\n## 🔄 Active\n\n- [ ] one\n  - [ ] sub\n    note\n\n## ⏭️ Up next\n\n- [ ] later\n';
  // @req FR:task-lifecycle/add.insert
  it('appends after the last task block in the Active section', async () => {
    const s = await mem({ 'tasks/p.md': P });
    const r = await addTask(ctx(s), { project: 'p', text: 'two 🟢' });
    expect(r.ref).toEqual({ path: 'tasks/p.md', line: 7 });
    expect(await text(s, 'tasks/p.md')).toBe(
      '# P\n\n## 🔄 Active\n\n- [ ] one\n  - [ ] sub\n    note\n- [ ] two 🟢\n\n## ⏭️ Up next\n\n- [ ] later\n');
  });

  // @req FR:task-lifecycle/add.insert
  it('targets another section by heading text, case-insensitively', async () => {
    const s = await mem({ 'tasks/p.md': P });
    await addTask(ctx(s), { project: 'P', text: 'x', section: 'up next' });
    expect(await text(s, 'tasks/p.md')).toMatch(/- \[ \] later\n- \[ \] x\n$/);
  });

  // @req FR:task-lifecycle/add.placeholder
  it('fills the empty placeholder row of a new project', async () => {
    const s = await mem({});
    const { path } = await addProject(ctx(s), { name: 'New' });
    const r = await addTask(ctx(s), { project: 'new', text: 'First' });
    const lines = (await text(s, path)).split('\n');
    expect(lines[r.ref!.line]).toBe('- [ ] First');
    expect(lines.filter((l) => l === '- [ ] ')).toHaveLength(2); // Up next and Backlog placeholders remain
  });

  // @req FR:task-lifecycle/add.parent
  it('adds a subtask under a parent', async () => {
    const s = await mem({ 'tasks/p.md': P });
    const r = await addTask(ctx(s), { project: 'p', text: 'sub two', parent: { path: 'tasks/p.md', line: 4 } });
    expect(r.ref!.line).toBe(7);
    expect(await text(s, 'tasks/p.md')).toContain('  - [ ] sub\n    note\n  - [ ] sub two\n');
    const r2 = await addTask(ctx(s), { project: 'p', text: 'deep', parent: { path: 'tasks/p.md', line: 5 } });
    expect((await text(s, 'tasks/p.md')).split('\n')[r2.ref!.line]).toBe('    - [ ] deep');
  });

  // @req FR:task-lifecycle/add.invalid
  it('validates input', async () => {
    const s = await mem({ 'tasks/p.md': P });
    await expect(addTask(ctx(s), { project: 'p', text: '  ' })).rejects.toThrow(LifecycleError);
    await expect(addTask(ctx(s), { project: 'zz', text: 'x' })).rejects.toThrow(LifecycleError);
    await expect(addTask(ctx(s), { project: 'p', text: 'x', section: 'Nope' })).rejects.toThrow(LifecycleError);
    await expect(addTask(ctx(s), { project: 'p', text: 'x', parent: { path: 'tasks/p.md', line: 0 } })).rejects.toThrow(LifecycleError);
    await expect(addTask(ctx(s), { project: 'p', text: 'a\nb' })).rejects.toThrow(LifecycleError);
  });
});

describe('sweeps', () => {
  const doc = (body: string) => `${BOM}# A\n\n## 🔄 Active\n\n${body}`;
  // @req FR:task-lifecycle/sweep.start
  it('removes ⏰ markers that are due, keeps future and bad ones', async () => {
    const s = await mem({
      'tasks/a.md': doc(
        '- [ ] ⏰ Oct 22: today\n- [ ] 🟢 ⏰ Oct 1: past 🟢\n- [ ] ⏰ Oct 23: tomorrow\n- [ ] ⏰ Feb 30: bad\n' +
        '- [ ] ⏰ Dec 31: future\n  - [ ] ⏰ Jan 2: nested past\n'),
    });
    const r = await sweepStartDates(ctx(s));
    expect(r.activated).toBe(3);
    expect(await text(s, 'tasks/a.md')).toBe(
      doc('- [ ] today\n- [ ] 🟢 past 🟢\n- [ ] ⏰ Oct 23: tomorrow\n- [ ] ⏰ Feb 30: bad\n' +
        '- [ ] ⏰ Dec 31: future\n  - [ ] nested past\n'));
  });

  // @req FR:task-lifecycle/sweep.start
  it('treats dates more than six months ahead as last year', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] ⏰ Dec 20: wraps\n- [ ] ⏰ Jun 1: soon\n- [ ] ⏰ Jul 6: wraps too\n') });
    const r = await sweepStartDates(ctx(s, new Date('2027-01-05T17:00:00Z')));
    expect(r.activated).toBe(2);
    expect(await text(s, 'tasks/a.md')).toBe(doc('- [ ] wraps\n- [ ] ⏰ Jun 1: soon\n- [ ] wraps too\n'));
  });

  // @req FR:task-lifecycle/sweep.suspend
  it('reactivates suspended rows whose time has passed', async () => {
    const s = await mem({
      'tasks/a.md': doc(
        '- [ ] 💤 Oct 22: date-only today\n- [ ] 💤 Oct 21: yesterday\n- [ ] 💤 Oct 22 09:59: earlier\n- [ ] 💤 Oct 22 10:01: later\n' +
        '- [ ] 💤 09:00: time only\n- [ ] 💤 11:00: time later\n- [ ] 🟢 💤 Oct 23: tomorrow\n- [x] 💤 Oct 1: checked\n- [ ] 💤 Foo 5: bad\n'),
    });
    const r = await sweepSuspended(ctx(s)); // 10:00 PDT, startOfDay 08:00
    expect(r.reactivated).toBe(4);
    expect(await text(s, 'tasks/a.md')).toBe(
      doc('- [ ] date-only today\n- [ ] yesterday\n- [ ] earlier\n- [ ] 💤 Oct 22 10:01: later\n' +
        '- [ ] time only\n- [ ] 💤 11:00: time later\n- [ ] 🟢 💤 Oct 23: tomorrow\n- [x] 💤 Oct 1: checked\n- [ ] 💤 Foo 5: bad\n'));
  });

  // @req FR:task-lifecycle/sweep.suspend
  it('respects config.startOfDay for date-only markers', async () => {
    const s = await mem({ 'tasks/a.md': doc('- [ ] 💤 Oct 22: t\n') });
    const early = new Date('2026-10-22T14:00:00Z'); // 07:00 PDT, before 08:00 startOfDay
    expect((await sweepSuspended(ctx(s, early))).reactivated).toBe(0);
    expect((await sweepSuspended(ctx(s, NOW))).reactivated).toBe(1);
  });

  // @req FR:task-lifecycle/sweep.all
  it('runs both sweeps and writes each changed file once', async () => {
    const inner = await mem({
      'tasks/a.md': doc('- [ ] ⏰ Oct 1: a\n- [ ] 💤 Oct 1: b\n'),
      'tasks/b.md': doc('- [ ] clean\n'),
    });
    const write = jest.fn(inner.write.bind(inner));
    const s: Storage = { list: () => inner.list(), read: (p) => inner.read(p), write };
    const r = await sweep(ctx(s));
    expect(r).toMatchObject({ activated: 1, reactivated: 1, files: ['tasks/a.md'] });
    expect(write).toHaveBeenCalledTimes(1);
    expect(await text(inner, 'tasks/a.md')).toBe(doc('- [ ] a\n- [ ] b\n'));
  });

  // @req FR:task-lifecycle/doc.lossless
  it('keeps CRLF files intact', async () => {
    const s = await mem({ 'tasks/a.md': '# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] ⏰ Oct 1: x\r\n- [ ] y\r\n' });
    await sweepStartDates(ctx(s));
    expect(await text(s, 'tasks/a.md')).toBe('# A\r\n\r\n## 🔄 Active\r\n\r\n- [ ] x\r\n- [ ] y\r\n');
  });
});
