/**
 * One message of a mail or chat thread: the sender, the time, an optional meta line, and the text.
 * The text is data: it renders as plain text with its line breaks, never as markup. `fold` puts it under a summary line.
 * @req FR:ui-kit/thread.show @req FR:ui-kit/thread.fold @req FR:ui-kit/thread.meta @req FR:ui-kit/guard.owns
 * @owns class:ui-tmsg
 */
import './ui.css';

export interface ThreadMessageProps { from: string; when: string; body: string; /** A quiet line under the sender, for example the recipients. */ meta?: string; fold?: boolean }

export function ThreadMessage({ from, when, body, meta, fold = false }: ThreadMessageProps) {
  const head = <><span class="ui-tmsg-from">{from}</span><span class="ui-tmsg-when">{when}</span></>;
  const rest = <>{meta && <p class="ui-tmsg-meta">{meta}</p>}<div class="ui-tmsg-body">{body}</div></>;
  return fold
    ? <details class="ui-tmsg fold"><summary class="ui-tmsg-head">{head}</summary>{rest}</details>
    : <article class="ui-tmsg"><header class="ui-tmsg-head">{head}</header>{rest}</article>;
}
