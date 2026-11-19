/** The item detail: one message and its thread, read live and never stored. Types only. @req FR:inbox-page/detail.api */
import type { MailThread } from '../email/types';

export type { MailMessage, MailThread } from '../email/types';
/** Reads one mailbox. Read only. @req FR:inbox-page/detail.read */
export interface MailReader { thread(messageId: string): Promise<MailThread> }
