/**
 * Imperative verbs a task title can start with. The `next` quality check passes a leaf row whose title starts with one.
 * Lowercase, one word each. Add a verb here when a real task title starts with an action that is missing.
 * @req FR:product-reset/quality.rules
 */
export const VERBS: readonly string[] = [
  'accept', 'ack', 'add', 'adjust', 'answer', 'apply', 'approve', 'archive', 'ask', 'assign', 'attach', 'attend', 'audit',
  'backup', 'block', 'book', 'bring', 'build', 'buy',
  'call', 'cancel', 'capture', 'change', 'check', 'choose', 'claim', 'clean', 'clear', 'close', 'collect', 'comment', 'commit', 'compare', 'complete', 'configure', 'confirm', 'connect', 'contact', 'convert', 'copy', 'cover', 'create', 'cut',
  'debug', 'decide', 'decline', 'delete', 'deliver', 'deploy', 'design', 'disable', 'document', 'donate', 'download', 'draft', 'drop',
  'edit', 'email', 'enable', 'enrich', 'escalate', 'estimate', 'evaluate', 'expense', 'explore', 'export', 'extend',
  'file', 'fill', 'finalize', 'find', 'finish', 'fix', 'follow', 'forward',
  'get', 'give', 'grant',
  'handle', 'help', 'hire', 'host',
  'implement', 'import', 'improve', 'install', 'investigate', 'invite', 'invoice',
  'join',
  'label', 'land', 'launch', 'learn', 'link', 'list', 'log',
  'mail', 'make', 'map', 'mark', 'measure', 'meet', 'merge', 'message', 'migrate', 'move',
  'name', 'note', 'notify',
  'onboard', 'open', 'order', 'organize',
  'pack', 'pay', 'pick', 'pin', 'ping', 'plan', 'play', 'post', 'practice', 'prep', 'prepare', 'present', 'print', 'prioritize', 'publish', 'pull', 'push', 'put',
  'raise', 'read', 'rebase', 'record', 'reduce', 'refactor', 'register', 'release', 'remind', 'remove', 'rename', 'renew', 'reply', 'report', 'request', 'research', 'reschedule', 'resolve', 'respond', 'restart', 'retire', 'return', 'review', 'revise', 'rewrite', 'run',
  'save', 'schedule', 'scope', 'send', 'set', 'setup', 'share', 'ship', 'sign', 'sort', 'split', 'start', 'stop', 'submit', 'subscribe', 'summarize', 'support', 'sweep', 'sync',
  'take', 'talk', 'test', 'text', 'thank', 'track', 'train', 'transfer', 'triage', 'try', 'turn',
  'unblock', 'uninstall', 'unsubscribe', 'update', 'upgrade', 'upload', 'use',
  'validate', 'verify', 'visit', 'vote',
  'wait', 'watch', 'write',
];

const SET = new Set(VERBS);

/** True when `word` is a verb from `VERBS`, in any case. */
export const isVerb = (word: string): boolean => SET.has(word.toLowerCase());
