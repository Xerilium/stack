import { readThread } from '../../src/email/graph-mail';
import { createGraphGuard, type GraphRequest } from '../../src/email/guard';

const who = (name: string, address: string) => ({ emailAddress: { name, address } });
const MAIN = {
  id: 'AAMk1', conversationId: "c-1'x", subject: 'Quarterly plan', from: who('Ann', 'ann@x.test'), toRecipients: [who('Me', 'me@example.test')], ccRecipients: [who('Bo', 'bo@x.test')],
  receivedDateTime: '2026-10-28T09:00:00Z', body: { contentType: 'html', content: '<style>p{}</style><p>Hi <b>Mike</b>,</p><p>Is the budget final?</p><script>alert(1)</script>' },
};
const part = (id: string, at: string, from: ReturnType<typeof who>, text: string) => ({ id, subject: 'Re: Quarterly plan', from, toRecipients: [], receivedDateTime: at, uniqueBody: { contentType: 'text', content: text } });

function fake(over: Partial<Record<string, unknown>> = {}) {
  const seen: GraphRequest[] = [];
  const transport = async (req: GraphRequest) => {
    seen.push(req);
    const u = new URL(req.url);
    if (u.pathname === '/v1.0/me/messages/AAMk1') return MAIN;
    const folder = /mailFolders\/([a-z]+)\/messages$/.exec(u.pathname)?.[1] ?? '';
    if (folder in over) { const v = over[folder]; if (v instanceof Error) throw v; return v; }
    if (folder === 'inbox') return { value: [MAIN, part('AAMk0', '2026-10-27T08:00:00Z', who('Ann', 'ann@x.test'), 'First note')] };
    if (folder === 'sentitems') return { value: [part('AAMk9', '2026-10-27T10:00:00Z', who('Me', 'ME@example.test'), 'My answer')] };
    return { value: [] };
  };
  return { seen, transport };
}

// @req FR:inbox-page/detail.read @req FR:inbox-page/detail.read.thread @req FR:inbox-page/detail.body @req FR:inbox-page/detail.safe
describe('readThread', () => {
  it('reads the message and its thread with guarded GET requests only', async () => {
    const { seen, transport } = fake();
    const r = await readThread({ transport, account: 'me@example.test' }, 'AAMk1');
    const guard = createGraphGuard({ mode: 'observe' });
    for (const q of seen) { expect(q.method).toBe('GET'); expect(q.body).toBeUndefined(); expect(() => guard.check(q)).not.toThrow(); }
    expect(seen.map((q) => new URL(q.url).pathname)).toEqual(['/v1.0/me/messages/AAMk1', '/v1.0/me/mailFolders/inbox/messages', '/v1.0/me/mailFolders/sentitems/messages', '/v1.0/me/mailFolders/archive/messages']);
    const f = new URL(seen[1].url).searchParams;
    expect(f.get('$filter')).toBe("conversationId eq 'c-1''x'"); // a quote in the id is doubled
    expect(f.get('$top')).toBe('25');
    expect(r.message).toEqual({ id: 'AAMk1', from: { name: 'Ann', address: 'ann@x.test' }, to: [{ name: 'Me', address: 'me@example.test' }, { name: 'Bo', address: 'bo@x.test' }], subject: 'Quarterly plan', receivedAt: '2026-10-28T09:00:00Z', body: 'Hi Mike,\nIs the budget final?', mine: false });
  });

  // @req FR:inbox-page/detail.thread @req FR:inbox-page/detail.thread.mine
  it('lists the other messages newest first and marks the owner\'s own', async () => {
    const r = await readThread({ transport: fake().transport, account: 'me@example.test' }, 'AAMk1');
    expect(r.thread.map((m) => [m.id, m.mine, m.body])).toEqual([['AAMk9', true, 'My answer'], ['AAMk0', false, 'First note']]);
  });

  // @req FR:inbox-page/detail.read.partial
  it('keeps the message when a thread read fails', async () => {
    const r = await readThread({ transport: fake({ inbox: new Error('InefficientFilter'), sentitems: { nope: 1 } }).transport, account: 'me@example.test' }, 'AAMk1');
    expect(r.message.id).toBe('AAMk1');
    expect(r.thread).toEqual([]);
  });

  it('refuses a message id the guard does not accept, before any request', async () => {
    const { seen, transport } = fake();
    await expect(readThread({ transport, account: 'me@example.test' }, 'a/../sendMail')).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
