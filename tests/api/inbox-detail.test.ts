import { createApiHandler, ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { INBOX_PATH, type InboxItem, type MailReader } from '../../src/inbox';

const item = (o: Partial<InboxItem> = {}): InboxItem => ({ id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Ann', subject: 'Quarterly plan', receivedAt: '2026-10-28T09:00:00Z', unread: true, urgency: 1, summary: 'Ann asks if the budget is final.', suggested: 'reply-draft', actions: ['reply-draft'], messageId: 'AAMk1', kind: 'needs_reply', ...o });
const READ = { message: { id: 'AAMk1', from: { name: 'Ann', address: 'ann@x.test' }, to: [{ address: 'me@example.test' }], subject: 'Quarterly plan', receivedAt: '2026-10-28T09:00:00Z', body: 'Is the budget final?', mine: false }, thread: [] };

async function mk(reader?: (account: string) => Promise<MailReader | undefined>, authorize: () => boolean = () => true) {
  const storage = new MemoryStorage();
  await storage.writeAux(INBOX_PATH, JSON.stringify([item(), item({ id: 'chat-cccccccccccc', source: 'teams', account: 'work', messageId: undefined })]), { expectedVersion: null });
  const writes: string[] = [];
  const w = storage.writeAux.bind(storage); storage.writeAux = (async (p: string, ...a: unknown[]) => { writes.push(p); return (w as (...x: unknown[]) => unknown)(p, ...a); }) as typeof storage.writeAux;
  const sw = storage.write.bind(storage); storage.write = (async (p: string, ...a: unknown[]) => { writes.push(p); return (sw as (...x: unknown[]) => unknown)(p, ...a); }) as typeof storage.write;
  const h = createApiHandler({ storage, authorize, ...(reader ? { mailReader: reader } : {}) });
  const OWNER = { "x-ms-client-principal": Buffer.from(JSON.stringify({ userDetails: "me", identityProvider: "github", userRoles: ["authenticated"] })).toString("base64") };
  const get = async (id: string, headers: Record<string, string> = OWNER) => { const res = await h(new Request(`https://x.test/api/inbox-items/${id}/detail`, { headers })); const t = await res.text(); return { status: res.status, json: t ? JSON.parse(t) : undefined }; };
  return { get, writes };
}

// @req FR:inbox-page/detail.api
describe('GET /inbox-items/{id}/detail', () => {
  it('is registered as a read route', () => {
    expect(ROUTES.some((r) => r.name === 'inboxItems.detail' && r.method === 'GET')).toBe(true);
    expect(routeScope('inboxItems.detail')).toBe('tasks:read');
  });

  // @req FR:inbox-page/detail.private
  it('returns the item, the message and the thread, and writes nothing', async () => {
    const asked: string[] = [];
    const { get, writes } = await mk(async (account) => { asked.push(account); return { thread: async (id) => { asked.push(id); return READ; } }; });
    const r = await get('mail-aaaaaaaaaaaa');
    expect(r.status).toBe(200);
    expect(asked).toEqual(['me@example.test', 'AAMk1']);
    expect(r.json).toEqual({ item: expect.objectContaining({ id: 'mail-aaaaaaaaaaaa', account: 'me@example.test' }), live: true, ...READ });
    expect(writes).toEqual([]);
  });

  // @req FR:inbox-page/detail.offline.cause
  it('answers live: false when the mailbox cannot be read, with no error text', async () => {
    for (const reader of [undefined, async () => undefined, async () => ({ thread: async () => { throw new Error('secret token text'); } })] as const) {
      const r = await (await mk(reader as never)).get('mail-aaaaaaaaaaaa');
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ item: expect.objectContaining({ id: 'mail-aaaaaaaaaaaa' }), live: false });
      expect(JSON.stringify(r.json)).not.toContain('secret');
    }
    const chat = await (await mk(async () => ({ thread: async () => READ }))).get('chat-cccccccccccc');
    expect(chat.json.live).toBe(false);
  });

  // @req FR:inbox-page/detail.api.missing
  it('answers 404 for an unknown item', async () => {
    expect((await (await mk()).get('mail-000000000000')).status).toBe(404);
  });

  // @req FR:inbox-page/detail.api.owner
  it('answers 403 to a token', async () => {
    const { get } = await mk(async () => ({ thread: async () => READ }));
    expect((await get('mail-aaaaaaaaaaaa', { authorization: 'Bearer stk_0123456789abcdef.secret' })).status).toBe(403);
  });
});
