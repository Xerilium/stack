import { asksPath, parseAsk, putAsk } from '../../src/core/asks';
import { ACTIONS, fromTriage, orderItems, requestAction, runAction } from '../../src/inbox';
import type { InboxItem } from '../../src/inbox';
import { chatToAsk, slackUnread, teamsUnread, createChatGuard, ChatDenied } from '../../src/inbox';
import { mailKey } from '../../src/email/to-ask';
import type { TriageResult } from '../../src/email/types';
import { mkCtx, msg } from '../email/fixtures';

const res = (over: Partial<TriageResult> = {}): TriageResult => ({ message: msg(), class: 'needs_reply', confidence: 0.9, urgency: 2, summary: 'Alex wants a review by Friday.', ...over });

// @req FR:inbox-page/item.email
describe('email to item', () => {
  it('maps every class to one suggested action', () => {
    const want: Record<string, string> = { needs_reply: 'reply-draft', needs_decision: 'ask-me-later', sensitive: 'ask-me-later', newsletter: 'unsubscribe', calendar: 'schedule', receipt: 'mark-done', fyi: 'mark-done', skip: 'mark-done', spam: 'mark-done' };
    for (const [c, a] of Object.entries(want)) expect(fromTriage(res({ class: c as TriageResult['class'] }), 'me@example.test').suggested).toBe(a);
  });
  it('keeps quiet classes and falls back from summary to reason to preview', () => {
    expect(fromTriage(res({ class: 'receipt', summary: undefined, reason: 'A receipt' }), 'a').summary).toBe('A receipt');
    expect(fromTriage(res({ summary: undefined, reason: undefined }), 'a').summary).toBe('Can you review the plan by Friday?');
  });
  it('has shape fields', () => {
    expect(fromTriage(res(), 'me@example.test')).toMatchObject({ source: 'email', account: 'me@example.test', from: 'Alex Rivera', subject: 'Quarterly plan', id: mailKey('conv-1'), unread: true });
  });
});

// @req FR:inbox-page/item.order
describe('order', () => {
  it('unread, then urgency, then newest', () => {
    const mk = (id: string, unread: boolean, urgency: number, at: string) => ({ id, unread, urgency, receivedAt: at }) as InboxItem;
    const out = orderItems([mk('a', false, 3, '2026-01-02'), mk('b', true, 0, '2026-01-01'), mk('c', true, 2, '2026-01-01'), mk('d', true, 2, '2026-01-03')]);
    expect(out.map((i) => i.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

// @req FR:inbox-page/action.catalog @req FR:inbox-page/action.missing
describe('catalog', () => {
  it('lists ready and missing actions', () => {
    expect(ACTIONS.filter((a) => a.ready).map((a) => a.id).sort()).toEqual(['ask-me-later', 'create-task', 'mark-done', 'reply-draft', 'snooze']);
    expect(ACTIONS.filter((a) => !a.ready).map((a) => a.id).sort()).toEqual(['archive', 'delegate', 'forward-draft', 'schedule', 'unsubscribe']);
  });
  it('a missing action runs nothing', async () => {
    const { ctx } = mkCtx();
    const mail = { createDraft: jest.fn() };
    const r = await runAction(fromTriage(res(), 'a'), { action: 'unsubscribe' }, { ctx, mail });
    expect(r).toEqual({ ok: false, missing: true });
    expect(mail.createDraft).not.toHaveBeenCalled();
  });
});

// @req FR:inbox-page/action.reply
describe('reply-draft', () => {
  it('creates a draft with the edited text and never sends', async () => {
    const { ctx } = mkCtx();
    const mail = { createDraft: jest.fn(async () => ({ id: 'D1', webLink: 'https://outlook.example.test/D1' })) };
    const item = { ...fromTriage(res(), 'a'), messageId: 'AAMk-msg-1' };
    const r = await runAction(item, { action: 'reply-draft', text: 'Looks good.' }, { ctx, mail });
    expect(mail.createDraft).toHaveBeenCalledWith('AAMk-msg-1', 'Looks good.');
    expect(r).toEqual({ ok: true, link: 'https://outlook.example.test/D1' });
    expect(Object.keys(mail)).toEqual(['createDraft']);
  });
  it('refuses empty text and non-email items', async () => {
    const { ctx } = mkCtx();
    const mail = { createDraft: jest.fn() };
    const item = { ...fromTriage(res(), 'a'), messageId: 'm' };
    await expect(runAction(item, { action: 'reply-draft', text: ' ' }, { ctx, mail })).rejects.toThrow(/text/);
    await expect(runAction({ ...item, source: 'slack' }, { action: 'reply-draft', text: 'x' }, { ctx, mail })).rejects.toThrow(/email/);
  });
});

// @req FR:inbox-page/action.done
describe('ask actions', () => {
  const open = async (ctx: ReturnType<typeof mkCtx>['ctx']) => { await putAsk(ctx, mailKey('conv-1'), { kind: 'go-do', ask: 'Reply to Alex', from: 'email-triage' }, 'email-triage'); };
  it('mark-done resolves the ask', async () => {
    const { storage, ctx } = mkCtx(); await open(ctx);
    expect(await runAction(fromTriage(res(), 'a'), { action: 'mark-done' }, { ctx })).toEqual({ ok: true });
    expect(parseAsk(mailKey('conv-1'), (await storage.read(asksPath(mailKey('conv-1')))).content).state).toBe('done');
  });
  it('snooze defers and ask-me-later defaults to next morning', async () => {
    const { storage, ctx } = mkCtx(); await open(ctx);
    await runAction(fromTriage(res(), 'a'), { action: 'snooze', until: '2026-11-01' }, { ctx });
    const a = parseAsk(mailKey('conv-1'), (await storage.read(asksPath(mailKey('conv-1')))).content);
    expect(a.snoozed).toContain('2026-11-01');
    await expect(runAction(fromTriage(res(), 'a'), { action: 'snooze' }, { ctx })).rejects.toThrow(/until/);
    expect(await runAction(fromTriage(res(), 'a'), { action: 'ask-me-later' }, { ctx })).toEqual({ ok: true });
  });
  it('create-task adds a task from the subject', async () => {
    const { ctx } = mkCtx();
    const addTask = jest.fn(async () => undefined);
    expect(await runAction(fromTriage(res(), 'a'), { action: 'create-task' }, { ctx, addTask })).toEqual({ ok: true });
    expect(addTask).toHaveBeenCalledWith('Reply to Alex Rivera: Quarterly plan');
  });
});

// @req FR:inbox-page/action.request
describe('request this action', () => {
  const item = fromTriage(res({ class: 'newsletter' }), 'a');
  it('files an issue with label help wanted and no message text', async () => {
    const file = jest.fn(async () => ({ url: 'https://github.com/Xerilium/stack/issues/1' }));
    const r = await requestAction(item, 'unsubscribe', { filer: { file }, addTask: jest.fn() });
    expect(r).toEqual({ via: 'issue', url: 'https://github.com/Xerilium/stack/issues/1' });
    const issue = (file.mock.calls[0] as unknown as [{ repo: string; title: string; body: string; labels: string[] }])[0];
    expect(issue.repo).toBe('Xerilium/stack');
    expect(issue.labels).toEqual(['help wanted']);
    expect(issue.title).toContain('Unsubscribe');
    expect(issue.body).toContain('email');
    expect(issue.body).not.toContain('Quarterly plan');
    expect(issue.body).not.toContain('alex@example.test');
  });
  it('falls back to a task when filing fails', async () => {
    const addTask = jest.fn(async () => undefined);
    const r = await requestAction(item, 'unsubscribe', { filer: { file: async () => { throw new Error('no gh'); } }, addTask });
    expect(r).toEqual({ via: 'task' });
    expect(addTask).toHaveBeenCalledWith(expect.stringContaining('Inbox action: Unsubscribe'));
  });
  it('rejects a ready action', async () => {
    await expect(requestAction(item, 'mark-done', { filer: { file: jest.fn() }, addTask: jest.fn() })).rejects.toThrow(/exists/);
  });
});

// @req FR:inbox-page/conn.teams
describe('teams unread', () => {
  const chat = (id: string, read: string, at: string, over: Record<string, unknown> = {}) => ({ id, topic: 'Plan', chatType: 'group', webUrl: 'https://teams.example.test/c/' + id, viewpoint: { isHidden: false, lastMessageReadDateTime: read },
    lastMessagePreview: { createdDateTime: at, messageType: 'message', body: { content: 'Can you check the build?' }, from: { user: { id: 'u2', displayName: 'Sam' } }, ...over } });
  it('keeps chats whose last message is newer than read and not from the owner', () => {
    const out = teamsUnread([
      chat('a', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      chat('b', '2026-10-03T00:00:00Z', '2026-10-02T00:00:00Z'),
      chat('c', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', { from: { user: { id: 'me' } } }),
      chat('d', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', { messageType: 'systemEventMessage' }),
      { ...chat('e', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), viewpoint: { isHidden: true, lastMessageReadDateTime: '2026-10-01T00:00:00Z' } },
    ], 'me');
    expect(out.map((m) => m.link)).toEqual(['https://teams.example.test/c/a']); expect(out[0].id).toMatch(/^chat-[0-9a-f]{12}$/);
    expect(out[0]).toMatchObject({ source: 'teams', from: 'Sam', unread: true, link: 'https://teams.example.test/c/a' });
  });
});

// @req FR:inbox-page/conn.slack
describe('slack unread', () => {
  it('keeps conversations with newer messages from others', () => {
    const out = slackUnread([
      { id: 'D1', name: 'sam', lastRead: '100.0', messages: [{ user: 'U2', text: 'ping', ts: '200.0' }, { user: 'UME', text: 'mine', ts: '150.0' }], link: 'https://slack.example.test/D1' },
      { id: 'C1', name: 'eng', lastRead: '300.0', messages: [] },
      { id: 'C2', name: 'ops', lastRead: '100.0', messages: [{ user: 'UME', text: 'x', ts: '200.0' }] },
    ], 'UME');
    expect(out.map((m) => m.subject)).toEqual(['sam']);
    expect(out[0]).toMatchObject({ source: 'slack', subject: 'sam', summary: 'ping', unread: true });
  });
});

// @req FR:inbox-page/conn.guard
describe('chat guard', () => {
  it('allows reads only', () => {
    const g = createChatGuard();
    expect(() => g.check({ kind: 'teams', method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview&$top=50' })).not.toThrow();
    expect(() => g.check({ kind: 'slack', method: 'conversations.history' })).not.toThrow();
    expect(() => g.check({ kind: 'teams', method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/chats' })).toThrow(ChatDenied);
    expect(() => g.check({ kind: 'teams', method: 'GET', url: 'https://graph.microsoft.com/v1.0/chats/19:x/messages' })).toThrow(ChatDenied);
    expect(() => g.check({ kind: 'slack', method: 'chat.postMessage' })).toThrow(ChatDenied);
  });
});

// @req FR:inbox-page/item.ask
describe('chat to ask', () => {
  it('writes one go-do ask per conversation, clipped, with link', async () => {
    const { storage, ctx } = mkCtx();
    const [m] = teamsUnread([{ id: 'a', chatType: 'group', webUrl: 'https://teams.example.test/c/a', viewpoint: { lastMessageReadDateTime: '2026-10-01T00:00:00Z' }, lastMessagePreview: { createdDateTime: '2026-10-02T00:00:00Z', messageType: 'message', body: { content: 'x'.repeat(900) }, from: { user: { id: 'u2', displayName: 'Sam' } } } }], 'me');
    const ask = chatToAsk(m);
    expect(ask).toMatchObject({ kind: 'go-do', link: 'https://teams.example.test/c/a' });
    expect((ask.ask ?? '').length).toBeLessThanOrEqual(200);
    expect((ask.detail ?? '').length).toBeLessThanOrEqual(420);
    const { putAsk: put } = await import('../../src/core/asks');
    await put(ctx, m.id, ask, 'inbox');
    expect(await put(ctx, m.id, ask, 'inbox')).toMatchObject({ created: false });
    expect(await storage.read(asksPath(m.id))).toBeTruthy();
  });
});
