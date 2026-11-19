import { ApiFailure } from './api';

/** API text that names no cause: it maps by code. Anything else from the server names the cause and shows as-is. */
const BARE = new Set(['', 'Failed', 'Conflict', 'Not found', 'Validation failed', 'Request cannot be applied', 'Internal error', 'Forbidden', 'Method not allowed', 'Invalid path']);
const isBare = (m: string) => BARE.has(m.trim()) || /^Request failed \(\d+\)$/.test(m.trim());

/**
 * The text for an error toast or inline error: what happened and what to do next.
 * `action` is a verb phrase such as `save the task`. Leave it out where the view already says what failed: the text is then only the next step.
 * @req FR:web-shell/state.errors.prefixed @req FR:web-shell/state.errors @req FR:web-shell/state.errors.code @req FR:web-shell/state.errors.specific
 */
export function errText(e: unknown, action?: string): string {
  const could = action ? `Could not ${action}. ` : '';
  const retry = `${could}Try again.`;
  if (!(e instanceof ApiFailure)) return retry;
  if (e.code === 'network' || e.code === 'offline') return e.message;
  if (e.code === 'invalid' && e.details?.[0]?.message) return e.details[0].message;
  if (!isBare(e.message)) return e.message;
  if (e.code === 'internal') return `${retry} If it happens again, send feedback (F).`;
  if (e.code === 'conflict') return 'Changed somewhere else. Reload, then try again.';
  if (e.code === 'not_found') return 'This item no longer exists. Reload to see the latest.';
  if (e.code === 'invalid') return `${could}Check the values and try again.`;
  return retry;
}
