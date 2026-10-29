import { MemoryStorage } from '../../src/core/storage';
import type { Message } from '../../src/email/types';

export const NOW = new Date('2026-10-28T14:00:00Z');

/** Offline ask-queue context with a ticking clock. */
export function mkCtx() {
  const storage = new MemoryStorage();
  let tick = 0;
  return { storage, ctx: { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) } };
}

/** Synthetic message; every address is on example.test. */
export const msg = (over: Partial<Message> = {}): Message => ({
  id: 'AAMk-msg-1', conversationId: 'conv-1', subject: 'Quarterly plan', from: { name: 'Alex Rivera', address: 'alex@example.test' },
  receivedAt: '2026-10-28T13:00:00Z', bodyPreview: 'Can you review the plan by Friday?', webLink: 'https://outlook.example.test/mail/id/AAMk-msg-1', ...over,
});
