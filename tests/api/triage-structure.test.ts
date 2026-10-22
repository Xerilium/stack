/** @req FR:ai-triage-assist/autonomy.structure */
import { setup } from '../security/helpers';

const DOC = `# Alpha

- [ ] Auto parent 🤖:full
  - [ ] kid a
- [ ] Other parent
  - [ ] 🙋 Decide prod deploy
  - [ ] Sensitive child
- [ ] Hold ⛔️ a
- [ ] Park 💤 b
- [ ] Pin 🅿️ c
- [ ] Plain typo teh
`;

async function boot() {
  const s = setup();
  await s.storage.write('tasks/alpha.md', DOC, { expectedVersion: null, message: 'seed' });
  return { s };
}
const lineOf = (text: string) => DOC.split('\n').findIndex((l) => l.includes(text));
const ref = (text: string) => `alpha:${lineOf(text)}`;

describe('owner-only structure', () => {
  async function token() {
    const { s } = await boot();
    const c = await s.call('POST', '/api/auth/tokens', { session: true, body: { name: 'agent', scopes: ['tasks:write'], days: 30 } });
    const secret: string = c.json.token;
    return { s, h: { authorization: `Bearer ${secret}` } };
  }

  it('token move is forbidden (escalation repro)', async () => {
    const { s, h } = await token();
    const r = await s.call('POST', '/api/tasks/move', { headers: h, body: { ref: ref('Sensitive child'), target: ref('kid a'), position: 'after' } });
    expect(r.status).toBe(403);
    expect((await s.storage.read('tasks/alpha.md')).content).toBe(DOC);
  });

  it.each(['Decide prod deploy', 'Hold', 'Park', 'Pin'])('token edit stripping a gate mark is forbidden: %s', async (k) => {
    const { s, h } = await token();
    const r = await s.call('POST', '/api/tasks/edit', { headers: h, body: { ref: ref(k), text: 'cleaned' } });
    expect(r.status).toBe(403);
  });

  it('token edit keeping markers works', async () => {
    const { s, h } = await token();
    const r = await s.call('POST', '/api/tasks/edit', { headers: h, body: { ref: ref('teh'), text: 'Plain typo the' } });
    expect(r.status).toBe(200);
    const r2 = await s.call('POST', '/api/tasks/edit', { headers: h, body: { ref: ref('Decide prod'), text: '🙋 Decide prod deployment' } });
    expect(r2.status).toBe(200);
  });

  it('owner session can move and edit', async () => {
    const { s } = await boot();
    const m = await s.call('POST', '/api/tasks/move', { session: true, body: { ref: ref('Sensitive child'), target: ref('kid a'), position: 'after' } });
    expect(m.status).toBe(200);
    const e = await s.call('POST', '/api/tasks/edit', { session: true, body: { ref: ref('Hold'), text: 'Hold released' } });
    expect(e.status).toBe(200);
  });
});
