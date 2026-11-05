/** The action catalog. A missing action offers "Request this action". @req FR:inbox-page/action.catalog */
import type { ActionId } from './types';

export interface ActionInfo { id: ActionId; label: string; ready: boolean }

export const ACTIONS: readonly ActionInfo[] = [
  { id: 'reply-draft', label: 'Draft reply', ready: true },
  { id: 'mark-done', label: 'Mark done', ready: true },
  { id: 'snooze', label: 'Snooze', ready: true },
  { id: 'ask-me-later', label: 'Ask me later', ready: true },
  { id: 'create-task', label: 'Create task', ready: true },
  { id: 'archive', label: 'Archive', ready: false },
  { id: 'unsubscribe', label: 'Unsubscribe', ready: false },
  { id: 'delegate', label: 'Delegate to agent', ready: false },
  { id: 'schedule', label: 'Schedule', ready: false },
  { id: 'forward-draft', label: 'Draft forward', ready: false },
];
export const actionInfo = (id: string): ActionInfo | undefined => ACTIONS.find((a) => a.id === id);
