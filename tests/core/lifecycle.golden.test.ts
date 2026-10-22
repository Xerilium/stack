import { readFileSync } from 'fs';
import { join } from 'path';
import { getDefaults } from '../../src/core/config';
import {
  addProject, completeTask, removeCompleted, resumeTask, setProperties, skipTask, startTask, sweep, TaskProps,
} from '../../src/core/lifecycle';
import { MemoryStorage } from '../../src/core/storage';

/**
 * Golden outputs come from the legacy PowerShell (tests/fixtures/lifecycle/generate-golden.ps1).
 * Inputs are synthetic; the real legacy task files are never committed.
 */
const dir = join(__dirname, '..', 'fixtures', 'lifecycle');
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

interface Case {
  name: string; file: string; op: string; match: string | null;
  args: { summary?: string; when?: string; name?: string } & TaskProps & Record<string, unknown>;
}
const cases: Case[] = JSON.parse(read('cases.json'));
// Pinned clock: Thu 2026-10-22 10:00 PDT, the day the legacy sweep goldens were generated.
const NOW = new Date('2026-10-22T17:00:00Z');

// @req FR:task-lifecycle/doc.lossless
describe.each(cases)('golden: $name', (c) => {
  it('matches legacy output byte for byte', async () => {
    const storage = new MemoryStorage();
    const path = 'tasks/x.md';
    if (c.file) await storage.write(path, read(`input/${c.file}.md`));
    const ctx = { storage, config: getDefaults(), now: () => NOW };
    const line = c.match === null ? 0 : (await storage.read(path)).content.split('\n').findIndex((l) => l.includes(c.match!));
    if (c.match !== null) expect(line).toBeGreaterThanOrEqual(0);
    const ref = { path, line };
    const { when, summary, ...props } = c.args;

    let out: string;
    switch (c.op) {
      case 'start': await startTask(ctx, ref); break;
      case 'complete': await completeTask(ctx, ref, { summary }); break;
      case 'complete-remove': await completeTask(ctx, ref, { remove: true }); break;
      case 'skip': await skipTask(ctx, ref); break;
      case 'resume': await resumeTask(ctx, ref); break;
      case 'suspend': await setProperties(ctx, ref, { suspend: when }); break;
      case 'set': await setProperties(ctx, ref, props as TaskProps); break;
      case 'remove-completed': await removeCompleted(ctx); break;
      case 'sweep': await sweep(ctx); break;
      case 'add-project': {
        const a = c.args as unknown as Parameters<typeof addProject>[1];
        out = (await storage.read((await addProject(ctx, a)).path)).content;
        expect(out).toBe(read(`expected/${c.name}.md`));
        return;
      }
      default: throw new Error(`unknown op ${c.op}`);
    }
    expect((await storage.read(path)).content).toBe(read(`expected/${c.name}.md`));
  });
});
