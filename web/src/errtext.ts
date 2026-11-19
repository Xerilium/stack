import { ApiFailure } from './api';

/** An error the app throws with words written for the owner: `errText` shows it as-is. @req FR:web-shell/state.errors.specific */
export class UserError extends Error {}

/** API text that names no cause: it maps by code. Anything else from the server names the cause and shows as-is. @req FR:web-shell/state.errors.code */
const BARE = new Set(['', 'Failed', 'Conflict', 'Not found', 'Validation failed', 'Request cannot be applied', 'Internal error', 'Forbidden', 'Method not allowed', 'Invalid path']);
const isBare = (m: string) => BARE.has(m.trim()) || /^Request failed \(\d+\)$/.test(m.trim());

/**
 * The cause in the owner's words when the error names one, else empty: a `UserError`, a field detail, the network or
 * offline text, or a server message that is not bare.
 * @req FR:web-shell/state.errors.specific @req FR:web-shell/state.errors.details
 */
export function errCause(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (!(e instanceof ApiFailure)) return '';
  if (e.details?.[0]?.message) return e.details[0].message;
  return e.code === 'network' || e.code === 'offline' || !isBare(e.message) ? e.message : '';
}

/**
 * The text for an error toast or inline error: what happened and what to do next.
 * `action` is a verb phrase such as `save the task`. Leave it out where the view already says what failed: the text is then only the next step.
 * @req FR:web-shell/state.errors @req FR:web-shell/state.errors.shared @req FR:web-shell/state.errors.code @req FR:web-shell/state.errors.details
 * @req FR:web-shell/state.errors.specific @req FR:web-shell/state.errors.prefixed
 */
export function errText(e: unknown, action?: string): string {
  const cause = errCause(e);
  if (cause) return cause;
  const could = action ? `Could not ${action}. ` : '';
  const retry = `${could}Try again.`;
  switch (e instanceof ApiFailure ? e.code : '') {
    case 'conflict': return 'Changed somewhere else. Reload, then try again.';
    case 'not_found': return 'This item no longer exists. Reload to see the latest.';
    case 'invalid': return `${could}Check the values and try again.`;
    case 'forbidden': return `${could}This account is not allowed to do that.`;
    case 'internal': return `${retry} If it happens again, send feedback (F).`;
    default: return retry;
  }
}
