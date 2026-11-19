import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api';
import { putAsk, readAsk } from '../../src/core/asks';
import { MemoryStorage } from '../../src/core/storage';
import { draftsPath, putDraft, readDrafts } from '../../src/email/draft-store';
import { createReplyBoxes } from '../../src/inbox/reply-box';
import { accountCachePath, FileTokenCache } from '../../src/graph/auth';
import { INBOX_PATH, type InboxItem, type ReplyBox } from '../../src/inbox';

const ID = 'mail-aaaaaaaaaaaa';
const item = (o: Partial<InboxItem> = {}): InboxItem => ({ id: ID, source: 'email', account: 'me@example.test', from: 'Ann', subject: 'Quarterly plan', receivedAt: '2026-10-28T09:00:00Z', unread: true, urgency: 1, summary: 'Ann asks if the budget is final.', suggested: 'reply-draft', actions: ['reply-draft'], messageId: 'AAMk1', kind: 'needs_reply', ...o });
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64'), 'content-type': 'application/json' };
const TOKEN = { authorization: 'Bearer stk_0123456789abcdef.secret', 'content-type': 'application/json' };

function fakeBox(o: { canSend?: boolean; fail?: boolean } = {}) {
  const drafts = new Map<string, { messageId: string; text: string; at: string; link?: string }>([[ID, { messageId: 'AAMk1', text: 'Yes, the budget is final.', at: 'x', link: 'https://outlook.example.test/d/1' }]]);
  const sent: [string, string][] = [];
  const box: ReplyBox = {
    canSend: o.canSend ?? true, get: (id) => drafts.get(id), save: (id, messageId, text) => { drafts.set(id, { messageId, text, at: 'y' }); }, remove: (id) => { drafts.delete(id); },
    send: async (messageId, text) => { if (o.fail) throw new Error('graph 503 secret'); sent.push([messageId, text]); },
  };
  return { box, drafts, sent };
}
async function mk(replies?: (account: string) => Promise<ReplyBox | undefined>) {
  const storage = new MemoryStorage();
  await storage.writeAux(INBOX_PATH, JSON.stringify([item(), item({ id: 'chat-cccccccccccc', source: 'teams', messageId: undefined })]), { expectedVersion: null });
  await putAsk({ storage }, ID, { kind: 'review', ask: 'Review draft reply to Ann: Quarterly plan', from: 'email-triage' }, 'email-triage');
  const h = createApiHandler({ storage, authorize: () => true, ...(replies ? { replies } : {}) });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = OWNER) => { const res = await h(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })); const t = await res.text(); return { status: res.status, json: t ? JSON.parse(t) : undefined }; };
  return { call, storage };
}

// @req FR:email-send/draft.api @req FR:email-send/draft.api.detail @req FR:email-send/draft.api.owner
describe('reply draft routes', () => {
  it('are registered as write routes', () => {
    for (const n of ['inboxItems.draft', 'inboxItems.send', 'connect.send']) { expect(ROUTES.some((r) => r.name === n && r.method === 'POST')).toBe(true); expect(routeScope(n)).toBe('tasks:write'); }
  });
  it('the detail carries the stored draft and whether Send is on', async () => {
    const f = fakeBox({ canSend: false });
    const { call } = await mk(async () => f.box);
    expect((await call('GET', `/inbox-items/${ID}/detail`)).json.draft).toEqual({ text: 'Yes, the budget is final.', canSend: false, link: 'https://outlook.example.test/d/1' });
    expect((await call('GET', '/inbox-items/chat-cccccccccccc/detail')).json.draft).toBeUndefined();
    expect((await (await mk()).call('GET', `/inbox-items/${ID}/detail`)).json.draft).toBeUndefined();
  });
  it('stores the owner\'s edit and sends nothing', async () => {
    const f = fakeBox();
    const { call } = await mk(async () => f.box);
    expect((await call('POST', `/inbox-items/${ID}/draft`, { text: 'Yes. Final.' })).json).toEqual({ ok: true });
    expect(f.drafts.get(ID)).toMatchObject({ messageId: 'AAMk1', text: 'Yes. Final.' });
    expect(f.sent).toEqual([]);
    expect((await call('POST', `/inbox-items/${ID}/draft`, { text: 'x' }, TOKEN)).status).toBe(403);
    expect((await (await mk()).call('POST', `/inbox-items/${ID}/draft`, { text: 'x' })).status).toBe(409);
  });
});

// @req FR:email-send/send.api @req FR:email-send/send.done
describe('POST /inbox-items/{id}/send', () => {
  it('sends the clicked text to the item\'s message, then removes the draft and the item and resolves the ask', async () => {
    const f = fakeBox();
    const { call, storage } = await mk(async () => f.box);
    expect((await call('POST', `/inbox-items/${ID}/send`, { text: 'Yes. Final.' })).json).toEqual({ ok: true });
    expect(f.sent).toEqual([['AAMk1', 'Yes. Final.']]);
    expect(f.drafts.has(ID)).toBe(false);
    expect((await call('GET', '/inbox-items')).json.items.map((i: InboxItem) => i.id)).toEqual(['chat-cccccccccccc']);
    expect((await readAsk({ storage }, ID))!.ask.state).toBe('done');
    // The item is gone: a second click cannot send again.
    expect((await call('POST', `/inbox-items/${ID}/send`, { text: 'Yes. Final.' })).status).toBe(404);
    expect(f.sent).toHaveLength(1);
  });
  // @req FR:email-send/send.done.fail
  it('a failed send keeps the draft, the item and the ask, and leaks no error text', async () => {
    const f = fakeBox({ fail: true });
    const { call, storage } = await mk(async () => f.box);
    const r = await call('POST', `/inbox-items/${ID}/send`, { text: 'Yes.' });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain('secret');
    expect(f.drafts.has(ID)).toBe(true);
    expect((await call('GET', '/inbox-items')).json.items).toHaveLength(2);
    expect((await readAsk({ storage }, ID))!.ask.state).toBe('open');
  });
  // @req FR:email-send/send.api.off @req FR:email-send/send.optin @req FR:email-send/send.demo
  it('answers 409 when Send is off, the mailbox is not connected here, or the item is a chat', async () => {
    const off = fakeBox({ canSend: false });
    expect((await (await mk(async () => off.box)).call('POST', `/inbox-items/${ID}/send`, { text: 'Yes.' })).status).toBe(409);
    expect(off.sent).toEqual([]);
    expect((await (await mk()).call('POST', `/inbox-items/${ID}/send`, { text: 'Yes.' })).status).toBe(409);
    const on = fakeBox();
    expect((await (await mk(async () => on.box)).call('POST', '/inbox-items/chat-cccccccccccc/send', { text: 'Yes.' })).status).toBe(409);
    expect(on.sent).toEqual([]);
  });
  // @req FR:email-send/send.api.owner @req FR:email-send/send.text.empty
  it('refuses a token and an empty text', async () => {
    const f = fakeBox();
    const { call } = await mk(async () => f.box);
    expect((await call('POST', `/inbox-items/${ID}/send`, { text: 'Yes.' }, TOKEN)).status).toBe(403);
    expect((await call('POST', `/inbox-items/${ID}/send`, { text: '   ' })).status).toBe(422);
    expect((await call('POST', `/inbox-items/${ID}/send`, {})).status).toBe(422);
    expect(f.sent).toEqual([]);
  });
});

// @req FR:email-send/send.optin @req FR:email-send/send.api.off @req FR:email-send/send.approve
describe('createReplyBoxes', () => {
  const tok = { version: 1 as const, tenant: 'organizations', clientId: '11111111-1111-1111-1111-111111111111', refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600_000 };
  async function boxes(scopes: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'reply-')); const dataDir = mkdtempSync(join(tmpdir(), 'reply-data-'));
    await new FileTokenCache(accountCachePath('me@example.test', dir)).write({ ...tok, scopes, account: 'me@example.test' });
    const calls: { method: string; url: string; body: string }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ method: init?.method ?? 'GET', url: String(url), body: String(init?.body ?? '') }); return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }); }) as typeof globalThis.fetch;
    return { box: await createReplyBoxes({ dir, dataDir, fetch })('me@example.test'), calls, dataDir, none: await createReplyBoxes({ dir, dataDir, fetch })('other@example.test') };
  }
  it('Send is off unless the account cache holds the send scope; a send then is refused before any request', async () => {
    const { box, calls, none } = await boxes(['Mail.ReadWrite', 'offline_access']);
    expect(none).toBeUndefined();
    expect(box!.canSend).toBe(false);
    await expect(box!.send('AAMk1', 'Yes.')).rejects.toThrow('Send is off');
    expect(calls).toEqual([]);
  });
  it('with Send on, one click makes one reply request with the comment only; drafts live in the local file', async () => {
    const { box, calls, dataDir } = await boxes(['Mail.Read', 'Mail.Send', 'offline_access']);
    expect(box!.canSend).toBe(true);
    putDraft(draftsPath('me@example.test', dataDir), ID, { messageId: 'AAMk1', text: 'Draft', at: 'x' });
    expect(box!.get(ID)?.text).toBe('Draft');
    box!.save(ID, 'AAMk1', 'My edit');
    expect(readDrafts(draftsPath('me@example.test', dataDir))[ID].text).toBe('My edit');
    await box!.send('AAMk1', 'My edit');
    expect(calls).toEqual([{ method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/messages/AAMk1/reply', body: JSON.stringify({ comment: 'My edit' }) }]);
    box!.remove(ID);
    expect(box!.get(ID)).toBeUndefined();
  });
});
