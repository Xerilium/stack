/** Inbox contracts. Types only. @req FR:inbox-page/item.shape */
export const ACTION_IDS = ['reply-draft', 'mark-done', 'snooze', 'ask-me-later', 'create-task', 'archive', 'unsubscribe', 'delegate', 'schedule', 'forward-draft'] as const;
export type ActionId = (typeof ACTION_IDS)[number];
export type Source = 'email' | 'teams' | 'slack';

export interface InboxItem {
  /** The ask key: `mail-<hash>` for email, `chat-<hash>` for chats. */
  id: string;
  source: Source;
  /** Mailbox address, workspace or tenant. */
  account: string;
  from: string;
  subject: string;
  receivedAt: string;
  unread: boolean;
  /** 0 (can wait) to 3 (now). */
  urgency?: number;
  summary: string;
  suggested: ActionId;
  actions: ActionId[];
  link?: string;
  /** Email only: the Graph message the draft replies to. */
  messageId?: string;
  /** Triage class (email) or chat type; used in action requests, never message text. */
  kind?: string;
}

/** One unread chat message, source neutral. */
export interface ChatItem extends InboxItem { source: 'teams' | 'slack' }

/** Reads unread chat messages. Read only: no connector can post. @req FR:inbox-page/conn.interface */
export interface ChatConnector { unread(): Promise<ChatItem[]> }

export interface IssueFiler { file(issue: { repo: string; title: string; body: string; labels: string[] }): Promise<{ url: string }> }
