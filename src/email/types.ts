/**
 * Email triage contracts. Types only: everything that touches the network is injected, so a run is testable offline.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.decide @req FR:email-triage/ask.quiet
 */
import type { Violation } from './voice/score';

/** Voice check of a draft; `profile` is false when no learned voice was loaded. @req FR:email-voice/score.ask */
export interface DraftVoice { score: number; pass: boolean; violations: Violation[]; profile: boolean }

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
  /** Plain-text body, when fetched for drafting. Untrusted data. */
  body?: string;
  /** Read state; later deltas report it for messages seen before. @req FR:email-inbox-zero/sub.ledger */
  isRead?: boolean;
  /** Outlook web link to the message. */
  webLink?: string;
  /** Internet headers, when fetched. Names are matched case-insensitively. */
  headers?: Record<string, string>;
  /** Graph `@odata.type`; `eventMessage*` marks calendar items. */
  odataType?: string;
  /** Address of the sender of the last message in the thread. */
  threadLastFrom?: string;
}

export const TRIAGE_CLASSES = ['needs_reply', 'needs_decision', 'fyi', 'newsletter', 'receipt', 'calendar', 'skip', 'sensitive', 'spam'] as const;
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
  /** At most 3 sentences on the thread, from the same call. @req FR:email-inbox-zero/sum.cheap */
  summary?: string;
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
  /** Thread summary for the ask. @req FR:email-inbox-zero/sum.ask */
  summary?: string;
  /** The draft in the mailbox with its Outlook web link; `reused` when it was already there from an earlier pass and nothing new was created. */
  draft?: { text: string; webLink: string; reused?: boolean; voice?: DraftVoice };
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
  /** `feedback` lists voice-check violations of the previous attempt. @req FR:email-voice/score.redraft */
  draft(message: Message, opts?: { feedback?: string[] }): Promise<string>;
}
