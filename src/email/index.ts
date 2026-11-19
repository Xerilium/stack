/** Email triage module: reads a mailbox and writes asks into the ask queue. The only send is the owner's click (`reply-send.ts`). @req FR:email-triage/safe.allowlist */
export * from './types';
export * from './guard';
export * from './draft';
export * from './rules';
export * from './to-ask';
export * from './run';
