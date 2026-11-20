import { useRef, useState } from 'preact/hooks';
import './ui.css';

/** The longest text a session prompt takes (`FR:agent-sessions/run.prompt`). */
const MAX = 4000;

/**
 * One message from a details pane: a heading, a text box and one send button, `Send to <to>`. The text in the box is the text that
 * goes; start text waits in the box until the owner sends it. After a send it clears the text and says
 * `Sent to <to>`; on an error it keeps the text and says the error. With `off` (a reason) the box and button are off.
 * @req FR:ui-kit/message @req FR:ui-kit/message.label @req FR:ui-kit/message.exact @req FR:ui-kit/send.box
 * @owns class:ui-msg
 */
export function MessageBox({ heading, to, text: start = '', off, max = MAX, onSend }: {
  heading: string;
  /** The longest text the receiver takes; default 4000. */
  max?: number;
  /** Who gets the message: names the text box, the button and the result. */
  to: string;
  /** The text the box starts with. */
  text?: string;
  /** Why the box cannot send; shown under it. */
  off?: string;
  /** Sends the trimmed text; a rejection shows its message. */
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  /** A send in flight: a ref, so a second submit in the same frame cannot send twice. */
  const sending = useRef(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending.current || off) return;
    sending.current = true; setBusy(true); setNote(null);
    try { await onSend(t); setText(''); setNote({ text: `Sent to ${to}`, bad: false }); }
    catch (err) { setNote({ text: err instanceof Error && err.message ? err.message : 'Not sent', bad: true }); }
    finally { sending.current = false; setBusy(false); }
  };
  return (
    <div class="ui-msg" role="group" aria-label={heading}>
      <h4 class="ui-bar-h">{heading}</h4>
      <form class="ui-msg-form" onSubmit={(e) => { void submit(e); }}>
      <textarea class="ui-msg-box" rows={3} maxLength={max} value={text} disabled={!!off} aria-label={`Message ${to}`} placeholder={off ? undefined : `Message ${to}…`}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <div class="ui-msg-row">
        <button type="submit" class="fl-btn" disabled={!!off || busy || !text.trim()}>Send to {to}</button>
        {off ? <span class="ui-msg-hint">{off}</span> : <span class={`ui-msg-hint${note?.bad ? ' bad' : ''}`} role="status">{note?.text ?? ''}</span>}
      </div>
      </form>
    </div>
  );
}
