/** Guards docs/scheduled-reporting.md: the final-step block runs as written and every sample passes the schema. */
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { run } from '../../src/cli/run';
import { parseReport } from '../../src/core/reports';

const doc = readFileSync(resolve(__dirname, '../../docs/scheduled-reporting.md'), 'utf8');
const fences = [...doc.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2], at: m.index ?? 0 }));
const block = fences.find((f) => f.lang === 'text' && f.body.startsWith('FINAL STEP'));
/** The json fence under `### <heading>` in the Samples section. */
const sample = (heading: string) => {
  const at = doc.indexOf(`### ${heading}\n`);
  expect(at).toBeGreaterThan(doc.indexOf('## Samples'));
  const f = fences.find((x) => x.lang === 'json' && x.at > at);
  return JSON.parse(f!.body) as Record<string, unknown>;
};
/** Table cells, trimmed, for each row of the Tasks table. */
const rows = doc.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const TASKS = [
  ['f4-daily-checkin', 'f4-cos', 'f4', 'CoS daily check-in'],
  ['ftk-cos-daily-checkin', 'ftk-cos', 'ftk', 'CoS daily check-in'],
  ['ftk-support-report', 'ftk-support', 'ftk', 'Support report'],
] as const;

describe('docs/scheduled-reporting.md', () => {
  // @req FR:scheduled-task-reporting/step.block
  it('has one copy-paste block that starts FINAL STEP and sends JSON in a quoted heredoc', () => {
    expect(block).toBeDefined();
    expect(fences.filter((f) => f.body.startsWith('FINAL STEP'))).toHaveLength(1);
    expect(block!.body).toMatch(/^stack report --agent <agent> --project <project> --json <<'JSON'$/m);
    expect(block!.body).toMatch(/^JSON$/m);
  });

  // @req FR:scheduled-task-reporting/step.last @req FR:scheduled-task-reporting/step.always @req FR:scheduled-task-reporting/step.ids
  it('says the report is last, sent every run, with stable item ids', () => {
    const b = block!.body;
    expect(b).toMatch(/last step/i);
    expect(b).toMatch(/no step after this one/i);
    expect(b).toMatch(/every run/i);
    expect(b).toContain('`blockers`');
    expect(b).toMatch(/same every run/i);
    expect(b).toMatch(/never a date or run number/i);
  });

  // @req FR:scheduled-task-reporting/tokens.none @req FR:scheduled-task-reporting/tokens.lines
  it('forbids an LLM call and prose', () => {
    expect(block!.body).toMatch(/No LLM call/);
    expect(block!.body).toMatch(/no subagent, search, or summary pass/);
    expect(block!.body).toMatch(/no prose/i);
    expect(doc).toMatch(/^## No LLM call$/m);
  });

  // @req FR:scheduled-task-reporting/exit.codes @req FR:scheduled-task-reporting/exit.stop
  it('maps each exit code to one fixed action and never loops', () => {
    const b = block!.body;
    expect(b).toMatch(/Exit 0: stored/);
    expect(b).toMatch(/Exit 2: fix only the fields in `issues`; send once more/);
    expect(b).toMatch(/Exit 1: wait 5 s; send once more/);
    expect(b).toContain('report failed: <error>');
    expect(b).toMatch(/never loop/i);
  });

  // @req FR:scheduled-task-reporting/exit.host
  it('says a host that is down needs no action', () => {
    expect(doc).toMatch(/^## Host down\n\nNo action\./m);
    expect(doc).toContain('~/.stack/reports.json');
  });

  // @req FR:scheduled-task-reporting/answers.save
  it('saves owner answers for the next run, not this one', () => {
    expect(block!.body).toMatch(/`asks\.answers`.*state file.*Do not act on it now/);
  });

  // @req FR:scheduled-task-reporting/secrets.none
  it('forbids secrets in a report', () => {
    expect(block!.body).toMatch(/Never a secret/);
    for (const w of ['token', 'webhook url', 'signed url']) expect(block!.body).toContain(w);
    expect(doc).toMatch(/^## No secrets$/m);
  });

  // @req FR:scheduled-task-reporting/samples.types @req FR:scheduled-task-reporting/samples.tasks
  it.each(TASKS)('lists %s as %s/%s and its sample passes the schema', (task, agent, project, type) => {
    expect(rows).toContainEqual([`\`${task}\``, `\`${agent}\``, `\`${project}\``, type]);
    expect(() => parseReport({ ...sample(type), agent, project })).not.toThrow();
  });

  // @req FR:scheduled-task-reporting/samples.run
  it.each(TASKS)('the block runs as written for %s and exits 0', async (_task, agent, project, type) => {
    const cmd = block!.body.split('\n').find((l) => l.startsWith('stack report '))!.replace('<agent>', agent).replace('<project>', project);
    const args = cmd.replace(/ <<'JSON'$/, '').split(' ').slice(1);
    process.env.STACK_HOME = mkdtempSync(join(tmpdir(), 'stack-sched-'));
    let out = '';
    try {
      const code = await run([...args, '--dir', tmpdir()], { out: (s) => { out += s; }, err: (s) => { out += s; }, in: async () => JSON.stringify(sample(type)) });
      expect({ code, out: JSON.parse(out) }).toMatchObject({ code: 0, out: { ok: true, via: 'store', agent, project } });
    } finally { delete process.env.STACK_HOME; }
  });
});
