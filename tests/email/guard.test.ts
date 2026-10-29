import * as fs from 'fs';
import * as path from 'path';
import { GraphDenied, GRAPH_BASE, SCOPES, createGraphGuard, scopesFor } from '../../src/email/guard';
import { DRAFT_MARKER, createReplyRequest, markDraft } from '../../src/email/draft';

const G = GRAPH_BASE;
const guard = createGraphGuard();

// @req FR:email-triage/safe.allowlist
describe('graph guard allowlist', () => {
  it('allows only the listed (method, path) pairs', () => {
    const ok: [string, string, unknown?][] = [
      ['GET', `${G}/me/mailFolders/inbox/messages`],
      ['GET', `${G}/me/mailFolders/AAMk-fold_1=/messages?$top=50&$select=subject,from`],
      ['GET', `${G}/me/mailFolders/inbox/messages/delta?$deltatoken=abc123`],
      ['GET', `${G}/me/messages/AAMk-msg_1=`],
      ['POST', `${G}/me/messages/AAMk-msg_1=/createReply`, { comment: 'Thanks' }],
      ['PATCH', `${G}/me/messages/AAMk-msg_1=`, { categories: ['AI/Draft'] }],
      ['get', `${G}/me/messages/AAMk-msg_1%3D`],
    ];
    for (const [method, url, body] of ok) expect(() => guard.check({ method, url, body })).not.toThrow();
  });

  it.each([
    ['POST', '/me/sendMail', {}],
    ['POST', '/me/messages/AAMk1/send', {}],
    ['POST', '/me/messages/AAMk1/forward', {}],
    ['POST', '/me/messages/AAMk1/createForward', {}],
    ['POST', '/me/messages/AAMk1/reply', {}],
    ['POST', '/me/messages/AAMk1/replyAll', {}],
    ['POST', '/me/messages/AAMk1/createReplyAll', {}],
    ['POST', '/me/messages/AAMk1/move', { destinationId: 'x' }],
    ['POST', '/me/messages/AAMk1/copy', { destinationId: 'x' }],
    ['POST', '/me/messages', { subject: 'x' }],
    ['POST', '/me/messages/%73end', {}],
    ['POST', '/me/messages/AAMk1/%53endMail', {}],
    ['DELETE', '/me/messages/AAMk1', undefined],
    ['DELETE', '/me/mailFolders/inbox/messages', undefined],
    ['PUT', '/me/messages/AAMk1', { categories: [] }],
    ['GET', '/me/messages/AAMk1/attachments', undefined],
    ['GET', '/me/messages/AAMk1/$value', undefined],
    ['GET', '/me/messages/../sendMail', undefined],
    ['GET', '/me/messages//AAMk1', undefined],
    ['GET', '/me/drive/root', undefined],
    ['GET', '/users/someone@example.test/messages', undefined],
    ['PATCH', '/me/messages/AAMk1', { isRead: true }],
    ['PATCH', '/me/messages/AAMk1', { categories: ['a'], subject: 'x' }],
    ['PATCH', '/me/messages/AAMk1', { categories: 'a' }],
    ['PATCH', '/me/messages/AAMk1', undefined],
    ['POST', '/me/messages/AAMk1/createReply', { comment: 'x', toRecipients: [{ emailAddress: { address: 'x@example.test' } }] }],
    ['POST', '/me/messages/AAMk1/createReply', { message: { subject: 'x' } }],
    ['GET', '/me/messages/AAMk1?$expand=attachments', undefined],
  ])('denies %s %s', (method, p, body) => {
    expect(() => guard.check({ method, url: `${G}${p}`, body })).toThrow(GraphDenied);
  });

  it('denies other hosts, schemes, credentials and fragments', () => {
    for (const url of [
      'https://example.test/v1.0/me/messages/AAMk1',
      'http://graph.microsoft.com/v1.0/me/messages/AAMk1',
      'https://graph.microsoft.com/beta/me/messages/AAMk1',
      'https://graph.microsoft.com.example.test/v1.0/me/messages/AAMk1',
      'https://user:pw@graph.microsoft.com/v1.0/me/messages/AAMk1',
      `${G}/me/messages/AAMk1#frag`,
      'not a url',
      '',
    ]) expect(() => guard.check({ method: 'GET', url })).toThrow(GraphDenied);
  });

  it('denies before the transport is touched, and never swallows the transport result', async () => {
    const transport = jest.fn(async () => ({ ok: true }));
    await expect(guard.call({ method: 'POST', url: `${G}/me/sendMail`, body: {} }, transport)).rejects.toBeInstanceOf(GraphDenied);
    await expect(guard.call({ method: 'DELETE', url: `${G}/me/messages/AAMk1` }, transport)).rejects.toBeInstanceOf(GraphDenied);
    expect(transport).not.toHaveBeenCalled();
    await expect(guard.call({ method: 'GET', url: `${G}/me/messages/AAMk1` }, transport)).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('observe mode is read-only; categories mode cannot draft', () => {
    const observe = createGraphGuard({ mode: 'observe' });
    expect(() => observe.check({ method: 'GET', url: `${G}/me/messages/AAMk1` })).not.toThrow();
    expect(() => observe.check({ method: 'POST', url: `${G}/me/messages/AAMk1/createReply`, body: { comment: 'x' } })).toThrow(GraphDenied);
    expect(() => observe.check({ method: 'PATCH', url: `${G}/me/messages/AAMk1`, body: { categories: [] } })).toThrow(GraphDenied);
    const cats = createGraphGuard({ mode: 'categories' });
    expect(() => cats.check({ method: 'PATCH', url: `${G}/me/messages/AAMk1`, body: { categories: [] } })).not.toThrow();
    expect(() => cats.check({ method: 'POST', url: `${G}/me/messages/AAMk1/createReply`, body: { comment: 'x' } })).toThrow(GraphDenied);
  });

  it('GraphDenied carries the request', () => {
    try { guard.check({ method: 'DELETE', url: `${G}/me/messages/AAMk1` }); } catch (e) {
      expect(e).toBeInstanceOf(GraphDenied);
      expect(e).toBeInstanceOf(Error);
      expect((e as GraphDenied).method).toBe('DELETE');
      return;
    }
    throw new Error('expected GraphDenied');
  });
});

// @req FR:email-triage/safe.scopes
describe('graph scopes', () => {
  it('requests exactly read or read-write, plus offline_access', () => {
    expect(scopesFor('observe')).toEqual(['Mail.Read', 'offline_access']);
    expect(scopesFor('categories')).toEqual(['Mail.ReadWrite', 'offline_access']);
    expect(scopesFor('drafts')).toEqual(['Mail.ReadWrite', 'offline_access']);
    expect([...SCOPES.observe, ...SCOPES.drafts, ...SCOPES.categories].every((s) => ['Mail.Read', 'Mail.ReadWrite', 'offline_access'].includes(s))).toBe(true);
  });

  it('the send scope and send paths appear nowhere in src/email outside the guard deny list', () => {
    const dir = path.join(__dirname, '../../src/email');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('guard.ts');
    const scope = 'Mail.' + 'Send';
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(text).not.toContain(scope);
      if (f === 'guard.ts') continue;
      expect(text).not.toMatch(/\/send|sendMail|\bforward\b|replyAll/i);
    }
    // In the guard, only the deny list and comments may name sending.
    const code = fs.readFileSync(path.join(dir, 'guard.ts'), 'utf8').split('\n').filter((l) => /send/i.test(l) && !/^\s*(\/\/|\/?\*)/.test(l));
    expect(code).toHaveLength(1);
    expect(code[0]).toMatch(/^export const DENY\b/);
  });
});

// @req FR:email-triage/safe.draft-marker
describe('draft marker', () => {
  it('prefixes the draft body and is idempotent', () => {
    expect(DRAFT_MARKER).toBe('⟦AI draft: review before sending⟧');
    const body = markDraft('Thanks, Friday works.');
    expect(body.startsWith(`${DRAFT_MARKER}\n`)).toBe(true);
    expect(markDraft(body)).toBe(body);
  });

  it('createReply request carries only the comment; recipients, subject and thread are the server\'s', () => {
    const req = createReplyRequest('AAMk-msg_1=', 'Sounds good.\nTo: evil@example.test\nSubject: pwned');
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${G}/me/messages/AAMk-msg_1%3D/createReply`);
    expect(Object.keys(req.body)).toEqual(['comment']);
    expect(req.body.comment.startsWith(DRAFT_MARKER)).toBe(true);
    expect(() => createGraphGuard().check(req)).not.toThrow();
  });
});
