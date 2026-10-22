import {
  createGhClient, expandQueryTasks, findQueryTriggers, refreshQueryTasks,
  type QueryClient, type QueryItem, type QueryRequest,
} from '../../src/core/query-tasks';
import { MemoryStorage } from '../../src/core/storage';

const now = new Date('2026-09-17T21:05:00Z'); // 14:05 PDT
const opts = { now, timeZone: 'America/Los_Angeles' };

const fake = (items: QueryItem[] | Error | unknown): QueryClient & { calls: QueryRequest[] } => {
  const calls: QueryRequest[] = [];
  return {
    calls,
    search: async (r) => { calls.push(r); if (items instanceof Error) throw items; return items as QueryItem[]; },
  };
};
const pr = (n: number, title = `PR ${n}`): QueryItem => ({ title, url: `https://github.com/o/r/pull/${n}`, kind: 'PullRequest' });
const TRIG = '- [ ] Sweep 🔎 @GitHub/o/r (is:pr state:open) 🟡';

// @req FR:query-tasks/trigger.pattern
describe('findQueryTriggers', () => {
  it('parses source, identifier, type, params, indent and line', () => {
    const t = findQueryTriggers(`# P\n\n  - [x] A 🔎 @github/o/r:discussions (label:"a b" -x)\n`);
    expect(t).toEqual([{ line: 2, indent: 2, source: 'github', identifier: 'o/r', type: 'discussions', params: 'label:"a b" -x' }]);
  });
  it('ignores non-checkbox lines', () => expect(findQueryTriggers('Note 🔎 @GitHub/o/r (x)\n- plain 🔎 @GitHub/o/r (x)')).toEqual([]));
  // @req FR:query-tasks/trigger.type
  it('maps type suffixes; unknown is invalid', () => {
    const t = findQueryTriggers('- [ ] a 🔎 @GitHub/o/r:prs (x)\n- [ ] b 🔎 @GitHub/o/r:issues (x)\n- [ ] c 🔎 @GitHub/o/r (x)\n- [ ] d 🔎 @GitHub/o/r:bogus (x)');
    expect(t.map((x) => x.type)).toEqual(['issues', 'issues', 'issues', null]);
  });
});

describe('expandQueryTasks', () => {
  // @req FR:query-tasks/expand.block
  it('replaces the managed block and keeps the rest', async () => {
    const src = `# P\n\n${TRIG}\n  - [x] 🌐 old — https://x\n  - hand note\n\n- [ ] after\n`;
    const c = fake([pr(1, 'One'), pr(2, 'Two')]);
    const r = await expandQueryTasks(src, c, opts);
    expect(r.content).toBe(`# P\n\n${TRIG}\n  - [ ] 🌐 One — https://github.com/o/r/pull/1\n  - [ ] 🌐 Two — https://github.com/o/r/pull/2\n\n- [ ] after\n`);
    expect(r.processed).toBe(1);
    // @req FR:query-tasks/expand.query
    expect(c.calls).toEqual([{ repo: 'o/r', kind: 'issues', qualifiers: 'is:pr state:open' }]);
  });
  it('indents deeper than a nested trigger', async () => {
    const r = await expandQueryTasks('- [ ] A\n    - [ ] B 🔎 @GitHub/o/r (x)\n', fake([pr(1)]), opts);
    expect(r.content).toBe('- [ ] A\n    - [ ] B 🔎 @GitHub/o/r (x)\n      - [ ] 🌐 PR 1 — https://github.com/o/r/pull/1\n');
  });
  // @req FR:query-tasks/expand.kind
  it('prefixes the kind only when kinds are mixed', async () => {
    const mixed = await expandQueryTasks(`${TRIG}\n`, fake([pr(1), { title: 'I', url: 'u', kind: 'Issue' }]), opts);
    expect(mixed.content).toContain('🌐 [PullRequest] PR 1');
    expect(mixed.content).toContain('🌐 [Issue] I — u');
    const same = await expandQueryTasks(`${TRIG}\n`, fake([pr(1)]), opts);
    expect(same.content).not.toContain('[PullRequest]');
  });
  // @req FR:query-tasks/expand.none
  it('writes a dated note when nothing matches', async () => {
    const r = await expandQueryTasks(`${TRIG}\n  - [ ] 🌐 stale — u\n`, fake([]), opts);
    expect(r.content).toBe(`${TRIG}\n  > None as of Sep 17 @ 14:05\n`);
  });
  it('defaults to UTC', async () => {
    const r = await expandQueryTasks(`${TRIG}\n`, fake([]), { now });
    expect(r.content).toContain('> None as of Sep 17 @ 21:05');
  });
  it('uses discussions kind', async () => {
    const c = fake([]);
    await expandQueryTasks('- [ ] a 🔎 @GitHub/o/r:discussions (x)', c, opts);
    expect(c.calls[0].kind).toBe('discussions');
  });
  // @req FR:query-tasks/expand.order
  it('handles several triggers without shifting each other', async () => {
    const src = `${TRIG}\n  - [ ] 🌐 a — u\n  - [ ] 🌐 b — u\n- [ ] mid\n${TRIG}\n`;
    const r = await expandQueryTasks(src, fake([pr(1)]), opts);
    const row = '  - [ ] 🌐 PR 1 — https://github.com/o/r/pull/1';
    expect(r.content).toBe(`${TRIG}\n${row}\n- [ ] mid\n${TRIG}\n${row}\n`);
    expect(r.processed).toBe(2);
  });
  // @req FR:query-tasks/expand.gate
  it.each(['💤', '⛔️', '⛔', '🅿️', '⏳'])('skips a trigger gated by %s', async (e) => {
    const src = `- [ ] ${e} a 🔎 @GitHub/o/r (x)\n  - [ ] 🌐 keep — u\n`;
    const c = fake([pr(1)]);
    const r = await expandQueryTasks(src, c, opts);
    expect(r.content).toBe(src);
    expect(r.skipped).toBe(1);
    expect(c.calls).toEqual([]);
  });
  // @req FR:query-tasks/expand.eol
  it('preserves BOM and CRLF', async () => {
    const src = `﻿# P\r\n${TRIG}\r\n  - [ ] 🌐 old — u\r\n- [ ] after\r\n`;
    const r = await expandQueryTasks(src, fake([pr(1)]), opts);
    expect(r.content).toBe(`﻿# P\r\n${TRIG}\r\n  - [ ] 🌐 PR 1 — https://github.com/o/r/pull/1\r\n- [ ] after\r\n`);
  });
  it('handles a trigger on the last line without a newline', async () => {
    const r = await expandQueryTasks(TRIG, fake([pr(1)]), opts);
    expect(r.content).toBe(`${TRIG}\n  - [ ] 🌐 PR 1 — https://github.com/o/r/pull/1`);
  });
  // @req FR:query-tasks/expand.title
  it('collapses multi-line titles', async () => {
    const r = await expandQueryTasks(`${TRIG}\n`, fake([{ title: 'a\n  b\r\nc', url: 'u', kind: 'Issue' }]), opts);
    expect(r.content).toBe(`${TRIG}\n  - [ ] 🌐 a b c — u\n`);
  });
  it('returns content untouched when there are no triggers', async () => {
    const c = fake([]);
    const r = await expandQueryTasks('# P\n- [ ] a\n', c, opts);
    expect(r).toEqual({ content: '# P\n- [ ] a\n', processed: 0, skipped: 0, failures: [] });
  });
});

// @req FR:query-tasks/fail.untouched
describe('failure isolation', () => {
  const existing = `${TRIG}\n  - [ ] 🌐 keep me — u\n`;
  it.each([
    ['client throws', new Error('boom')],
    ['non-array', { nodes: [] }],
    ['null', null],
    ['item without url', [{ title: 'x', kind: 'Issue' }]],
    ['item without title', [{ url: 'u', kind: 'Issue' }]],
    ['null item', [null]],
  ])('%s leaves the list untouched', async (_n, out) => {
    const r = await expandQueryTasks(existing, fake(out), opts);
    expect(r.content).toBe(existing);
    expect(r.processed).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ line: 0, source: 'GitHub', identifier: 'o/r' });
  });
  it('rejects unknown sources and bad types', async () => {
    const src = '- [ ] a 🔎 @Jira/x (y)\n  - [ ] 🌐 k — u\n- [ ] b 🔎 @GitHub/o/r:bogus (y)\n  - [ ] 🌐 k — u\n';
    const c = fake([pr(1)]);
    const r = await expandQueryTasks(src, c, opts);
    expect(r.content).toBe(src);
    expect(r.failures).toHaveLength(2);
    expect(c.calls).toEqual([]);
  });
  it('is case-insensitive on the source', async () => {
    const r = await expandQueryTasks('- [ ] a 🔎 @GITHUB/o/r (x)\n', fake([pr(1)]), opts);
    expect(r.processed).toBe(1);
  });
  // @req FR:query-tasks/fail.independent
  it('does not let one failure affect others', async () => {
    let n = 0;
    const client: QueryClient = { search: async () => { if (n++ === 0) throw new Error('x'); return [pr(9)]; } };
    const src = `${TRIG}\n  - [ ] 🌐 keep — u\n${TRIG}\n  - [ ] 🌐 old — u\n`;
    const r = await expandQueryTasks(src, client, opts);
    // Triggers run bottom-up: the last one fails first.
    expect(r.content).toBe(`${TRIG}\n  - [ ] 🌐 PR 9 — https://github.com/o/r/pull/9\n${TRIG}\n  - [ ] 🌐 old — u\n`);
    expect(r.failures).toHaveLength(1);
    expect(r.processed).toBe(1);
  });
  // @req FR:query-tasks/fail.nodata-loss
  it('never changes content on failure, for any failing client', async () => {
    const src = `# P\r\n${TRIG}\r\n  - [ ] 🌐 a — u\r\n  note\r\n- [ ] z`;
    for (const out of [new Error('e'), 5, 'str', [{}], undefined]) {
      expect((await expandQueryTasks(src, fake(out), opts)).content).toBe(src);
    }
  });
});

describe('refreshQueryTasks', () => {
  // @req FR:query-tasks/refresh.write
  it('writes only changed markdown files with the read version', async () => {
    const st = new MemoryStorage();
    await st.write('tasks/a.md', `${TRIG}\n`);
    await st.write('tasks/b.md', '# none\n');
    const write = jest.spyOn(st, 'write');
    const r = await refreshQueryTasks(st, fake([pr(1)]), opts);
    expect(r.files).toEqual(['tasks/a.md']);
    expect(r.processed).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await st.read('tasks/a.md')).content).toContain('🌐 PR 1');
  });
  it('does not write when results are unchanged', async () => {
    const st = new MemoryStorage();
    await st.write('tasks/a.md', `${TRIG}\n  - [ ] 🌐 PR 1 — https://github.com/o/r/pull/1\n`);
    const write = jest.spyOn(st, 'write');
    const r = await refreshQueryTasks(st, fake([pr(1)]), opts);
    expect(r.files).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });
  it('leaves files alone when the query fails', async () => {
    const st = new MemoryStorage();
    await st.write('tasks/a.md', `${TRIG}\n  - [ ] 🌐 keep — u\n`);
    const write = jest.spyOn(st, 'write');
    const r = await refreshQueryTasks(st, fake(new Error('net')), opts);
    expect(write).not.toHaveBeenCalled();
    expect(r.failures).toEqual([expect.objectContaining({ path: 'tasks/a.md', message: 'net' })]);
  });
  // @req FR:query-tasks/refresh.conflict
  it('records a conflict and continues with other files', async () => {
    const st = new MemoryStorage();
    await st.write('tasks/a.md', `${TRIG}\n`);
    await st.write('tasks/b.md', `${TRIG}\n`);
    const real = st.write.bind(st);
    jest.spyOn(st, 'write').mockImplementation(async (p, c, o) => {
      if (p === 'tasks/a.md') await real('tasks/a.md', 'changed under us\n');
      return real(p, c, o);
    });
    const r = await refreshQueryTasks(st, fake([pr(1)]), opts);
    expect(r.files).toEqual(['tasks/b.md']);
    expect(r.failures).toEqual([expect.objectContaining({ path: 'tasks/a.md' })]);
    expect((await st.read('tasks/a.md')).content).toBe('changed under us\n');
  });
});

// @req FR:query-tasks/github.graphql
describe('createGhClient', () => {
  const ok = (nodes: unknown[]) => JSON.stringify({ data: { search: { nodes } } });
  const mk = (stdout: string, code = 0) => {
    const calls: { file: string; args: string[] }[] = [];
    const exec = async (file: string, args: string[]) => { calls.push({ file, args }); return { code, stdout, stderr: code ? 'bad auth' : '' }; };
    return { calls, client: createGhClient(exec) };
  };
  it('passes query and variables as separate args', async () => {
    const { calls, client } = mk(ok([{ __typename: 'PullRequest', title: 'T', url: 'U' }]));
    const items = await client.search({ repo: 'o/r', kind: 'issues', qualifiers: 'is:pr "x y"' });
    expect(items).toEqual([{ title: 'T', url: 'U', kind: 'PullRequest' }]);
    const { file, args } = calls[0];
    expect(file).toBe('gh');
    expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
    expect(args).toContain('searchQuery=repo:o/r is:pr "x y"');
    expect(args).toContain('searchType=ISSUE');
    const q = args.find((a) => a.startsWith('query='))!;
    expect(q).not.toContain('o/r');
  });
  it('uses DISCUSSION and trims empty qualifiers', async () => {
    const { calls, client } = mk(ok([]));
    await client.search({ repo: 'o/r', kind: 'discussions', qualifiers: '' });
    expect(calls[0].args).toContain('searchQuery=repo:o/r');
    expect(calls[0].args).toContain('searchType=DISCUSSION');
  });
  it('drops empty-object nodes', async () => {
    const { client } = mk(ok([{}, { __typename: 'Issue', title: 'T', url: 'U' }]));
    expect(await client.search({ repo: 'o/r', kind: 'issues', qualifiers: '' })).toHaveLength(1);
  });
  it.each([
    ['nonzero exit', '', 1],
    ['bad json', 'not json', 0],
    ['no search', '{"data":{}}', 0],
    ['errors', '{"errors":[{"message":"x"}],"data":null}', 0],
    ['malformed node', ok([{ __typename: 'Issue', title: 5, url: 'U' }]), 0],
  ])('throws on %s', async (_n, out, code) => {
    const { client } = mk(out, code);
    await expect(client.search({ repo: 'o/r', kind: 'issues', qualifiers: '' })).rejects.toThrow();
  });
  it('throws when exec throws (gh missing)', async () => {
    const client = createGhClient(async () => { throw new Error('ENOENT'); });
    await expect(client.search({ repo: 'o/r', kind: 'issues', qualifiers: '' })).rejects.toThrow(/gh/);
  });
});
