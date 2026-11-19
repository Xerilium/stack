import { createApiHandler, ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { INBOX_PATH, type InboxItem, type JunkMailbox } from '../../src/inbox';

const item = (o: Partial<InboxItem> = {}): InboxItem => ({ id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Weekly Digest', subject: 'Ten things', receivedAt: '2026-10-28T09:00:00Z', unread: true, urgency: 0, summary: 'Newsletter.', suggested: 'unsubscribe', actions: ['not-junk'], messageId: 'AAMk1', kind: 'newsletter', ...o });
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64'), 'content-type': 'application/json' };

async function mk(junkMailbox?: (account: string) => Promise<JunkMailbox | undefined>) {
  const storage = new MemoryStorage();
  await storage.writeAux(INBOX_PATH, JSON.stringify([item(), item({ id: 'mail-bbbbbbbbbbbb', messageId: 'AAMk2', kind: 'needs_reply' })]), { expectedVersion: null });
  const h = createApiHandler({ storage, authorize: () => true, ...(junkMailbox ? { junkMailbox } : {}) });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = OWNER) => { const res = await h(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })); const t = await res.text(); return { status: res.status, json: t ? JSON.parse(t) : undefined }; };
  return { call };
}

// @req FR:inbox-page/junk.api
describe('POST /inbox-junk', () => {
  it('is registered as a write route', () => {
    expect(ROUTES.some((r) => r.name === 'inboxJunk.clear' && r.method === 'POST')).toBe(true);
    expect(routeScope('inboxJunk.clear')).toBe('tasks:write');
  });
  it('archives the junk and answers the counts', async () => {
    const log: string[] = [];
    const { call } = await mk(async () => ({ archive: async (ids) => { log.push(`archive ${ids.join(',')}`); return ids; }, unsubscribe: async (id) => { log.push(`unsubscribe ${id}`); return true; } }));
    expect((await call('POST', '/inbox-junk', { action: 'unsubscribe-archive' })).json).toEqual({ archived: 1, unsubscribed: 1, kept: 0 });
    expect(log).toEqual(['unsubscribe AAMk1', 'archive AAMk1']);
    expect((await call('GET', '/inbox-items')).json.items.map((i: InboxItem) => i.id)).toEqual(['mail-bbbbbbbbbbbb']);
  });
  // @req FR:inbox-page/junk.archive.readonly
  it('keeps everything on a host that cannot write to the mailbox', async () => {
    const { call } = await mk();
    expect((await call('POST', '/inbox-junk', { action: 'archive' })).json).toEqual({ archived: 0, unsubscribed: 0, kept: 1 });
  });
  // @req FR:inbox-page/junk.never.auto
  it('a read of the inbox never touches the mailbox', async () => {
    let calls = 0;
    const { call } = await mk(async () => { calls++; return undefined; });
    await call('GET', '/inbox-items');
    expect(calls).toBe(0);
  });
  // @req FR:inbox-page/junk.api.owner
  it('refuses a token and an unknown action', async () => {
    const { call } = await mk();
    expect((await call('POST', '/inbox-junk', { action: 'archive' }, { authorization: 'Bearer stk_0123456789abcdef.secret', 'content-type': 'application/json' })).status).toBe(403);
    expect((await call('POST', '/inbox-junk', { action: 'delete' })).status).toBe(422);
  });
  // @req FR:inbox-page/junk.restore
  it('not-junk runs through the action route', async () => {
    const { call } = await mk();
    expect((await call('POST', '/inbox-items/mail-aaaaaaaaaaaa/action', { action: 'not-junk' })).json).toEqual({ ok: true });
    expect((await call('GET', '/inbox-items')).json.items.find((i: InboxItem) => i.id === 'mail-aaaaaaaaaaaa').notJunk).toBe(true);
  });
});
