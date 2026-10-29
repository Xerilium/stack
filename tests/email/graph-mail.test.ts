import { createGraphMail } from '../../src/email/graph-mail';
import { DRAFT_MARKER } from '../../src/email/draft';
import { GraphDenied, type GraphRequest } from '../../src/email/guard';

const G = 'https://graph.microsoft.com/v1.0';
const msg = (id: string, o: Record<string, unknown> = {}) => ({
  id, conversationId: `c-${id}`, subject: `Hi ${id}`, from: { emailAddress: { name: 'Ann', address: 'ann@x.test' } }, receivedDateTime: '2026-10-28T09:00:00Z',
  bodyPreview: 'Can you look?', webLink: 'https://outlook.office.com/m/1', '@odata.type': '#microsoft.graph.message', ...o,
});

// @req FR:day-inputs/mail.graph
describe('Graph mail adapter: delta', () => {
  it('reads the folder delta, follows pages, skips removed items, returns the delta link', async () => {
    const seen: GraphRequest[] = [];
    const transport = async (req: GraphRequest) => {
      seen.push(req);
      if (seen.length === 1) return { value: [msg('1'), { id: 'gone', '@removed': { reason: 'deleted' } }], '@odata.nextLink': `${G}/me/mailFolders/inbox/messages/delta?$skiptoken=p2` };
      return { value: [msg('2', { '@odata.type': '#microsoft.graph.eventMessageRequest' })], '@odata.deltaLink': `${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d1` };
    };
    const mail = createGraphMail({ transport });
    const r = await mail.delta();
    expect(new URL(seen[0].url).pathname).toBe('/v1.0/me/mailFolders/inbox/messages/delta');
    expect(new URL(seen[0].url).searchParams.get('$select')).toContain('bodyPreview');
    expect(r.cursor).toBe(`${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d1`);
    expect(r.messages).toEqual([
      { id: '1', conversationId: 'c-1', subject: 'Hi 1', from: { name: 'Ann', address: 'ann@x.test' }, receivedAt: '2026-10-28T09:00:00Z', bodyPreview: 'Can you look?', webLink: 'https://outlook.office.com/m/1', odataType: '#microsoft.graph.message' },
      expect.objectContaining({ id: '2', odataType: '#microsoft.graph.eventMessageRequest' }),
    ]);
  });
  it('uses a saved delta link as the first request', async () => {
    const seen: GraphRequest[] = [];
    const mail = createGraphMail({ transport: async (r) => { seen.push(r); return { value: [], '@odata.deltaLink': `${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d2` }; } });
    await mail.delta(`${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d1`);
    expect(seen[0].url).toBe(`${G}/me/mailFolders/inbox/messages/delta?$deltatoken=d1`);
  });
  it('refuses a page that is not a list and an unguarded next link', async () => {
    await expect(createGraphMail({ transport: async () => ({}) }).delta()).rejects.toThrow();
    await expect(createGraphMail({ transport: async () => ({ value: [], '@odata.nextLink': `${G}/me/sendMail` }) }).delta()).rejects.toThrow(GraphDenied);
  });
});

// @req FR:day-inputs/mail.cursor
describe('Graph mail adapter: cursor', () => {
  it('refuses a cursor that is not a delta link for the folder, before any request', async () => {
    let calls = 0;
    const mail = createGraphMail({ transport: async () => { calls++; return { value: [] }; } });
    for (const bad of ['x', `${G}/me/mailFolders/archive/messages/delta?$deltatoken=1`, 'https://evil.test/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=1', `${G}/me/messages`]) {
      await expect(mail.delta(bad)).rejects.toThrow('Invalid mail cursor');
    }
    expect(calls).toBe(0);
  });
});

// @req FR:day-inputs/mail.draft
describe('Graph mail adapter: draft', () => {
  it('creates a reply draft with the marked comment only and returns its link', async () => {
    const seen: GraphRequest[] = [];
    const mail = createGraphMail({ transport: async (r) => { seen.push(r); return { id: 'draft-1', webLink: 'https://outlook.office.com/d/1' }; } });
    expect(await mail.createDraft('m-1', 'Sounds good')).toEqual({ id: 'draft-1', webLink: 'https://outlook.office.com/d/1' });
    expect(seen).toEqual([{ method: 'POST', url: `${G}/me/messages/m-1/createReply`, body: { comment: `${DRAFT_MARKER}\nSounds good` } }]);
  });
  it('has no send, forward, or delete method', () => {
    const mail = createGraphMail({ transport: async () => ({}) }) as unknown as Record<string, unknown>;
    expect(Object.keys(mail).sort()).toEqual(['createDraft', 'delta']);
  });
});
