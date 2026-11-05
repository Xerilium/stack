/** Live Teams (Graph) and Slack transports behind `ChatConnector`. Read only; every request passes the guard first. @req FR:inbox-page/live.teams @req FR:inbox-page/live.slack @req FR:inbox-page/live.http */
import { createChatGuard, slackUnread, teamsUnread, type SlackConv } from './chat';
import type { ChatConnector } from './types';

export type HttpGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
const defaultGet: HttpGet = async (url, headers) => {
  const r = await fetch(url, { method: 'GET', headers, redirect: 'error' });
  return { status: r.status, json: await r.json().catch(() => null) };
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const guard = createChatGuard();

export const TEAMS_MAX_PAGES = 5;
export const SLACK_MAX_CONVERSATIONS = 100;
const TEAMS_START = 'https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=50';

/** Needs delegated `Chat.Read` on a work or school account. @req FR:inbox-page/live.teams */
export function teamsConnector(o: { token: () => Promise<string>; ownerId: string; tenant?: string; http?: HttpGet }): ChatConnector {
  const get = o.http ?? defaultGet;
  return {
    async unread() {
      const chats: Obj[] = [];
      let url: string | undefined = TEAMS_START;
      for (let page = 0; url && page < TEAMS_MAX_PAGES; page++) {
        guard.check({ kind: 'teams', method: 'GET', url });
        const r = await get(url, { Authorization: `Bearer ${await o.token()}`, Accept: 'application/json' });
        if (r.status !== 200) throw new Error(`Teams request failed: HTTP ${r.status}`);
        const b = obj(r.json);
        if (Array.isArray(b.value)) chats.push(...(b.value as Obj[]));
        url = typeof b['@odata.nextLink'] === 'string' ? (b['@odata.nextLink'] as string) : undefined;
      }
      return teamsUnread(chats, o.ownerId, o.tenant);
    },
  };
}

/** Needs a user token (`xoxp-`) with `im:read mpim:read channels:read groups:read` and the `*:history` scopes. @req FR:inbox-page/live.slack */
export function slackConnector(o: { token: string; ownerId: string; workspace?: string; http?: HttpGet }): ChatConnector {
  const get = o.http ?? defaultGet;
  const call = async (method: string, params: Record<string, string>): Promise<Obj> => {
    guard.check({ kind: 'slack', method });
    const r = await get(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { Authorization: `Bearer ${o.token}` });
    const b = obj(r.json);
    if (r.status !== 200 || b.ok !== true) {
      const code = typeof b.error === 'string' && /^[a-z_]{1,64}$/.test(b.error) ? b.error : `HTTP ${r.status}`;
      throw new Error(`Slack request failed: ${code}`);
    }
    return b;
  };
  return {
    async unread() {
      const list = obj(await call('users.conversations', { types: 'im,mpim,public_channel,private_channel', exclude_archived: 'true', limit: String(SLACK_MAX_CONVERSATIONS) }));
      const channels = (Array.isArray(list.channels) ? (list.channels as Obj[]) : []).slice(0, SLACK_MAX_CONVERSATIONS);
      const convs: SlackConv[] = [];
      for (const c of channels) {
        const id = String(c.id ?? '');
        if (!id) continue;
        const info = obj(obj(await call('conversations.info', { channel: id })).channel);
        const lastRead = typeof info.last_read === 'string' ? info.last_read : '';
        if (!lastRead) continue;
        const hist = await call('conversations.history', { channel: id, oldest: lastRead, limit: '15' });
        const messages = (Array.isArray(hist.messages) ? (hist.messages as Obj[]) : []).filter((m) => typeof m.user === 'string' && !m.subtype).map((m) => ({ user: String(m.user), text: String(m.text ?? ''), ts: String(m.ts ?? '0') }));
        const isDm = c.is_im === true;
        convs.push({ id, name: typeof c.name === 'string' && c.name ? c.name : isDm ? 'Direct message' : 'Conversation', lastRead, messages, isDm });
      }
      return slackUnread(convs, o.ownerId, o.workspace);
    },
  };
}
