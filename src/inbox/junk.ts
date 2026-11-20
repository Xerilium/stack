/**
 * Clears the Inbox junk on the owner's click: optional one-click unsubscribe, then a move to Archive. Never deletes.
 * The mailbox is injected; this module only picks the items and updates the item file.
 * @req FR:inbox-page/junk.archive @req FR:inbox-page/junk.unsubscribe @req FR:inbox-page/junk.never
 */
import type { LifecycleContext } from '../core/lifecycle';
import { isJunk } from './items';
import { updateInbox } from './runner';
import { readInbox } from './store';

/** The two mailbox writes a Junk action may make, for one account. */
export interface JunkMailbox {
  /** Moves the messages to Archive; returns the ids that moved. */
  archive(ids: string[]): Promise<string[]>;
  /** Sends the one-click unsubscribe when the sender offers one; false when it does not or the send failed. */
  unsubscribe(id: string): Promise<boolean>;
}
export interface JunkResult { archived: number; unsubscribed: number; /** Junk items that stay: a read-only account or a failed move. */ kept: number }

/** `ids`: the junk item ids the owner saw when he clicked. Junk that arrived after the page loaded is left alone. @req FR:inbox-page/junk.archive.ids */
export async function clearJunk(ctx: LifecycleContext, o: { ids: readonly string[]; unsubscribe: boolean; mailbox: (account: string) => Promise<JunkMailbox | undefined> }): Promise<JunkResult> {
  const shown = new Set(o.ids);
  const junk = (await readInbox(ctx.storage)).filter((i) => shown.has(i.id) && isJunk(i) && i.messageId);
  const out: JunkResult = { archived: 0, unsubscribed: 0, kept: 0 };
  const gone = new Set<string>();
  for (const account of [...new Set(junk.map((i) => i.account))]) {
    const mine = junk.filter((i) => i.account === account);
    // No way to write to this mailbox (read-only sign-in, hosted app): its junk stays. @req FR:inbox-page/junk.archive.readonly
    const box = await o.mailbox(account).catch(() => undefined);
    if (!box) { out.kept += mine.length; continue; }
    if (o.unsubscribe) {
      for (const i of mine.filter((x) => x.kind === 'newsletter')) if (await box.unsubscribe(i.messageId!).catch(() => false)) out.unsubscribed++;
    }
    // Exactly the junk ids of this click. @req FR:inbox-page/junk.archive.ids @req FR:inbox-page/junk.archive.failed
    const moved = new Set(await box.archive(mine.map((i) => i.messageId!)).catch(() => [] as string[]));
    for (const i of mine) { if (moved.has(i.messageId!)) { gone.add(i.id); out.archived++; } else out.kept++; }
  }
  if (gone.size) await updateInbox(ctx, (cur) => cur.filter((i) => !gone.has(i.id)));
  return out;
}
