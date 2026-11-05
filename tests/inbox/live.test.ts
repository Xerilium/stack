import { ChatDenied, slackConnector, teamsConnector, type HttpGet } from '../../src/inbox';

const OWNER = 'owner-id';
const chats = (n: number, next?: string) => ({
  value: [{ id: `19:c${n}@thread.v2`, chatType: 'oneOnOne', webUrl: 'https://teams.example.test/c', viewpoint: { isHidden: false, lastMessageReadDateTime: '2026-10-28T10:00:00Z' },
    lastMessagePreview: { createdDateTime: '2026-10-28T12:00:00Z', messageType: 'message', body: { content: `<p>Hi ${n}</p>` }, from: { user: { id: 'u2', displayName: 'Sam' } } } }],
  ...(next ? { '@odata.nextLink': next } : {}),
});
const fake = (routes: (url: string) => unknown) => { const calls: { url: string; headers: Record<string, string> }[] = []; const http: HttpGet = async (url, headers) => { calls.push({ url, headers }); return { status: 200, json: routes(url) }; }; return { http, calls }; };

// @req FR:inbox-page/live.teams @req FR:inbox-page/live.http
describe('teamsConnector', () => {
  it('reads chats with a bearer token and follows nextLink', async () => {
    const f = fake((u) => (u.includes('page2') ? chats(2) : chats(1, 'https://graph.microsoft.com/v1.0/me/chats?page2=1')));
    const items = await teamsConnector({ token: async () => 'tok', ownerId: OWNER, http: f.http }).unread();
    expect(items.map((i) => i.summary)).toEqual(['Hi 1', 'Hi 2']);
    expect(f.calls[0].url).toContain('https://graph.microsoft.com/v1.0/me/chats?');
    expect(f.calls[0].url).toContain('lastMessagePreview');
    expect(f.calls.every((c) => c.headers.Authorization === 'Bearer tok')).toBe(true);
  });
  it('refuses a nextLink to another host or path before any call', async () => {
    const f = fake(() => chats(1, 'https://evil.example.test/v1.0/me/chats'));
    await expect(teamsConnector({ token: async () => 't', ownerId: OWNER, http: f.http }).unread()).rejects.toBeInstanceOf(ChatDenied);
    expect(f.calls).toHaveLength(1);
    const g = fake(() => chats(1, 'https://graph.microsoft.com/v1.0/chats/1/messages'));
    await expect(teamsConnector({ token: async () => 't', ownerId: OWNER, http: g.http }).unread()).rejects.toBeInstanceOf(ChatDenied);
  });
  it('stops at 5 pages', async () => {
    const f = fake(() => chats(1, 'https://graph.microsoft.com/v1.0/me/chats?more=1'));
    await teamsConnector({ token: async () => 't', ownerId: OWNER, http: f.http }).unread();
    expect(f.calls).toHaveLength(5);
  });
  it('error names the status only', async () => {
    const http: HttpGet = async () => ({ status: 403, json: { error: { message: 'secret detail' } } });
    const e = await teamsConnector({ token: async () => 'tok', ownerId: OWNER, http }).unread().catch((x: Error) => x);
    expect((e as Error).message).toBe('Teams request failed: HTTP 403');
  });
});

// @req FR:inbox-page/live.slack @req FR:inbox-page/live.http
describe('slackConnector', () => {
  const route = (url: string) => {
    const u = new URL(url);
    const m = u.pathname.replace('/api/', '');
    if (m === 'users.conversations') return { ok: true, channels: [{ id: 'D1', is_im: true, user: 'U2' }, { id: 'C1', name: 'general' }, { id: 'C2', name: 'quiet' }], response_metadata: { next_cursor: '' } };
    if (m === 'conversations.info') return { ok: true, channel: { id: u.searchParams.get('channel'), last_read: '1000.000100' } };
    if (m === 'conversations.history') {
      const ch = u.searchParams.get('channel');
      if (ch === 'C2') return { ok: true, messages: [{ user: OWNER, text: 'mine', ts: '1002.0' }] };
      return { ok: true, messages: [{ user: 'U2', text: 'ping now', ts: '1001.5' }, { user: 'U3', text: 'join', ts: '1001.6', subtype: 'channel_join' }] };
    }
    return { ok: false, error: 'unknown_method' };
  };
  it('maps unread conversations using last_read as oldest', async () => {
    const f = fake(route);
    const items = await slackConnector({ token: 'xoxp-fake', ownerId: OWNER, http: f.http }).unread();
    expect(items.map((i) => [i.kind, i.summary]).sort()).toEqual([['channel', 'ping now'], ['im', 'ping now']]);
    const hist = f.calls.filter((c) => c.url.includes('conversations.history'));
    expect(hist.every((c) => new URL(c.url).searchParams.get('oldest') === '1000.000100')).toBe(true);
    expect(f.calls.every((c) => c.headers.Authorization === 'Bearer xoxp-fake')).toBe(true);
    expect(f.calls.every((c) => new URL(c.url).origin === 'https://slack.com')).toBe(true);
  });
  it('error carries the Slack code, never the token', async () => {
    const http: HttpGet = async () => ({ status: 200, json: { ok: false, error: 'invalid_auth' } });
    const e = (await slackConnector({ token: 'xoxp-fake', ownerId: OWNER, http }).unread().catch((x: Error) => x)) as Error;
    expect(e.message).toBe('Slack request failed: invalid_auth');
    expect(e.message).not.toContain('xoxp');
  });
  it('caps conversations at 100', async () => {
    const f = fake((u) => (u.includes('users.conversations') ? { ok: true, channels: Array.from({ length: 150 }, (_, i) => ({ id: `C${i}`, name: `n${i}` })) } : u.includes('info') ? { ok: true, channel: { last_read: '1' } } : { ok: true, messages: [] }));
    await slackConnector({ token: 't', ownerId: OWNER, http: f.http }).unread();
    expect(f.calls.filter((c) => c.url.includes('conversations.info'))).toHaveLength(100);
  });
});
