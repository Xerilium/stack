#!/usr/bin/env node
/**
 * Init-performance benchmark for `stack web` (needs `pnpm build:core build:cli build:api build:web`).
 * Usage: node scripts/perf/bench.mjs [--repo DIR] [--synthetic N] [--runs R] [--json]
 * Reports min/median wall ms and CPU ms (user+sys) per step. CPU is steady when the machine is loaded; trust it over wall.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const root = resolve(new URL('../..', import.meta.url).pathname);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const runs = Number(arg('runs', 5));
const synthetic = Number(arg('synthetic', 0));
let repo = arg('repo');

/** A repo of `n` tasks over ~12 projects, with nested tasks, tags, due dates, notes; plus node_modules-sized noise. */
export function makeSynthetic(n, noise = true) {
  const dir = mkdtempSync(join(tmpdir(), 'stack-bench-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, '.xe/config'), { recursive: true });
  writeFileSync(join(dir, '.xe/config/stack.json'), '{}\n');
  const projects = 12;
  const per = Math.ceil(n / projects);
  for (let p = 0; p < projects; p++) {
    let s = `# Project ${p}\n\n- **Priority:** ${p % 4 + 1}\n\n## Active\n\n`;
    for (let i = 0; i < per; i++) {
      const due = i % 7 === 0 ? ` 📅 2026-11-${String(10 + (i % 18)).padStart(2, '0')}` : '';
      const eff = ['🔹', '🟢', '🟡', '🟠'][i % 4]; const pr = i % 11 === 0 ? ' 🔺' : i % 13 === 0 ? ' 🅿️' : '';
      const block = i % 5 === 0 && i > 0 ? ` -- after Task ${p}-${i - 1} do the thing for @person${(i - 1) % 5} #tag${(i - 1) % 9}` : '';
      s += `- [ ] Task ${p}-${i} do the thing for @person${i % 5} #tag${i % 9} ${eff}${pr}${due}${block}\n`;
      if (i % 3 === 0) s += `  - [ ] Sub ${p}-${i}a\n  - [x] Sub ${p}-${i}b\n    note line for ${i}\n`;
    }
    s += `\n## Up next\n\n- [ ] Later ${p}\n\n## Done\n\n- [x] Old ${p}\n`;
    writeFileSync(join(dir, 'tasks', `project-${p}.md`), s);
  }
  if (noise) {
    for (let d = 0; d < 40; d++) {
      const nm = join(dir, 'node_modules', `pkg${d}`, 'lib');
      mkdirSync(nm, { recursive: true });
      for (let f = 0; f < 50; f++) writeFileSync(join(nm, `f${f}.js`), 'x');
    }
  }
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  g('init', '-q', '-b', 'main'); g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return dir;
}

if (!repo) repo = makeSynthetic(synthetic || 500);
const { startWeb } = await import(pathToFileURL(join(root, 'dist/cli/web.js')).href);
const webDir = join(root, 'web/dist');
const cpu = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { min: Math.round(s[0]), med: Math.round(s[Math.floor(s.length / 2)]) }; };
const steps = {};
const rec = (k, wall, c) => { if (k === 'client load') return void ((steps[k] ??= { wall: [], cpu: [] }), steps[k].wall.push(wall), steps[k].cpu.push(c)); (steps[k] ??= { wall: [], cpu: [] }); steps[k].wall.push(wall); steps[k].cpu.push(c); };
const time = async (k, fn) => { const w = performance.now(), c = cpu(); const r = await fn(); rec(k, performance.now() - w, cpu() - c); if (k === 'client load') steps[k].reqs = r; return r; };

for (let r = 0; r < runs; r++) {
  const srv = await time('start', () => startWeb({ dir: repo, port: 0, webDir, agents: false }));
  const get = (p) => fetch(srv.url + p).then(async (x) => { const b = await x.arrayBuffer(); if (!x.ok) throw new Error(`${p} ${x.status}`); return b.byteLength; });
  await time('index.html', () => get('/'));
  await time('auth/me', () => get('/.auth/me'));
  await time('tasks cold', () => get('/api/tasks?state=open&limit=200'));
  await time('rank cold', () => get('/api/rank'));
  await time('tasks warm', () => get('/api/tasks?state=open&limit=200'));
  await time('rank warm', () => get('/api/rank'));
  await time('first-load burst', () => Promise.all([get('/api/tasks?state=open&limit=200'), get('/api/rank'), get('/api/projects')]));
  // What the web client does on load (App.tsx refresh + loadSide), request for request. Counted so a waterfall regression shows.
  const rangeFrom = new Date().toISOString(), rangeTo = new Date(Date.now() + 864e5).toISOString();
  await time('client load', async () => {
    let n = 0; const g = (p) => { n++; return get(p); };
    await g('/.auth/me');
    const side = (async () => { await g('/api/schedule?at=' + encodeURIComponent(rangeFrom)).catch(() => 0); await Promise.allSettled([g('/api/agents'), g('/api/inbox'), g(`/api/calendar?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`)]); })();
    const data = (async () => {
      await Promise.all([g('/api/rank?limit=100'), g('/api/rank?limit=1000&blocks=any'), (async () => { for (let o = 0; ; o += 200) { const j = await fetch(srv.url + `/api/tasks?state=all&limit=200&offset=${o}&fields=ref,text,project,section,done,depth,notes`).then((x) => x.json()); n++; if (!j.items.length || o + 200 >= j.total) break; } })(), g('/api/projects?fields=name,title,open,done,metadata')]);
      await g('/api/needs-you').catch(() => 0);
    })();
    await Promise.all([side, data]);
    return n;
  });
  await srv.close();
}
const out = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, { wall: stats(v.wall), cpu: stats(v.cpu), ...(v.reqs ? { reqs: v.reqs } : {}) }]));
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`repo=${repo} runs=${runs}`);
  console.log('step'.padEnd(18) + 'wall min/med'.padEnd(16) + 'cpu min/med (ms)');
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(18) + `${v.wall.min}/${v.wall.med}`.padEnd(16) + `${v.cpu.min}/${v.cpu.med}` + (v.reqs ? `  (${v.reqs} requests)` : ''));
}
process.exit(0);
