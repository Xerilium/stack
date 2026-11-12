/** Guards docs/scheduled-reporting.md: the final-step block runs as written and every sample passes the schema. */
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
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
    for (const f of ['{text, link?}', 'id', 'ask', 'link (https)', 'by (ISO date)', 'kind?', 'recommend?', 'why?', 'default?', 'priority?', 'No other keys']) expect(block!.body).toContain(f);
  });

  // @req FR:scheduled-task-reporting/step.last @req FR:scheduled-task-reporting/step.always @req FR:scheduled-task-reporting/step.ids
  it('says the report is last, sent every run, with stable item ids', () => {
    const b = block!.body;
    expect(b).toMatch(/last step/i);
    expect(b).toMatch(/no step after this one/i);
    expect(b).toMatch(/every run/i);
    expect(b).toMatch(/List every open ask again each run/);
    expect(b).toContain('`blockers`');
    expect(b).toMatch(/same every run/i);
    expect(b).toMatch(/never a date or run number/i);
    expect(b).toMatch(/add the repo when the project has more than one/);
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
    expect(b).toMatch(/Exit 2: fix only what `error` and `issues` name; send once more/);
    expect(b).toMatch(/Exit 1: send once more/);
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
    expect(block!.body).toMatch(/`asks\.answers`.*state file \(create `state\.md` beside this prompt if none\)\. Do not act on it now\. The next run reads it before its main work/);
  });

  // @req FR:scheduled-task-reporting/secrets.none
  it('forbids secrets in a report', () => {
    expect(block!.body).toMatch(/Never a secret/);
    for (const w of ['token', 'key', 'password', 'webhook url', 'signed url', 'url with a token in its query']) expect(block!.body).toContain(w);
    const section = doc.slice(doc.indexOf('## No secrets'), doc.indexOf('## Samples'));
    expect(section).toMatch(/No personal data beyond names already public/);
    expect(section).toMatch(/Links point at the item itself/);
    expect(block!.body).toMatch(/with an https link/);
  });

  // @req FR:scheduled-task-reporting/samples.types @req FR:scheduled-task-reporting/samples.tasks
  it.each(TASKS)('lists %s as %s/%s and its sample passes the schema', (task, agent, project, type) => {
    expect(rows).toContainEqual([`\`${task}\``, `\`${agent}\``, `\`${project}\``, type]);
    expect(() => parseReport({ ...sample(type), agent, project })).not.toThrow();
  });

  /** The block's command lines (`stack report ...` through the closing `JSON`), for one task, with `body` in the heredoc. */
  const command = (agent: string, project: string, body: string | null) => {
    const lines = block!.body.split('\n');
    const start = lines.findIndex((l) => l.startsWith('stack report '));
    const end = lines.indexOf('JSON', start);
    const cmd = lines.slice(start, end + 1).map((l) => l.replace('<agent>', agent).replace('<project>', project));
    if (body !== null) cmd.splice(1, end - start - 1, body);
    return cmd.join('\n');
  };
  /** Runs the command in bash with `stack` stubbed to record its argv and stdin, then runs those through the real CLI. */
  async function viaShell(script: string) {
    const dir = mkdtempSync(join(tmpdir(), 'stack-sched-'));
    execFileSync('bash', ['-c', `stack() { printf '%s\\n' "$@" > "${dir}/argv"; cat > "${dir}/stdin"; }\n${script}\n`]);
    const argv = readFileSync(join(dir, 'argv'), 'utf8').split('\n').slice(0, -1);
    const stdin = readFileSync(join(dir, 'stdin'), 'utf8');
    process.env.STACK_HOME = dir;
    let out = '';
    try {
      const code = await run([...argv, '--dir', tmpdir()], { out: (s) => { out += s; }, err: (s) => { out += s; }, in: async () => stdin });
      return { code, out: JSON.parse(out), stdin, dir };
    } finally { delete process.env.STACK_HOME; }
  }

  // @req FR:scheduled-task-reporting/samples.run
  it.each(TASKS)('the block runs as written in bash for %s and exits 0', async (_task, agent, project, type) => {
    const body = JSON.stringify(sample(type), null, 2).replace('Draft', 'Draft $HOME `x`'); // a quoted heredoc keeps $ and backticks
    const r = await viaShell(command(agent, project, body));
    expect(r).toMatchObject({ code: 0, out: { ok: true, via: 'store', agent, project } });
    expect(r.stdin).toBe(`${body}\n`);
  });

  // @req FR:scheduled-task-reporting/step.block
  it('the unchanged placeholder is exit 2 and stores nothing', async () => {
    const r = await viaShell(command('f4-cos', 'f4', null));
    expect(r).toMatchObject({ code: 2, out: { ok: false } });
    expect(existsSync(join(r.dir, 'reports.json'))).toBe(false);
  });
});
