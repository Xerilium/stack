import { junkMailbox } from '../../src/inbox/junk-mailbox';
import type { GraphRequest } from '../../src/email/guard';

const G = 'https://graph.microsoft.com/v1.0';
const headers = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const NEWS = { from: { emailAddress: { address: 'news@list.example.com' } }, internetMessageHeaders: headers({ 'Authentication-Results': 'mx.test; dkim=pass header.d=example.com', 'List-Unsubscribe': '<https://u.example.com/x?id=1>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }) };

function fake(get: Record<string, unknown> = {}, failMove: Record<string, number> = {}) {
  const seen: GraphRequest[] = [];
  const posts: { url: string; body: string }[] = [];
  const transport = async (req: GraphRequest) => {
    seen.push(req);
    const id = /\/me\/messages\/([^/?]+)/.exec(req.url)?.[1] ?? '';
    if (req.method === 'POST' && failMove[id]) throw Object.assign(new Error('x'), { status: failMove[id] });
    return req.method === 'GET' ? get[id] ?? {} : {};
  };
  const http = { post: async (url: string, body: string) => { posts.push({ url, body }); return { status: 200 }; } };
  return { seen, posts, box: junkMailbox({ transport, http }) };
}

// @req FR:inbox-page/junk.archive.ids @req FR:inbox-page/junk.never
describe('junkMailbox.archive', () => {
  it('moves the given ids to Archive, one guarded POST each', async () => {
    const f = fake();
    expect(await f.box.archive(['AAMk1', 'AAMk2'])).toEqual(['AAMk1', 'AAMk2']);
    expect(f.seen.map((r) => [r.method, r.url, r.body])).toEqual([['POST', `${G}/me/messages/AAMk1/move`, { destinationId: 'archive' }], ['POST', `${G}/me/messages/AAMk2/move`, { destinationId: 'archive' }]]);
  });
  it('counts a 404 as moved and leaves out another failure', async () => {
    const f = fake({}, { AAMk1: 404, AAMk2: 500 });
    expect(await f.box.archive(['AAMk1', 'AAMk2', 'AAMk3'])).toEqual(['AAMk1', 'AAMk3']);
  });
  it('never sends a DELETE and never targets another folder', async () => {
    const f = fake();
    await f.box.archive(['AAMk1']);
    await f.box.unsubscribe('AAMk1');
    expect(f.seen.some((r) => r.method === 'DELETE')).toBe(false);
    expect(f.seen.filter((r) => r.method === 'POST').every((r) => (r.body as { destinationId: string }).destinationId === 'archive')).toBe(true);
  });
  it('skips an id the guard would refuse', async () => {
    const f = fake();
    expect(await f.box.archive(['a/../b'])).toEqual([]);
    expect(f.seen).toEqual([]);
  });
});

// @req FR:inbox-page/junk.unsubscribe @req FR:inbox-page/junk.unsubscribe.other
describe('junkMailbox.unsubscribe', () => {
  it('posts the one-click unsubscribe to the sender\'s own signed target', async () => {
    const f = fake({ AAMk1: NEWS });
    expect(await f.box.unsubscribe('AAMk1')).toBe(true);
    expect(f.seen.map((r) => r.method)).toEqual(['GET']);
    expect(f.posts).toEqual([{ url: 'https://u.example.com/x?id=1', body: 'List-Unsubscribe=One-Click' }]);
  });
  it('does nothing for a link, a mailto, an unsigned sender or a failed read', async () => {
    const link = { ...NEWS, internetMessageHeaders: headers({ 'List-Unsubscribe': '<https://u.example.com/x>' }) };
    const unsigned = { ...NEWS, internetMessageHeaders: NEWS.internetMessageHeaders.filter((h) => h.name !== 'Authentication-Results') };
    const f = fake({ AAMk1: link, AAMk2: unsigned, AAMk3: { internetMessageHeaders: headers({ 'List-Unsubscribe': '<mailto:u@example.com>' }) } });
    for (const id of ['AAMk1', 'AAMk2', 'AAMk3', 'AAMk4', 'bad/id']) expect(await f.box.unsubscribe(id)).toBe(false);
    expect(f.posts).toEqual([]);
  });
  it('a failed post is not an unsubscribe', async () => {
    const seen: GraphRequest[] = [];
    const box = junkMailbox({ transport: async (r) => { seen.push(r); return NEWS; }, http: { post: async () => ({ status: 500 }) } });
    expect(await box.unsubscribe('AAMk1')).toBe(false);
  });
});
