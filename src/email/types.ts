/**
 * Email triage contracts. Types only: everything that touches the network is injected, so a run is testable offline.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.decide @req FR:email-triage/ask.quiet
 */

export interface Address { name?: string; address: string }

/** A mailbox message, reduced to what triage needs. Bodies stay out; only the preview travels. */
export interface Message {
  id: string;
  conversationId: string;
  subject: string;
  from: Address;
  /** ISO date-time. */
  receivedAt: string;
  bodyPreview: string;
  /** Outlook web link to the message. */
  webLink?: string;
  /** Internet headers, when fetched. Names are matched case-insensitively. */
  headers?: Record<string, string>;
  /** Graph `@odata.type`; `eventMessage*` marks calendar items. */
  odataType?: string;
  /** Address of the sender of the last message in the thread. */
  threadLastFrom?: string;
}

export const TRIAGE_CLASSES = ['needs_reply', 'needs_decision', 'fyi', 'newsletter', 'receipt', 'calendar', 'skip', 'sensitive'] as const;
export type TriageClass = (typeof TRIAGE_CLASSES)[number];

/** What a model returns for one message; re-validated in code before use. */
export interface Classification {
  class: TriageClass;
  /** 0 (can wait) to 3 (now). */
  urgency: number;
  /** 0 to 1. */
  confidence: number;
  reason: string;
  /** 2-4 choices for `needs_decision`. */
  options?: string[];
  recommend?: string;
  injectionSuspected?: boolean;
}

export interface TriageResult {
  message: Message;
  class: TriageClass;
  confidence: number;
  urgency?: number;
  reason?: string;
  options?: string[];
  recommend?: string;
  vip?: boolean;
  /** The draft created in the mailbox, with its Outlook web link. */
  draft?: { text: string; webLink: string };
}

export interface MailProvider {
  /** Messages changed since `cursor`, plus the next cursor. */
  delta(cursor?: string): Promise<{ messages: Message[]; cursor: string }>;
  /** Creates a reply draft from the server's `createReply`; the text is the comment only. */
  createDraft(messageId: string, text: string): Promise<{ id: string; webLink: string }>;
}

export interface Classifier {
  classify(message: Message, opts: { vip: boolean }): Promise<Classification>;
}

export interface Drafter {
  draft(message: Message): Promise<string>;
}
