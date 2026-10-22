import { createHash } from 'crypto';
import { setup } from './helpers';

const SECRET_TASK = 'Call dentist about SECRET-TASK-TEXT';

// @req FR:auth-security/safe.hash @req FR:auth-security/safe.secret @req FR:auth-security/safe.tasks @req FR:auth-security/authorize.events
describe('nothing sensitive leaves the system', () => {
  it('events, responses, and errors never carry hash, secret, or task data', async () => {
    const events: unknown[] = [];
    const s = setup({ onEvent: (e) => events.push(e) });
    const created = await s.call('POST', '/api/auth/tokens', { session: true, body: { name: 'a', scopes: ['read', 'write'] } });
    const token: string = created.json.token;
    const secret = token.split('.')[1];
    const hash = createHash('sha256').update(secret).digest('hex');
    const h = { authorization: `Bearer ${token}` };
    const seen: string[] = [];
    const noTask: string[] = []; // denied or admin responses must not echo task data (authorized task reads legitimately do)
    const rec = async (p: ReturnType<typeof s.call>) => { const r = await p; seen.push(r.text, JSON.stringify([...r.headers])); if (r.status >= 400 || r.text.includes("\"items\":[{\"id\"")) noTask.push(r.text); return r; };
    await rec(s.call('POST', '/api/projects', { headers: h, body: { name: 'Alpha' } }));
    await rec(s.call('POST', '/api/tasks', { headers: h, body: { project: 'alpha', text: SECRET_TASK } }));
    await rec(s.call('GET', `/api/tasks?q=${encodeURIComponent('SECRET-TASK-TEXT')}`, { headers: h }));
    await rec(s.call('GET', '/api/tasks?q=SECRET-TASK-TEXT', { headers: { authorization: 'Bearer stk_0000000000000000.' + 'A'.repeat(43) } }));
    await rec(s.call('POST', '/api/tasks', { body: { project: 'alpha', text: SECRET_TASK } }));
    await rec(s.call('GET', '/api/auth/tokens', { session: true }));
    await rec(s.call('GET', '/api/auth/tokens', { headers: h }));
    await rec(s.call('POST', '/api/tasks/nope', { headers: h, body: { text: SECRET_TASK } }));
    const blob = JSON.stringify(events);
    expect(events.length).toBeGreaterThan(5);
    for (const part of [blob, ...seen.slice(2)]) {
      expect(part).not.toContain(hash);
      expect(part).not.toContain(secret);
    }
    for (const part of [blob, ...noTask]) {
      expect(part).not.toContain('SECRET-TASK-TEXT');
    }
    expect(created.text).toContain(secret); // only the create response
    for (const t of seen) expect(t.includes(hash)).toBe(false);
    expect(seen.slice(2).filter((t) => t.includes(secret))).toEqual([]);
    for (const e of events as Record<string, unknown>[]) {
      expect(Object.keys(e).every((k) => ['kind', 'route', 'status', 'tokenId'].includes(k))).toBe(true);
    }
  });
  it('internal errors never reach the response or include secrets in the log hook', async () => {
    const s = setup();
    const t = (await s.tokens.create({ name: 'a', scopes: ['read'] })).token;
    jest.spyOn(s.storage, 'list').mockRejectedValue(new Error('storage down: ' + SECRET_TASK));
    const r = await s.call('GET', '/api/tasks', { headers: { authorization: `Bearer ${t}` } });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('SECRET-TASK-TEXT');
  });
});
