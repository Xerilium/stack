import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsStorage, MemoryStorage, PathError, validatePath } from '../../src/core/storage';
import { isReadme, logFile, projectId, projectPath, systemDir } from '../../src/core/task-paths';
import { archiveAsks, listAsks, putAsk, readAsk } from '../../src/core/asks';
import { putAgent, agentFor, listTeam } from '../../src/core/agents';
import { listInbox, sendToInbox } from '../../src/core/inbox';
import { wakePath } from '../../src/core/ask-wake';
import { formatRef, parseRef } from '../../src/api/validate';
import { parseTaskRef } from '../../src/core/ask-actions';
import { classify } from '../../src/cli/watch';
import { walkStackDir } from '../../src/cli/discover';
import { rankStack } from '../../src/core/lifecycle';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'stack-ts-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const put = (root: string, rel: string, body = '# T\n') => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), body); };

const PROJECT = '# Goal\n\n## 🔥 Active\n\n- [ ] Ship it\n';
const NOW = new Date('2026-11-19T12:00:00Z');

// @req FR:task-structure/tree.list @req FR:task-structure/tree.dot
describe('folder tree list', () => {
  it('lists .md files at every depth and skips dot names', async () => {
    const d = tmp();
    for (const p of ['tasks/a.md', 'tasks/x/b.md', 'tasks/x/y/c.md', 'tasks/x/.stack/asks/k.md', 'tasks/.stack/logs/a.md', 'tasks/.hidden/d.md', 'tasks/x/.e.md', 'tasks/x/notes.txt']) put(d, p);
    expect(await new FsStorage(d).list()).toEqual(['tasks/a.md', 'tasks/x/b.md', 'tasks/x/y/c.md']);
  });

  it('memory storage lists the same tree', async () => {
    const s = new MemoryStorage();
    for (const p of ['tasks/a.md', 'tasks/x/y/c.md', 'tasks/x/.stack/asks/k.md']) s.seed(p, '# T\n');
    expect(await s.list()).toEqual(['tasks/a.md', 'tasks/x/y/c.md']);
  });
});

// @req FR:task-structure/tree.path
describe('nested task paths', () => {
  it('accepts any depth and refuses dot segments', () => {
    expect(validatePath('tasks/xerilium/stack/goal.md')).toBe('tasks/xerilium/stack/goal.md');
    for (const bad of ['tasks/../x.md', 'tasks/x/../y.md', 'tasks/.x/y.md', 'tasks/x/.y.md', 'tasks/x//y.md', 'tasks/x/y.txt']) expect(() => validatePath(bad)).toThrow(PathError);
  });
});

// @req FR:task-structure/tree.symlink
describe('symlinks', () => {
  it('never follows a nested symlinked folder or file', async () => {
    const d = tmp();
    const out = tmp();
    put(out, 'secret.md');
    put(d, 'tasks/x/a.md');
    symlinkSync(out, join(d, 'tasks/x/link'));
    symlinkSync(join(out, 'secret.md'), join(d, 'tasks/x/s.md'));
    expect(await new FsStorage(d).list()).toEqual(['tasks/x/a.md']);
  });
});

// @req FR:task-structure/tree.readme
describe('readme', () => {
  it('is never a project at any level', async () => {
    expect(isReadme('tasks/README.md')).toBe(true);
    expect(isReadme('tasks/x/readme.md')).toBe(true);
    expect(isReadme('tasks/x/goal.md')).toBe(false);
    const s = new MemoryStorage();
    s.seed('tasks/x/README.md', PROJECT);
    s.seed('tasks/x/goal.md', PROJECT);
    expect((await rankStack({ storage: s, now: () => NOW }, NOW)).map((t) => t.ref.path)).toEqual(['tasks/x/goal.md']);
  });
});

// @req FR:task-structure/tree.discover
describe('discovery', () => {
  it('finds a git repo whose tasks hold only nested files', () => {
    const d = tmp();
    mkdirSync(join(d, '.git'));
    put(d, 'tasks/x/y/goal.md');
    expect(walkStackDir(join(d, 'tasks/x'))).toBe(d);
  });
});

// @req FR:task-structure/id.project
describe('project IDs', () => {
  it('is the path under tasks without .md', () => {
    expect(projectId('tasks/xerilium/stack/goal.md')).toBe('xerilium/stack/goal');
    expect(projectId('tasks/alpha.md')).toBe('alpha');
    expect(projectPath('xerilium/stack/goal')).toBe('tasks/xerilium/stack/goal.md');
  });

  it('names nested projects by ID in the inbox list', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/a/goal.md', PROJECT);
    s.seed('tasks/b/goal.md', PROJECT);
    const ctx = { storage: s, now: () => NOW };
    await sendToInbox(ctx, { path: 'tasks/a/goal.md', line: 4 }, 'go', 'instruction');
    expect((await listInbox(ctx, { project: 'a/goal' })).map((e) => e.project)).toEqual(['a/goal']);
    expect(await listInbox(ctx, { project: 'b/goal' })).toEqual([]);
  });
});

// @req FR:task-structure/id.ref
describe('refs with nested IDs', () => {
  it('parses and formats nested refs', () => {
    expect(parseRef('xerilium/stack/goal:4')).toEqual({ path: 'tasks/xerilium/stack/goal.md', line: 4 });
    expect(formatRef({ path: 'tasks/xerilium/stack/goal.md', line: 4 })).toBe('xerilium/stack/goal:4');
    expect(parseTaskRef('x/goal:2')).toEqual({ path: 'tasks/x/goal.md', line: 2 });
    for (const bad of ['x/README:1', 'x/../y:1', 'x/.y:1', '/x:1', 'x/:1']) expect(parseRef(bad)).toBeNull();
  });
});

// @req FR:task-structure/id.scope
describe('agent scopes with nested IDs', () => {
  it('covers folders, projects, and sections, most specific first', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/x/stack/goal.md', '# Goal\n\n## 🔥 Active\n\n- [ ] A\n\n## 🏷️ Labels\n\n- [ ] B\n');
    s.seed('tasks/y.md', PROJECT);
    const ctx = { storage: s, now: () => NOW };
    await putAgent(ctx, 'folder', { name: 'Folder', scope: ['x'] });
    await putAgent(ctx, 'proj', { name: 'Proj', scope: ['x/stack/goal'] });
    await putAgent(ctx, 'sect', { name: 'Sect', scope: ['x/stack/goal/Labels'] });
    const team = await listTeam(ctx);
    expect(team.find((a) => a.slug === 'folder')!.projects).toEqual(['x/stack/goal']);
    expect(agentFor(team, 'x/stack/goal', '🏷️ Labels').map((a) => a.slug)).toEqual(['sect', 'proj', 'folder']);
    expect(agentFor(team, 'x/stack/goal', '🔥 Active').map((a) => a.slug)).toEqual(['proj', 'folder']);
    expect(agentFor(team, 'y').map((a) => a.slug)).toEqual([]);
  });
});

// @req FR:task-structure/system.path
describe('system paths', () => {
  it('accepts .stack folders at any level and refuses the old folders', () => {
    for (const ok of ['tasks/.stack/asks/k.md', 'tasks/x/.stack/asks/k.md', 'tasks/x/y/.stack/asks/archive/k.md', 'tasks/x/.stack/agents/a.md', 'tasks/x/.stack/logs/goal.md', 'tasks/x/.stack/inbox/goal.md', 'tasks/x/.stack/wake/a.md']) expect(validatePath(ok)).toBe(ok);
    for (const bad of ['tasks/x/.stack/other/k.md', 'tasks/x/.stack/asks/README.md', 'tasks/x/.stack/asks/Up.md', 'tasks/.stack/k.md', 'tasks/.x/.stack/asks/k.md']) expect(() => validatePath(bad)).toThrow(PathError);
  });

  it('treats the old plain folders as task folders', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/asks/k.md', '# T\n');
    expect(await s.listAsks()).toEqual([]);
    expect(await s.list()).toEqual(['tasks/asks/k.md']);
  });
});

// @req FR:task-structure/system.list
describe('system lists', () => {
  it('lists asks and agents from every level (fs and memory)', async () => {
    const d = tmp();
    const s = new MemoryStorage();
    for (const p of ['tasks/.stack/asks/a.md', 'tasks/x/.stack/asks/b.md', 'tasks/x/y/.stack/asks/c.md', 'tasks/x/.stack/asks/archive/z.md', 'tasks/.stack/agents/r.md', 'tasks/x/.stack/agents/q.md']) { put(d, p); s.seed(p, '# T\n'); }
    for (const st of [new FsStorage(d), s]) {
      expect(await st.listAsks!()).toEqual(['tasks/.stack/asks/a.md', 'tasks/x/.stack/asks/b.md', 'tasks/x/y/.stack/asks/c.md']);
      expect(await st.listAgents!()).toEqual(['tasks/.stack/agents/r.md', 'tasks/x/.stack/agents/q.md']);
    }
  });
});

// @req FR:task-structure/system.beside
describe('logs and inbox beside the project', () => {
  it('writes the inbox in the .stack folder of the project folder', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/x/y/goal.md', PROJECT);
    const r = await sendToInbox({ storage: s, now: () => NOW }, { path: 'tasks/x/y/goal.md', line: 4 }, 'go', 'instruction');
    expect(r.path).toBe('tasks/x/y/.stack/inbox/goal.md');
    expect(systemDir('tasks/x/y/goal.md')).toBe('tasks/x/y/.stack');
    expect(systemDir('tasks/alpha.md')).toBe('tasks/.stack');
    expect(logFile('tasks/x/y/goal.md', 0)).toBe('tasks/x/y/.stack/logs/goal.md');
    expect(logFile('tasks/alpha.md', 2)).toBe('tasks/.stack/logs/alpha.3.md');
  });
});

// @req FR:task-structure/system.root
describe('root system writes', () => {
  it('writes new asks, agents, and wake files in tasks/.stack', async () => {
    const s = new MemoryStorage();
    const ctx = { storage: s, now: () => NOW };
    await putAsk(ctx, 'k1', { ask: 'Approve it', kind: 'approve', from: 'cos' }, 'cos');
    await putAgent(ctx, 'ag', { name: 'Ag' });
    expect(await s.listAsks()).toEqual(['tasks/.stack/asks/k1.md']);
    expect(await s.listAgents()).toEqual(['tasks/.stack/agents/ag.md']);
    expect(wakePath('Allyte CoS')).toBe('tasks/.stack/wake/allyte-cos.md');
  });
});

// @req FR:task-structure/system.ask-key
describe('ask key at any level', () => {
  const ASK = '# Ask: k2\n\n- state: done\n- ask: Approve it\n- kind: approve\n- from: cos\n- created: 2026-10-01T00:00:00.000Z\n- updated: 2026-10-01T00:00:00.000Z\n';
  it('reads, updates, and archives a nested ask in its own folder', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/x/.stack/asks/k2.md', ASK);
    const ctx = { storage: s, now: () => NOW };
    expect((await readAsk(ctx, 'k2'))?.ask.ask).toBe('Approve it');
    expect((await listAsks(ctx, { state: 'all' })).items.map((a) => a.key)).toEqual(['k2']);
    await putAsk(ctx, 'k2', { ask: 'Approve it now', kind: 'approve', from: 'cos' }, 'cos');
    expect(await s.listAsks()).toEqual(['tasks/x/.stack/asks/k2.md']);
    await s.write('tasks/x/.stack/asks/k2.md', ASK);
    expect((await archiveAsks(ctx, { days: 1 })).archived).toEqual(['k2']);
    await expect(s.read('tasks/x/.stack/asks/archive/k2.md')).resolves.toBeDefined();
    expect(await s.listAsks()).toEqual([]);
  });

  it('resolves a key in two folders to the first path in sort order', async () => {
    const s = new MemoryStorage();
    s.seed('tasks/b/.stack/asks/k2.md', ASK.replace('Approve it', 'B'));
    s.seed('tasks/a/.stack/asks/k2.md', ASK.replace('Approve it', 'A'));
    expect((await readAsk({ storage: s, now: () => NOW }, 'k2'))?.ask.ask).toBe('A');
  });
});

// @req FR:task-structure/system.watch
describe('watcher', () => {
  it('reports any .stack/asks change as asks', () => {
    expect(classify('tasks/x/y/.stack/asks/k.md')).toBe('asks');
    expect(classify('tasks/.stack/asks/k.md')).toBe('asks');
    expect(classify('tasks/x/goal.md')).toBe('tasks');
    expect(classify('tasks/x/.stack/inbox/goal.md')).toBe('tasks');
  });
});
