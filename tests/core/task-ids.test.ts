import { parseProject, serializeProject, type Task } from '../../src/core/parser';
import { MemoryStorage } from '../../src/core/storage';
import { assignIds, EMOJI_KEYS, formatTaskId, lintIds, moveProject, parseTaskId, slugOf, TASK_ID_PREFIX, taskIndex } from '../../src/core/task-ids';
import { run } from '../../src/cli/run';
import { cleanFormatter, emojiFormatter } from '../../src/core/formatter';
import { lintProject } from '../../src/core/task-lint';

// @req FR:task-ids/meta.fields @req FR:task-ids/meta.retired
describe('metadata keys', () => {
  it('accepts typed links and blocked, and flags underscores and retired keys', () => {
    const src = ['# G', '', '## A', '', '- [ ] One', '  > id: one', '  > owner: me', '  > blocked: T:g.two', '  > pr: https://github.com/o/r/pull/1', '  > issue: https://github.com/o/r/issues/2',
      '  > mail: m-1', '  > session: s-1', '  > doc: https://x.y/d', '  > link: https://x.y', '  > blocked_by: T:g.two', '  > next: call', '  > req: FR:x', '  > due: 2026-12-01', '- [ ] Two', '  > id: two', ''].join('\n');
    expect(lintIds([{ path: 'tasks/g.md', content: src }]).map((i) => `${i.line} ${i.rule}`)).toEqual(['15 meta-key', '16 meta-key', '17 meta-key', '18 meta-emoji']);
  });
});

// @req FR:task-ids/lint.status-note
describe('status notes', () => {
  it('flags status prose in nested lines of open tasks only', () => {
    const src = ['# G', '', '## A', '', '- [ ] One', '  > id: done-one', '  - Merged the API as of Nov 3', '  > owner: me', '  - 3/5 steps', '  - Use the 50% rule? no: plain text ok', '  - Plan the release', '  - Done when: all threads answered', '  > created: 2026-10-01',
      '- [x] Closed', '  - shipped Nov 3', ''].join('\n');
    expect(lintProject('tasks/g.md', src).filter((i) => i.rule === 'note-status').map((i) => i.line)).toEqual([7, 9, 10]);
  });
});
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const FILE = [
  '# Goal', '',
  '## 🔄 Active', '',
  '- [ ] 🚧 Ship v2 🔴',
  '  > id: ship-v2',
  '  > owner: stack-architect',
  '  > color: blue',
  '  > Context: not metadata because the key is not lower case',
  '  - [ ] 🙋 Approve the plan',
  '- [ ] Write docs',
  '',
].join('\n');

const first = (src: string): Task => parseProject(src).sections[0].tasks[0];

// @req FR:task-ids/meta.parse @req FR:task-ids/meta.model @req FR:task-ids/meta.roundtrip
describe('blockquote metadata', () => {
  it('reads consecutive > key: value lines under a row, keeps unknown keys, and leaves notes alone', () => {
    const t = first(FILE);
    expect(t.meta).toEqual([['id', 'ship-v2'], ['owner', 'stack-architect'], ['color', 'blue']]);
    expect(t.notes).toEqual(['> owner: stack-architect', '> color: blue', '> Context: not metadata because the key is not lower case']);
    expect(t.children[0].meta).toEqual([]);
    expect(serializeProject(parseProject(FILE))).toBe(FILE);
  });

  it('stops at the first other line and needs an indent', () => {
    const src = '# G\n\n## A\n\n- [ ] One\n  note\n  > id: late\n> id: top\n';
    expect(first(src).meta).toEqual([]);
  });

  it('survives the emoji and clean formatters', () => {
    const src = '# G\n\n## A\n\n- [ ] One\n  > id: one\n  > owner: me\n  note\n';
    const tree = emojiFormatter.parse(src);
    expect(emojiFormatter.serialize(tree)).toContain('- [ ] One\n  > id: one\n  > owner: me\n  note');
    const back = emojiFormatter.parse(emojiFormatter.serialize(cleanFormatter.parse(cleanFormatter.serialize(tree))));
    expect(back.sections[0].tasks[0].meta).toEqual([['id', 'one'], ['owner', 'me']]);
  });

  it('reads CRLF files', () => {
    const src = FILE.split('\n').join('\r\n');
    expect(first(src).meta?.[0]).toEqual(['id', 'ship-v2']);
    expect(serializeProject(parseProject(src))).toBe(src);
  });
});

// @req FR:task-ids/meta.emoji @req FR:task-ids/meta.fields
describe('emoji fields stay emoji', () => {
  it('names the emoji keys and lints them in metadata', () => {
    for (const k of ['priority', 'status', 'effort', 'impact']) expect(EMOJI_KEYS).toContain(k);
    const src = '# G\n\n## A\n\n- [ ] One\n  > id: one\n  > priority: 1\n';
    expect(lintIds([{ path: 'tasks/g.md', content: src }]).map((i) => [i.rule, i.line])).toEqual([['meta-emoji', 7]]);
  });
});

// @req FR:task-ids/id.format @req FR:task-ids/id.parse
describe('task ID format', () => {
  it('formats and parses with one prefix constant', () => {
    expect(TASK_ID_PREFIX).toBe('T:');
    expect(formatTaskId('xerilium/stack/goal', 'ship-v2')).toBe('T:xerilium/stack/goal.ship-v2');
    expect(parseTaskId('T:xerilium/stack/goal.ship-v2')).toEqual({ project: 'xerilium/stack/goal', slug: 'ship-v2' });
    expect(parseTaskId('T:a.b/c.d')).toEqual({ project: 'a.b/c', slug: 'd' });
    for (const bad of ['xerilium.goal', 'T:goal', 'T:.x', 'T:a.Bad', 'T:a.x-', 'T:../a.x']) expect(parseTaskId(bad)).toBeNull();
  });
});

// @req FR:task-ids/id.index
describe('ID index', () => {
  it('maps full IDs to path and line from every task file', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/x/goal.md', FILE);
    s.seed('tasks/y.md', '# Y\n\n## A\n\n- [ ] One\n  > id: one\n');
    const idx = await taskIndex(s);
    expect(idx.get('T:x/goal.ship-v2')).toEqual({ path: 'tasks/x/goal.md', line: 4 });
    expect(idx.get('T:y.one')).toEqual({ path: 'tasks/y.md', line: 4 });
    expect(idx.size).toBe(2);
  });
});

// @req FR:task-ids/assign.slug
describe('slugs', () => {
  it('drops emoji, markdown, reasons and cuts at 40 on a word end', () => {
    expect(slugOf('🚧 1️⃣ Ship [v2](https://x.y) now 🔴')).toBe('ship-v2-now');
    expect(slugOf('⛔ Wait for review -- pending approval')).toBe('wait-for-review');
    expect(slugOf('Fix `parseRef` in the API')).toBe('fix-parseref-in-the-api');
    expect(slugOf('one two three four five six seven eight nine ten')).toBe('one-two-three-four-five-six-seven-eight');
    expect(slugOf('🔥')).toBe('task');
  });
});

// @req FR:task-ids/assign.add @req FR:task-ids/assign.keep @req FR:task-ids/assign.idempotent @req FR:task-ids/assign.commit
describe('stack ids assign', () => {
  it('adds an id under each row without one, keeps every byte, and is idempotent', async () => {
    const s = new MemoryStorage();
    const src = ['# G', '', '## A', '', '- [ ] 🚧 Ship v2', '  > id: ship-v2', '  - [ ] Ship v2', '    notes stay', '\t- [ ] Tabbed', '- [x] Done one', '- [ ] 🌐 Query row', ''].join('\r\n');
    s.seed('tasks/g.md', src);
    let writes = 0;
    const orig = s.writeMany.bind(s);
    s.writeMany = async (w) => { writes++; return orig(w); };
    const r = await assignIds({ storage: s });
    expect(r).toEqual({ files: ['tasks/g.md'], added: 3 });
    expect(writes).toBe(1);
    expect((await s.read('tasks/g.md')).content).toBe(['# G', '', '## A', '', '- [ ] 🚧 Ship v2', '  > id: ship-v2', '  - [ ] Ship v2', '    > id: ship-v2-2', '    notes stay', '\t- [ ] Tabbed', '\t  > id: tabbed', '- [x] Done one', '  > id: done-one', '- [ ] 🌐 Query row', ''].join('\r\n'));
    expect(await assignIds({ storage: s })).toEqual({ files: [], added: 0 });
  });

  it('never ends a cut slug with a dash and skips fenced rows', async () => {
    const s = new MemoryStorage();
    const long = `${'a'.repeat(37)} bb`;
    s.seed('tasks/g.md', `# G\n\n## A\n\n- [ ] ${long}\n- [ ] ${long}\n\n\`\`\`md\n- [ ] Example row\n\`\`\`\n`);
    await assignIds({ storage: s });
    const out = (await s.read('tasks/g.md')).content;
    expect(out).toContain(`  > id: ${'a'.repeat(37)}-bb\n`);
    expect(out).toContain(`  > id: ${'a'.repeat(37)}-2\n`);
    expect(out).not.toMatch(/--2/);
    expect(out).toContain('```md\n- [ ] Example row\n```');
    expect(lintIds([{ path: 'tasks/g.md', content: out }])).toEqual([]);
  });

  it('honors --project and --dry-run', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/a.md', '# A\n\n## S\n\n- [ ] One\n');
    s.seed('tasks/b.md', '# B\n\n## S\n\n- [ ] Two\n');
    expect(await assignIds({ storage: s }, { project: 'a', dryRun: true })).toEqual({ files: ['tasks/a.md'], added: 1 });
    expect((await s.read('tasks/a.md')).content).not.toContain('> id:');
    await assignIds({ storage: s }, { project: 'a' });
    expect((await s.read('tasks/a.md')).content).toContain('  > id: one');
    expect((await s.read('tasks/b.md')).content).not.toContain('> id:');
  });
});

// @req FR:task-ids/mv.file @req FR:task-ids/mv.refs @req FR:task-ids/mv.report
describe('stack mv', () => {
  it('moves the file, its log and inbox, and rewrites every ref', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/stack.md', '# Stack\n\n## A\n\n- [ ] One\n  > id: one\n');
    s.seed('tasks/.stack/logs/stack.md', '## x\n- ref: tasks/stack.md:5\n');
    s.seed('tasks/.stack/logs/stack.2.md', '## y\n- ref: tasks/stack.md:5\n');
    s.seed('tasks/.stack/inbox/stack.md', '## in-1\n- ref: tasks/stack.md:5\n');
    s.seed('tasks/other.md', '# O\n\n## A\n\n- [ ] Two\n  > blocked: T:stack.one\n  > req: T:stackish.one\n');
    s.seed('tasks/.stack/asks/k.md', '# Ask: k\n\n- ref: stack:4\n');
    const r = await moveProject({ storage: s }, 'stack', 'xerilium/stack/goal');
    expect(r.refs).toBe(5);
    expect(r.files).toEqual(['tasks/.stack/asks/k.md', 'tasks/.stack/inbox/stack.md', 'tasks/.stack/logs/stack.2.md', 'tasks/.stack/logs/stack.md', 'tasks/other.md', 'tasks/stack.md']);
    expect(await s.list()).toEqual(['tasks/other.md', 'tasks/xerilium/stack/goal.md']);
    expect((await s.read('tasks/xerilium/stack/.stack/logs/goal.md')).content).toContain('- ref: tasks/xerilium/stack/goal.md:5');
    expect((await s.read('tasks/xerilium/stack/.stack/logs/goal.2.md')).content).toContain('tasks/xerilium/stack/goal.md:5');
    expect((await s.read('tasks/xerilium/stack/.stack/inbox/goal.md')).content).toContain('tasks/xerilium/stack/goal.md:5');
    expect((await s.read('tasks/other.md')).content).toContain('> blocked: T:xerilium/stack/goal.one\n  > req: T:stackish.one');
    expect((await s.read('tasks/.stack/asks/k.md')).content).toContain('- ref: xerilium/stack/goal:4');
    await expect(s.read('tasks/.stack/logs/stack.md')).rejects.toThrow();
  });

  it('rewrites whole refs only, in every .stack file', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/a.md', '# A\n');
    s.seed('tasks/a.b.md', '# AB\n');
    s.seed('tasks/n.md', '# N\n\n## S\n\n- [ ] T:a.one T:a.b.two T:ab.three XT:a.four\n- [ ] see tasks/a.md:3 and xtasks/a.md:3\n');
    s.seed('tasks/.stack/asks/archive/k.md', '- ref: a:3\n- ref: ab:3\n');
    s.seed('tasks/.stack/wake/cos.md', '- T:a.one\n');
    await moveProject({ storage: s }, 'a', 'z');
    expect((await s.read('tasks/n.md')).content).toContain('T:z.one T:a.b.two T:ab.three XT:a.four\n- [ ] see tasks/z.md:3 and xtasks/a.md:3');
    expect((await s.read('tasks/.stack/asks/archive/k.md')).content).toBe('- ref: z:3\n- ref: ab:3\n');
    expect((await s.read('tasks/.stack/wake/cos.md')).content).toBe('- T:z.one\n');
  });

  it('writes nothing on --dry-run', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/a.md', '# A\n');
    expect((await moveProject({ storage: s }, 'a', 'b', { dryRun: true })).files).toEqual(['tasks/a.md']);
    expect(await s.list()).toEqual(['tasks/a.md']);
  });
});

// @req FR:task-ids/mv.safe
describe('stack mv refusals', () => {
  it('refuses a missing source or an existing target', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/a.md', '# A\n');
    s.seed('tasks/b.md', '# B\n');
    await expect(moveProject({ storage: s }, 'nope', 'c')).rejects.toThrow(/not found/i);
    await expect(moveProject({ storage: s }, 'a', 'b')).rejects.toThrow(/exists/i);
    await expect(moveProject({ storage: s }, 'a', '../c')).rejects.toThrow();
    expect(await s.list()).toEqual(['tasks/a.md', 'tasks/b.md']);
  });
});

// @req FR:task-ids/lint.duplicate @req FR:task-ids/lint.dangling @req FR:task-ids/lint.slug
describe('ID lint', () => {
  it('flags duplicate slugs, dangling refs, and bad slugs', () => {
    const files = [
      { path: 'tasks/a.md', content: '# A\n\n## S\n\n- [ ] One\n  > id: one\n- [ ] Two\n  > id: one\n- [ ] Three\n  > id: Bad Slug\n' },
      { path: 'tasks/b.md', content: '# B\n\n## S\n\n- [ ] Uses T:a.one and T:a.gone\n  > blocked: T:c.x\n' },
    ];
    expect(lintIds(files).map((i) => `${i.path}:${i.line} ${i.rule}`)).toEqual([
      'tasks/a.md:8 id-duplicate', 'tasks/a.md:10 id-slug', 'tasks/b.md:5 id-dangling', 'tasks/b.md:6 id-dangling',
    ]);
  });
});

// @req FR:task-ids/lint.dangling
describe('ID lint false positives', () => {
  it('ignores prefixes inside words, code, URLs, and fences', () => {
    const src = '# A\n\n## S\n\n- [ ] Meet 9 PST:9.30 and AT:x.y\n- [ ] Code `T:a.gone` and https://x.y/T:a.gone\n\n```\nT:a.gone\n```\n';
    expect(lintIds([{ path: 'tasks/a.md', content: src }])).toEqual([]);
  });
});

// @req FR:task-ids/assign.add @req FR:task-ids/mv.file @req FR:task-ids/lint.dangling
describe('CLI', () => {
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-ids-')); mkdirSync(join(d, 'tasks'), { recursive: true }); mkdirSync(join(d, '.xe/config'), { recursive: true }); writeFileSync(join(d, '.xe/config/stack.json'), '{}'); return d; };
  const stack = async (d: string, ...args: string[]) => { const out: string[] = []; const err: string[] = []; const code = await run([...args, '--dir', d, '--no-commit'], { out: (s) => { out.push(s); }, err: (s) => { err.push(s); } }); return { code, out: out.join(''), err: err.join('') }; };
  it('assigns, moves, and lints', async () => {
    const d = dir();
    writeFileSync(join(d, 'tasks/a.md'), '# A\n\n## S\n\n- [ ] One\n');
    writeFileSync(join(d, 'tasks/b.md'), '# B\n\n## S\n\n- [ ] Two T:a.one\n');
    expect((await stack(d, 'ids', 'assign')).code).toBe(0);
    expect(readFileSync(join(d, 'tasks/a.md'), 'utf8')).toContain('  > id: one');
    expect((await stack(d, 'lint')).code).toBe(0);
    const mv = await stack(d, 'mv', 'a', 'x/a');
    expect(mv.code).toBe(0);
    expect(existsSync(join(d, 'tasks/x/a.md'))).toBe(true);
    expect(readFileSync(join(d, 'tasks/b.md'), 'utf8')).toContain('T:x/a.one');
    writeFileSync(join(d, 'tasks/b.md'), '# B\n\n## S\n\n- [ ] Two T:a.one\n  > id: two\n');
    const lint = await stack(d, 'lint');
    expect(lint.code).toBe(1);
    expect(lint.out + lint.err).toContain('tasks/b.md:5 id-dangling');
  });
});
