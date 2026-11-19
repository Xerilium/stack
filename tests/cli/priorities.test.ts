import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';
import { liveDeps, prioritiesCmd, type PrioritiesDeps } from '../../src/cli/priorities';
import { tieredTasks } from '../../src/core/tiered-tasks';

const NOW = '2026-11-18T19:00:00.000Z';
const PRIS = [
  { id: 'qm', title: 'QM', status: 'active', items: [], backlog: [], weekly: [], perProject: true, keywords: ['QM'], days: { wed: 0, thu: 'off' } },
  { id: 'fh', title: 'FH 0.11', label: 'FH.com', status: 'active', items: [], backlog: [], weekly: [], projects: ['Allyte'], refs: ['allytehq/finops-hubs'], session: 's1' },
  { id: 'arc', title: 'Arc', status: 'active', items: [], backlog: [], weekly: [] },
];
const ALLYTE = '# 🏦 Allyte\n\n- **Aliases:** fh\n\n## Active\n\n- [ ] 1️⃣ 🔄 Live-validate 430 (agent: FH backend)\n- [ ] 1️⃣ QM: approve plan (agent: qm-planner)\n';
const writePris = (home: string) => writeFileSync(join(home, 'pris.json'), JSON.stringify({ version: 1, rev: 1, pris: PRIS }));
const deps = (home: string, o: Partial<PrioritiesDeps> = {}): PrioritiesDeps => ({
  home, timeZone: 'America/Los_Angeles', now: () => new Date(NOW),
  tasks: async () => tieredTasks('tasks/allyte.md', ALLYTE),
  inventory: () => ({ at: NOW, sessions: [{ id: 's1', title: 'FH backend', link: 'claude://claude.ai/epitaxy/s1' }] }),
  board: async () => ({ at: NOW, rows: [{ url: 'https://github.com/allytehq/finops-hubs/pull/1142', repo: 'allytehq/finops-hubs', number: 1142, title: 'Settings edit', project: 'allyte', nextAction: 'autopilot', specLines: 4 }] }),
  ...o,
});

describe('stack priorities', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'stack-pt-')); writePris(home); });

  // @req FR:priorities-tables/cli.@cli @req FR:priorities-tables/cli.read @req FR:priorities-tables/cli.text
  it('prints each section as a rule, a heading with its stamp and a markdown table', async () => {
    const r = await prioritiesCmd({}, [], deps(home));
    expect(r.text.split('\n')).toEqual([
      '---', '## QM (as of 11:00 AM)', '', '| Project | Agent | 🤖 Status | 👱‍♂️ Next action |', '| --- | --- | --- | --- |',
      '| Allyte | qm-planner | ❓ Unknown | QM: approve plan |', '',
      '---', '## Now (as of 11:00 AM)', '', '| Project | Agent | 🤖 Status | 👱‍♂️ Next action |', '| --- | --- | --- | --- |',
      '| FH.com | [FH backend](#s1) | 🔄 Working | Live-validate 430 |',
      '| Arc | -- | -- | Gap: No tiered task in tasks/ |', '',
      '---', '## PRs (as of 11:00 AM)', '', '| PR | Agent | 👱‍♂️ Next action | Time |', '| --- | --- | --- | --- |',
      '| 🏦 [1142](https://github.com/allytehq/finops-hubs/pull/1142) | [FH backend](#s1) | Autopilot: promote | 5m |', '',
      '---', '## Today (as of 11:00 AM)', '', 'Nothing here', '',
      '---', '## Next 3 days (as of 11:00 AM)', '', 'Nothing here',
    ]);
  });
  // @req FR:priorities-tables/cli.json
  it('gives the report as JSON', async () => {
    const r = await prioritiesCmd({}, [], deps(home));
    const j = r.json as { ok: boolean; at: string; qm: { rows: unknown[] }; now: { rows: unknown[] }; prs: { rows: unknown[] } };
    expect(j.ok).toBe(true);
    expect(j.at).toBe(NOW);
    expect(j.now.rows[0]).toMatchObject({ id: 'fh', project: 'FH.com', agent: { name: 'FH backend', link: 'claude://claude.ai/epitaxy/s1' }, status: 'working', stale: false });
    expect(j.prs.rows).toEqual([{ emoji: '🏦', number: 1142, url: 'https://github.com/allytehq/finops-hubs/pull/1142', agent: { name: 'FH backend', link: 'claude://claude.ai/epitaxy/s1' }, action: 'Autopilot: promote', minutes: 5, server: null, details: null }]);
  });
  // @req FR:priorities-tables/cli.read.board @req FR:priorities-tables/pr.live.none
  it('builds the report with no board when there is no GitHub sign-in', async () => {
    const r = await prioritiesCmd({}, [], deps(home, { board: async () => undefined }));
    const lines = r.text.split('\n');
    const at = lines.indexOf('## PRs (as of 11:00 AM, stale)');
    expect(lines[at + 2]).toBe('Not verified live');
    await expect(prioritiesCmd({}, ['x'], deps(home))).rejects.toThrow('Unexpected argument');
  });
  // @req FR:priorities-tables/cli.read @req FR:priorities-tables/tasks.store
  it('reads tiered tasks from the task files in the data folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-pt-dir-'));
    mkdirSync(join(dir, 'tasks', 'asks'), { recursive: true });
    writeFileSync(join(dir, 'tasks', 'allyte.md'), ALLYTE);
    writeFileSync(join(dir, 'tasks', 'asks', 'a1.md'), '- [ ] 1️⃣ not a project task');
    const t = await liveDeps(home, dir, () => undefined, {}).tasks();
    expect(t.map((x) => [x.path, x.text])).toEqual([['tasks/allyte.md', 'Live-validate 430'], ['tasks/allyte.md', 'QM: approve plan']]);
  });
  // @req FR:priorities-tables/cli.@cli
  it('is a registered command', async () => {
    const out: string[] = [];
    const code = await run(['--help'], { out: (s) => { out.push(s); }, err: () => {} });
    expect(code).toBe(0);
    expect(out.join('')).toContain('priorities [--json]');
  });
});
