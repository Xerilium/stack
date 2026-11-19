/** The item detail: one message and its thread, read live and never stored. Types only. @req FR:inbox-page/detail.api */
import type { Address } from '../email/types';

/** One message of a thread. `body` is plain text and untrusted data. */
export interface MailMessage { id: string; from: Address; to: Address[]; subject: string; receivedAt: string; body: string; /** The owner sent it. @req FR:inbox-page/detail.thread.mine */ mine: boolean }
export interface MailThread { message: MailMessage; /** The other messages, newest first. */ thread: MailMessage[] }
/** Reads one mailbox. Read only. @req FR:inbox-page/detail.read */
export interface MailReader { thread(messageId: string): Promise<MailThread> }
