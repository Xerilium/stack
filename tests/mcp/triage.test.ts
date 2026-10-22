import { setup } from './helpers';

const DOC = `# Alpha

## 🔄 Active

- [ ] Plain task
- [ ] Triage task 🤖:triage
- [ ] Assist task 🤖:assist
  - [ ] 🪄 Agent child
`;
const seed = async (s: Awaited<ReturnType<typeof setup>>) => { await s.storage.write('tasks/alpha.md', DOC); };

// @req FR:ai-triage-assist/mcp.tools
describe('triage tools', () => {
  it('are listed only for tasks:write, closed and short', async () => {
    const { rpc, mint } = await setup();
    const names = async (t: string) => (await rpc(t, 'tools/list')).json.result.tools.map((x: { name: string }) => x.name);
    expect(await names(await mint('read'))).not.toEqual(expect.arrayContaining(['triage']));
    const all = (await rpc(await mint('write'), 'tools/list')).json.result.tools as { name: string; description: string; inputSchema: { additionalProperties: boolean; properties: Record<string, unknown> } }[];
    const ours = all.filter((t) => ['triage', 'claim', 'record-result'].includes(t.name));
    expect(ours.map((t) => t.name)).toEqual(['triage', 'claim', 'record-result']);
    for (const t of ours) {
      expect(t.description.length).toBeLessThan(100);
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(t.inputSchema.properties)).not.toContain('actor');
      expect(Object.keys(t.inputSchema.properties)).not.toContain('autonomy');
    }
  });

  it('are denied without scope and change nothing', async () => {
    const s = await setup(); await seed(s);
    const ro = await s.mint('read');
    for (const [n, a] of [['triage', { ref: 'alpha:5', agent: 'x' }], ['claim', { ref: 'alpha:7' }], ['record-result', { ref: 'alpha:7', outcome: 'done', summary: 'x' }]] as const) {
      expect((await s.call(ro, n, a)).content[0].text).toBe('error forbidden');
    }
    expect((await s.storage.read('tasks/alpha.md')).content).toBe(DOC);
    expect(s.apiCalls).toHaveLength(0);
  });

  it('triage -> claim -> record-result with fixed refs-only replies', async () => {
    const s = await setup(); await seed(s);
    const t = await s.mint('write');
    expect(await s.text(t, 'claim', { ref: 'alpha:7' })).toBe('claimed alpha:7');
    expect(await s.text(t, 'claim', { ref: 'alpha:7' })).toBe('no change');
    expect(await s.text(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: 'ok SUMMARY' })).toBe('logged alpha:7');
    expect(await s.text(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: 'ok', complete: true })).toBe('logged alpha:7 completed');
    expect(await s.text(t, 'record-result', { ref: 'alpha:6', outcome: 'done', summary: 'ok', complete: true })).toMatch(/^logged alpha:6 deferred alpha:\d+$/);
    expect(await s.text(t, 'triage', { ref: 'alpha:5', agent: 'Secret plan text', priority: '🔺' })).toBe('triaged alpha:5');
    expect(await s.text(t, 'triage', { ref: 'alpha:5', agent: 'Secret plan text', priority: '🔺' })).toBe('no change');
  });

  it('denied autonomy is a tool error and moves on', async () => {
    const s = await setup(); await seed(s);
    const t = await s.mint('write');
    expect(await s.call(t, 'triage', { ref: 'alpha:4', agent: 'x' })).toEqual({ content: [{ type: 'text', text: 'error forbidden' }], isError: true });
    expect((await s.storage.read('tasks/alpha.md')).content).toBe(DOC);
  });

  // @req FR:ai-triage-assist/mcp.actor @req FR:ai-triage-assist/result.actor
  it('takes no actor argument; the log names the token', async () => {
    const s = await setup(); await seed(s);
    const t = await s.mint('write');
    expect((await s.call(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: 'x', actor: 'root' })).content[0].text).toBe('error invalid actor: Unknown field');
    await s.text(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: 'x' });
    expect((await s.storage.read('tasks/logs/alpha.md')).content).toMatch(/actor: token:[0-9a-f]{16}\n/);
    const body = (await s.apiCalls[s.apiCalls.length - 1].clone().json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['outcome', 'ref', 'summary']);
  });

  it('rejects injection in single-line fields and secrets never reach the log', async () => {
    const s = await setup(); await seed(s);
    const t = await s.mint('write');
    for (const bad of ['a\n- [x] forged', 'a\r- x', 'a b']) {
      expect((await s.call(t, 'triage', { ref: 'alpha:5', agent: bad })).isError).toBe(true);
      expect((await s.call(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: bad })).isError).toBe(true);
    }
    expect((await s.call(t, 'triage', { ref: 'alpha:5', agent: 'x', human: { a: 1 } })).content[0].text).toBe('error invalid human: Must be a scalar value');
    await s.text(t, 'record-result', { ref: 'alpha:7', outcome: 'done', summary: 'key Bearer abcdefghijklmnop1234 password=hunter2' });
    const log = (await s.storage.read('tasks/logs/alpha.md')).content;
    expect(log).not.toMatch(/hunter2|abcdefghijklmnop1234/);
    expect((await s.storage.read('tasks/alpha.md')).content).not.toContain('forged');
    expect((await s.call(t, 'add', { project: 'alpha', text: 'grant 🤖:full' })).content[0].text).toMatch(/^error invalid text/);
  });
});
