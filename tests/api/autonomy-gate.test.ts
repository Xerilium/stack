import { createApiHandler } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-22T18:00:00Z');
// 0-based lines
const DOC = `# Alpha

## 🔄 Active

- [ ] Plain task
- [ ] Triage task 🤖:triage
- [ ] Assist task 🤖:assist
  - [ ] 🪄 Agent child
  - [ ] 🙋 Human child
- [ ] Full task 🤖:full
  - [ ] 🙋 Review child
- [ ] Full two 🤖:full
- [ ] Human only 🤖:full
  - [ ] 🙋 Human row inherits full
- [ ] Held task 🤖:full ⛔️
- [ ] Secret-ish row 🤖:triage
`;
const L = { plain: 4, triage: 5, assist: 6, agentChild: 7, humanChild: 8, full: 9, fullHuman: 10, fullTwo: 11, humanOnly: 12, humanRow: 13, held: 14, odd: 15 };
const PRINCIPAL = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64');

async function mk() {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', DOC);
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const h = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const open = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 't', scopes: scopes as never })).token;
  const send = async (handler: (r: Request) => Promise<Response>, headers: Record<string, string>, path: string, body: unknown) => {
    const res = await handler(new Request(`https://x.test/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : undefined };
  };
  const agent = async (path: string, body: unknown, token?: string) => send(h, { authorization: `Bearer ${token ?? await mint('tasks:write')}` }, path, body);
  const owner = (path: string, body: unknown) => send(open, { 'x-ms-client-principal': PRINCIPAL }, path, body);
  const text = async () => (await storage.read('tasks/alpha.md')).content;
  return { storage, agent, owner, text, mint };
}
const r = (line: number) => `alpha:${line}`;

// @req FR:ai-triage-assist/autonomy.mutations
describe('agent token mutations obey the autonomy gate', () => {
  it('start needs assist, and never a human or held row', async () => {
    const { agent, text } = await mk();
    for (const line of [L.plain, L.triage, L.humanChild, L.held]) {
      const res = await agent('/tasks/start', { ref: r(line) });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('forbidden');
    }
    expect(await text()).toBe(DOC);
    expect((await agent('/tasks/start', { ref: r(L.assist) })).status).toBe(200);
    expect(await text()).toContain('🚧');
  });

  it('complete is denied when autonomy is unset or too low', async () => {
    const { agent, text } = await mk();
    for (const line of [L.plain, L.triage, L.assist, L.humanChild, L.humanOnly]) {
      expect((await agent('/tasks/complete', { ref: r(line) })).status).toBe(403);
    }
    expect(await text()).toBe(DOC);
  });

  it('complete: assist completes only a leading-🪄 subtask, full completes a task', async () => {
    const { agent, text } = await mk();
    expect((await agent('/tasks/complete', { ref: r(L.agentChild), summary: 'done' })).status).toBe(200);
    expect((await agent('/tasks/complete', { ref: r(L.fullTwo) })).status).toBe(200);
    const t = await text();
    expect(t).toContain('- [x] 🪄 Agent child');
    expect(t).toContain('- [x] Full two');
    expect(t).toContain('- [ ] Assist task');
  });

  it('complete with an open 🙋 child or a held row is refused', async () => {
    const { agent, text } = await mk();
    const a = await agent('/tasks/complete', { ref: r(L.full) });
    expect(a.status).toBe(409);
    expect(a.json.error.code).toBe('conflict');
    expect((await agent('/tasks/complete', { ref: r(L.held) })).status).toBe(403);
    expect(await text()).toBe(DOC);
  });

  it('a token must name the row (no implicit target)', async () => {
    const { agent, text } = await mk();
    for (const p of ['/tasks/start', '/tasks/complete']) expect((await agent(p, {})).status).toBe(422);
    expect(await text()).toBe(DOC);
  });

  it('skip, resume, suspend change hold marks and are owner-only', async () => {
    const { agent, text } = await mk();
    for (const [p, body] of [['/tasks/skip', { ref: r(L.full) }], ['/tasks/resume', { ref: r(L.full) }], ['/tasks/suspend', { ref: r(L.full), days: 1 }], ['/tasks/skip', {}]] as const) {
      expect((await agent(p, body)).status).toBe(403);
    }
    expect(await text()).toBe(DOC);
  });

  it('set: props need triage, status needs assist, checkbox needs the complete level, never clears gate marks', async () => {
    const { agent, text } = await mk();
    expect((await agent('/tasks/set', { ref: r(L.plain), priority: '🔺' })).status).toBe(403);
    expect((await agent('/tasks/set', { ref: r(L.triage), status: '🚧' })).status).toBe(403);
    expect((await agent('/tasks/set', { ref: r(L.assist), checkbox: 'Complete' })).status).toBe(403);
    expect((await agent('/tasks/set', { ref: r(L.fullTwo), clearEmojis: true })).status).toBe(403);
    expect((await agent('/tasks/set', { ref: r(L.fullTwo), status: '⛔️' })).status).toBe(403);
    expect((await agent('/tasks/set', { ref: r(L.fullTwo), suspend: 'Dec 1' })).status).toBe(403);
    expect(await text()).toBe(DOC);
    expect((await agent('/tasks/set', { ref: r(L.triage), priority: '🔺' })).status).toBe(200);
    expect((await agent('/tasks/set', { ref: r(L.assist), status: '🚧' })).status).toBe(200);
    expect((await agent('/tasks/set', { ref: r(L.fullTwo), checkbox: 'Complete' })).status).toBe(200);
    const t = await text();
    expect(t).toContain('🔺 Triage task');
    expect(t).toContain('- [x] Full two');
  });

  it('remove-completed is owner-only', async () => {
    const { agent, owner, storage } = await mk();
    expect((await agent('/tasks/remove-completed', {})).status).toBe(403);
    expect((await owner('/tasks/remove-completed', {})).status).toBe(200);
    expect((await storage.read('tasks/alpha.md')).content).toBeTruthy();
  });

  it('errors are fixed text and never echo task lines', async () => {
    const { agent } = await mk();
    for (const [p, line] of [['/tasks/complete', L.odd], ['/tasks/start', L.odd], ['/tasks/set', L.odd]] as const) {
      const res = await agent(p, { ref: r(line), ...(p === '/tasks/set' ? { checkbox: 'Complete' } : {}) });
      expect(res.status).toBe(403);
      expect(res.text).not.toMatch(/Secret-ish|🤖|alpha/);
    }
  });

  it('a read-only token is still refused before the gate', async () => {
    const { agent, mint } = await mk();
    expect((await agent('/tasks/complete', { ref: r(L.fullTwo) }, await mint('tasks:read'))).status).toBe(403);
  });
});

// @req FR:ai-triage-assist/autonomy.owner
describe('owner session is unaffected', () => {
  it('completes, starts, parks, and sets without autonomy', async () => {
    const { owner, text } = await mk();
    expect((await owner('/tasks/start', { ref: r(L.plain) })).status).toBe(200);
    expect((await owner('/tasks/set', { ref: r(L.plain), priority: '🔺', clearEmojis: false })).status).toBe(200);
    expect((await owner('/tasks/skip', { ref: r(L.triage) })).status).toBe(200);
    expect((await owner('/tasks/complete', { ref: r(L.plain) })).status).toBe(200);
    expect(await text()).toContain('- [x]');
  });
});

// @req FR:ai-triage-assist/result.cap
describe('the result log cannot be filled to block agents', () => {
  it('claim and record-result keep working after 5 full log files', async () => {
    const { agent, storage, mint } = await mk();
    const big = (n: number) => `# Alpha agent log\n\n## old-${n}\n`.padEnd(300 * 1024, 'y');
    await storage.write('tasks/logs/alpha.md', big(1));
    for (let i = 2; i <= 5; i++) await storage.write(`tasks/logs/alpha.${i}.md`, big(i));
    const t = await mint('tasks:write');
    expect((await agent('/tasks/claim', { ref: r(L.assist) }, t)).status).toBe(200);
    const res = await agent('/tasks/result', { ref: r(L.assist), outcome: 'partial', summary: 'still going' }, t);
    expect(res.status).toBe(200);
    const all = await Promise.all(['alpha', 'alpha.2', 'alpha.3', 'alpha.4', 'alpha.5'].map(async (n) => (await storage.read(`tasks/logs/${n}.md`)).content));
    expect(all.join('')).toContain('still going');
    expect(all.join('')).toContain('claimed');
    expect(all.join('')).not.toContain('old-1');
    expect(all.join('')).toContain('old-5');
  });
});
