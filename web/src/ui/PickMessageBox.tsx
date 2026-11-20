import { useState } from 'preact/hooks';
import { MessageBox } from './MessageBox';
import './ui.css';

export interface PickOption { id: string; label: string }

/**
 * A message to one recipient the owner picks: a picker, then a `MessageBox` (`Send to <picked>`). Changing the pick keeps the draft.
 * It sends only on the form submit. With no options the box is off and says `empty`.
 * @req FR:ask-routing/ui.ask @req FR:ask-routing/ui.kit @req FR:ui-kit/send.box @req FR:ui-kit/guard.owns
 * @owns class:ui-pick
 */
export function PickMessageBox({ heading, pickLabel, options, empty, max, onSend }: {
  heading: string;
  /** Names the picker. */
  pickLabel: string;
  /** In the order to show; the first is picked at the start. */
  options: PickOption[];
  /** Why nothing can be sent when there are no options. */
  empty: string;
  max?: number;
  onSend: (id: string, text: string) => Promise<void>;
}) {
  const [id, setId] = useState<string | null>(null);
  const picked = options.find((o) => o.id === id) ?? options[0];
  return (
    <div class="ui-pick">
      <label class="ui-pick-row">
        <span class="ui-pick-label" aria-hidden="true">{pickLabel}</span>
        <select class="ui-pick-select" aria-label={pickLabel} value={picked?.id ?? ''} disabled={!options.length} onChange={(e) => setId((e.target as HTMLSelectElement).value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <MessageBox heading={heading} to={picked?.label ?? 'an agent'} max={max} {...(picked ? {} : { off: empty })} onSend={(t) => (picked ? onSend(picked.id, t) : Promise.reject(new Error(empty)))} />
    </div>
  );
}
