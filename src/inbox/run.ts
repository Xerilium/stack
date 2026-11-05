/** Runs one inbox action. Nothing here sends: the only mail write is a reply draft. @req FR:inbox-page/action.reply @req FR:inbox-page/action.done @req FR:inbox-page/action.missing */
import { answerAsk, handleAsk } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { NotFoundError } from '../core/storage';
import type { MailProvider } from '../email/types';
import { actionInfo } from './actions';
import type { ActionId, InboxItem } from './types';

export interface Deps { ctx: LifecycleContext; mail?: Pick<MailProvider, 'createDraft'>; addTask?: (text: string) => Promise<unknown> }
export type ActionResult = { ok: true; link?: string } | { ok: false; missing: true };

/** Next morning (UTC date) after the context clock. */
const tomorrow = (ctx: LifecycleContext) => new Date((ctx.now?.() ?? new Date()).getTime() + 864e5).toISOString().slice(0, 10);
const quiet = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (!(e instanceof NotFoundError)) throw e; } };

export async function runAction(item: InboxItem, req: { action: ActionId; text?: string; until?: string }, d: Deps): Promise<ActionResult> {
  const info = actionInfo(req.action);
  if (!info) throw new Error(`Unknown action: ${req.action}`);
  if (!info.ready) return { ok: false, missing: true };
  switch (req.action) {
    case 'reply-draft': {
      if (item.source !== 'email' || !item.messageId) throw new Error('Reply drafts work for email only');
      if (!req.text?.trim()) throw new Error('Draft text is required');
      if (!d.mail) throw new Error('No mail provider');
      const r = await d.mail.createDraft(item.messageId, req.text);
      return { ok: true, link: r.webLink };
    }
    case 'mark-done':
      await quiet(handleAsk(d.ctx, item.id, { outcome: 'resolved', note: 'Marked done in Inbox' }, 'inbox'));
      return { ok: true };
    case 'snooze':
      if (!req.until) throw new Error('until is required to snooze');
      await quiet(answerAsk(d.ctx, item.id, { answer: 'defer', until: req.until }));
      return { ok: true };
    case 'ask-me-later':
      await quiet(answerAsk(d.ctx, item.id, { answer: 'defer', until: req.until ?? tomorrow(d.ctx) }));
      return { ok: true };
    case 'create-task':
      if (!d.addTask) throw new Error('No task writer');
      await d.addTask(`${item.source === 'email' ? 'Reply to' : 'Follow up with'} ${item.from}: ${item.subject}`.replace(/\s+/g, ' ').trim());
      return { ok: true };
    default:
      return { ok: false, missing: true };
  }
}
