/** Teams and Slack unread, read only. Mappers are pure; connectors inject the transport. @req FR:inbox-page/conn.teams @req FR:inbox-page/conn.slack @req FR:inbox-page/conn.guard @req FR:inbox-page/item.ask */
import { createHash } from 'crypto';
import type { AskPut } from '../core/asks';
import { oneLine } from '../core/asks';
import { redact } from '../core/triage';
import type { ChatItem } from './types';

const key = (prefix: string, id: string) => `chat-${createHash('sha1').update(`${prefix}:${id}`).digest('hex').slice(0, 12)}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const text = (s: string) => oneLine(s.replace(/<[^>]*>/g, ' '));

interface GraphChat {
  id?: string; topic?: string | null; chatType?: string; webUrl?: string;
  viewpoint?: { isHidden?: boolean; lastMessageReadDateTime?: string };
  lastMessagePreview?: { createdDateTime?: string; messageType?: string; isDeleted?: boolean; body?: { content?: string }; from?: { user?: { id?: string; displayName?: string } | null } | null };
}

/** Chats whose last message is newer than the owner's read mark. Needs `Chat.Read` on a work account. @req FR:inbox-page/conn.teams */
export function teamsUnread(chats: GraphChat[], ownerId: string, tenant = 'teams'): ChatItem[] {
  const out: ChatItem[] = [];
  for (const c of chats) {
    const p = c.lastMessagePreview;
    if (!c.id || !p?.createdDateTime || c.viewpoint?.isHidden || p.messageType !== 'message' || p.isDeleted) continue;
    if (p.from?.user?.id === ownerId) continue;
    if (Date.parse(p.createdDateTime) <= Date.parse(c.viewpoint?.lastMessageReadDateTime ?? '0001-01-01T00:00:00Z')) continue;
    const who = p.from?.user?.displayName ?? 'Someone';
    const body = clip(text(p.body?.content ?? ''), 400);
    out.push({
      id: key('teams', c.id), source: 'teams', account: tenant, from: who, subject: c.topic || (c.chatType === 'oneOnOne' ? `Chat with ${who}` : 'Group chat'),
      receivedAt: p.createdDateTime, unread: true, urgency: c.chatType === 'oneOnOne' ? 1 : 0, summary: body, suggested: 'ask-me-later',
      actions: ['ask-me-later', 'mark-done', 'snooze', 'create-task', 'delegate'], ...(c.webUrl ? { link: c.webUrl } : {}), kind: c.chatType ?? 'chat',
    });
  }
  return out;
}

export interface SlackConv { id: string; name: string; lastRead: string; messages: { user: string; text: string; ts: string }[]; link?: string; isDm?: boolean }

/** Conversations with messages from others after `last_read`. @req FR:inbox-page/conn.slack */
export function slackUnread(convs: SlackConv[], ownerId: string, workspace = 'slack'): ChatItem[] {
  const out: ChatItem[] = [];
  for (const c of convs) {
    const fresh = c.messages.filter((m) => m.user !== ownerId && Number(m.ts) > Number(c.lastRead));
    if (!fresh.length) continue;
    const last = fresh.reduce((a, b) => (Number(b.ts) > Number(a.ts) ? b : a));
    out.push({
      id: key('slack', c.id), source: 'slack', account: workspace, from: last.user, subject: c.name, receivedAt: new Date(Number(last.ts) * 1000).toISOString(), unread: true,
      urgency: c.isDm ? 1 : 0, summary: clip(text(last.text), 400), suggested: 'ask-me-later', actions: ['ask-me-later', 'mark-done', 'snooze', 'create-task', 'delegate'],
      ...(c.link ? { link: c.link } : {}), kind: c.isDm ? 'im' : 'channel',
    });
  }
  return out;
}

/** A chat item to a `go-do` ask. Text is clipped and redacted. One ask per conversation. @req FR:inbox-page/item.ask */
export function chatToAsk(m: ChatItem): AskPut {
  const https = m.link && /^https:\/\/\S+$/.test(m.link) ? m.link : undefined;
  return {
    from: 'inbox', kind: 'go-do', ask: clip(oneLine(`Reply on ${m.source === 'teams' ? 'Teams' : 'Slack'} to ${m.from}: ${m.subject}`), 200), priority: (m.urgency ?? 0) >= 1 ? 'normal' : 'low', reversible: true,
    detail: `Thread: ${clip(oneLine(redact(m.summary)), 400)}`, ...(https ? { link: https } : {}),
  };
}

export interface ChatRequest { kind: 'teams' | 'slack'; method: string; url?: string }
export class ChatDenied extends Error { constructor(why: string) { super(`Chat request denied: ${why}`); this.name = 'ChatDenied'; } }
const SLACK_READS = new Set(['users.conversations', 'conversations.info', 'conversations.history']);
/** Reads only. Teams: `GET /me/chats`. Slack: three read methods. @req FR:inbox-page/conn.guard */
export function createChatGuard() {
  return {
    check(r: ChatRequest): void {
      if (r.kind === 'slack') { if (!SLACK_READS.has(r.method)) throw new ChatDenied(r.method); return; }
      let u: URL;
      try { u = new URL(r.url ?? ''); } catch { throw new ChatDenied('bad url'); }
      if (r.method !== 'GET' || u.origin !== 'https://graph.microsoft.com' || u.pathname !== '/v1.0/me/chats') throw new ChatDenied(`${r.method} ${u.pathname}`);
    },
  };
}
