/** Writes `.stack/inbox-items.json` from email pass results and chat connectors. Never sends. @req FR:inbox-page/run.email @req FR:inbox-page/run.chat @req FR:inbox-page/run.store */
import { putAsk } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { ConflictError } from '../core/storage';
import type { TriageResult } from '../email/types';
import { chatToAsk } from './chat';
import { fromTriage, orderItems } from './items';
import { readInbox, writeInbox } from './store';
import type { ChatConnector, InboxItem } from './types';

export const MAX_ITEMS = 500;
type ChatSource = 'teams' | 'slack';

/** Read, change, write; a version conflict re-reads and tries again, up to 3 times. */
async function update(ctx: LifecycleContext, change: (cur: InboxItem[]) => InboxItem[]): Promise<void> {
  for (let i = 0; ; i++) {
    try { await writeInbox(ctx.storage, orderItems(change(await readInbox(ctx.storage))).slice(0, MAX_ITEMS)); return; } catch (e) { if (!(e instanceof ConflictError) || i >= 2) throw e; }
  }
}

/** Merges one mailbox's pass results. Items replace by id; other mailboxes stay. @req FR:inbox-page/run.email */
export async function syncInbox(ctx: LifecycleContext, o: { account: string; results: TriageResult[] }): Promise<number> {
  const fresh = o.results.map((r) => fromTriage(r, o.account));
  const ids = new Set(fresh.map((i) => i.id));
  await update(ctx, (cur) => [...cur.filter((i) => !ids.has(i.id)), ...fresh]);
  return fresh.length;
}

/** Reads each chat connector; a source that fails keeps its stored items. Result names failed sources only. @req FR:inbox-page/run.chat */
export async function runInbox(ctx: LifecycleContext, o: { connectors: Partial<Record<ChatSource, ChatConnector>> }): Promise<{ chats: number; failed: ChatSource[] }> {
  const got = new Map<ChatSource, InboxItem[]>();
  const failed: ChatSource[] = [];
  for (const [src, c] of Object.entries(o.connectors) as [ChatSource, ChatConnector][]) {
    try { got.set(src, (await c.unread()).filter((i) => i.source === src)); } catch { failed.push(src); }
  }
  const fresh = [...got.values()].flat();
  await update(ctx, (cur) => [...cur.filter((i) => !got.has(i.source as ChatSource)), ...fresh]);
  for (const i of fresh) await putAsk(ctx, i.id, chatToAsk(i as never), 'inbox');
  return { chats: fresh.length, failed };
}
