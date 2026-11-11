/**
 * Test files must wait on an event, a promise, or a fake clock, never on a fixed sleep or a wall-clock poll.
 * KNOWN lists the files that still do; it may only shrink. Fix a file, then remove it here.
 * @req FR:test-reliability/wait.event
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'fixtures') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** A sleep on its own line (nothing waits on an event), a sleep helper, or a loop that reads the wall clock to give up. */
const RULES: [string, RegExp][] = [
  ['sleep', /^\s*await new Promise\(\(?\w+\)? => setTimeout\(\w+, \d+\)\);?\s*$/m],
  ['sleep helper', /^const (wait|sleep) = .*new Promise\(\(?\w+\)? => setTimeout\(/m],
  ['wall-clock poll', /Date\.now\(\) - \w+ > /],
];

/** Burn-down list: file -> rules it still breaks. See .xe/features/test-reliability/coverage-review.md. */
const KNOWN: Record<string, string[]> = {
  'tests/agents/acp-asks.test.ts': ['sleep helper'],
  'tests/agents/acp.test.ts': ['sleep'],
  'tests/agents/broker.test.ts': ['sleep helper'],
  'tests/agents/runs.test.ts': ['sleep helper'],
  'tests/agents/team.test.ts': ['sleep helper', 'wall-clock poll'],
  'tests/agents/thread.test.ts': ['sleep helper', 'wall-clock poll'],
  'tests/cli/agent.test.ts': ['sleep'],
  'tests/cli/sessions-events.test.ts': ['sleep helper', 'wall-clock poll'],
  'tests/host/github-storage.test.ts': ['sleep'],
};

describe('test waits', () => {
  it('no new test sleeps or polls the wall clock, and KNOWN only shrinks', () => {
    const found: Record<string, string[]> = {};
    for (const f of [...walk(join(root, 'tests')), ...walk(join(root, 'web/e2e'))]) {
      const src = readFileSync(f, 'utf8');
      const hit = RULES.filter(([, re]) => re.test(src)).map(([n]) => n);
      if (hit.length) found[relative(root, f)] = hit;
    }
    expect(found).toEqual(KNOWN);
  });
});
