/** Perf budgets for ranking and reading. CPU time (not wall) so a busy machine does not flake. @req FR:perf/rank.cost */
import { getDefaults } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import { getEngine, rankTasks, registerEngine, stackEngine, toScoringProject, type ScoringProject } from '../../src/core/scoring';
import { rankStack } from '../../src/core/lifecycle';
import { MemoryStorage } from '../../src/core/storage';
import { createApiHandler } from '../../src/api/handler';

function project(p: number, n: number): ScoringProject {
  let s = `# P${p}\n\n## 🔄 Active\n\n`;
  for (let i = 0; i < n; i++) {
    s += `- [ ] Parent ${p}-${i} 🟡 📅 Nov 20: x${i % 3 === 0 ? ' 🔺' : ''}\n  - [ ] Child ${p}-${i}a 🟢${i % 5 === 0 ? ` -- after Parent ${p}-${Math.max(0, i - 1)}` : ''}\n  - [ ] Child ${p}-${i}b ⏳\n`;
  }
  return toScoringProject(parseProject(s), `p${p}`);
}
const projects = (tasks: number) => Array.from({ length: 4 }, (_, p) => project(p, tasks / 12));
const cfg = getDefaults();
const at = new Date('2026-11-05T15:00:00Z');
const cpuMs = (fn: () => void): number => { const c = process.cpuUsage(); fn(); const d = process.cpuUsage(c); return (d.user + d.system) / 1000; };
const best = (fn: () => void, n = 5) => Math.min(...Array.from({ length: n }, () => cpuMs(fn)));

describe('ranking cost', () => {
  // @req FR:perf/rank.cost
  it('ranks 1,200 tasks within 70 ms CPU', () => {
    const ps = projects(1200); const eng = getEngine('stack');
    rankTasks(eng, ps, cfg, at);
    expect(best(() => { rankTasks(eng, ps, cfg, at); })).toBeLessThan(70);
  });
  // @req FR:perf/rank.scale
  it('ranks 4,800 tasks within 350 ms CPU', () => {
    const ps = projects(4800); const eng = getEngine('stack');
    rankTasks(eng, ps, cfg, at);
    expect(best(() => { rankTasks(eng, ps, cfg, at); }, 3)).toBeLessThan(350);
  });
});

const files = (n: number) => { const m = new MemoryStorage(); return Promise.all(Array.from({ length: n }, (_, i) => m.write(`tasks/p${i}.md`, `# P${i}\n\n## 🔄 Active\n\n- [ ] One ${i}\n- [ ] Two ${i}\n`))).then(() => m); };

describe('rank cache', () => {
  // @req FR:perf/rank.cache
  it('scores once for unchanged files and again after a write', async () => {
    let calls = 0;
    registerEngine({ ...stackEngine, id: 'perf-count', score: (p, c) => { calls++; return stackEngine.score(p, c); } });
    const storage = await files(3);
    const ctx = { storage, now: () => at, engine: 'perf-count' };
    await rankStack(ctx, undefined, 100);
    await rankStack(ctx, undefined, 5);
    await rankStack(ctx, undefined, 100, { ignoreBlocks: false });
    expect(calls).toBe(1);
    await storage.write('tasks/p0.md', '# P0\n\n## 🔄 Active\n\n- [ ] Changed\n');
    await rankStack(ctx, undefined, 100);
    expect(calls).toBe(2);
  });
});

describe('parallel reads', () => {
  // @req FR:perf/load.parallel
  it('lists tasks from 25 slow files in under 500 ms', async () => {
    const inner = await files(25);
    const slow = Object.create(inner) as MemoryStorage;
    slow.read = async (p: string) => { await new Promise((r) => setTimeout(r, 40)); return inner.read(p); };
    const api = createApiHandler({ storage: slow, config: cfg, authorize: () => true });
    const t = Date.now();
    const r = await api(new Request('http://localhost/api/tasks?state=open&limit=200'));
    expect(r.status).toBe(200);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
