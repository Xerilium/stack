/**
 * Docs drift, the other direction from deploy.test.ts: per-command flags, and no doc entry the code lacks.
 * `asks` is left to its own drift test (docs/asks.md, FR:deploy-docs/docs.asks).
 * @req FR:deploy-docs/docs.drift
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TOOLS } from '../../src/mcp/tools';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const commands = () => [...read('src/cli/run.ts').matchAll(/^ {2}'?([a-z-]+)'?: \{ flags: \[([^\]]*)\]/gm)].map((m) => ({ name: m[1], flags: [...m[2].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]) }));
const bullet = (doc: string, cmd: string) => doc.split('\n').find((l) => l.startsWith(`- \`${cmd}\`:`));

describe('docs/cli.md', () => {
  // @req FR:deploy-docs/docs.drift.flags
  it("lists each command's flags on that command's own line", () => {
    const doc = read('docs/cli.md');
    const missing: string[] = [];
    for (const c of commands()) {
      if (c.name === 'asks') continue;
      const line = bullet(doc, c.name);
      if (!line) { missing.push(c.name); continue; }
      for (const f of c.flags) if (!line.includes(`--${f}`)) missing.push(`${c.name} --${f}`);
    }
    expect(missing).toEqual([]);
  });

  // @req FR:deploy-docs/docs.drift.stale
  it('documents no command the CLI lacks', () => {
    const names = new Set(commands().map((c) => c.name));
    const listed = [...read('docs/cli.md').matchAll(/^- `([a-z-]+)`:/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.filter((n) => !names.has(n))).toEqual([]);
  });
});

describe('docs/mcp.md', () => {
  // @req FR:deploy-docs/docs.drift.stale
  it('documents no MCP tool the server lacks', () => {
    const rows = [...read('docs/mcp.md').matchAll(/^\| `([a-z_-]+)` \| `(?:GET|POST|PUT|PATCH|DELETE) /gm)].map((m) => m[1]);
    expect(rows.length).toBe(TOOLS.length);
    expect(rows.filter((r) => !TOOLS.some((t) => t.name === r))).toEqual([]);
  });
});

describe('docs/acp.md', () => {
  // @req FR:deploy-docs/docs.drift.acp
  it('states the default timeout and the cancel grace the command uses', () => {
    const src = read('src/cli/agent.ts');
    const timeout = Number(/const DEFAULT_TIMEOUT_S = (\d+);/.exec(src)?.[1]);
    const grace = Number(/const GRACE_MS = (\d+);/.exec(src)?.[1]) / 1000;
    const doc = read('docs/acp.md');
    expect(doc).toContain(`\`--timeout s\` (default ${timeout})`);
    expect(doc).toContain(`does not stop in ${grace} s`);
    expect(read('docs/cli.md')).toContain(`(default ${timeout} s;`);
  });
  // @req FR:deploy-docs/docs.drift.acp
  it('documents only flags `stack agent` accepts', () => {
    const agent = commands().find((c) => c.name === 'agent')!;
    const doc = read('docs/acp.md').split('## Troubleshoot')[0];
    const used = [...doc.matchAll(/stack agent run[^\n`]*/g)].flatMap((m) => [...m[0].split(' -- ')[0].matchAll(/--([a-z-]+)/g)].map((x) => x[1]));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((f) => !agent.flags.includes(f))).toEqual([]);
  });
});
