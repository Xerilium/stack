/**
 * Now: message the task's agent. A chat thread (your messages and the agent's replies) over one composer; Enter sends.
 * @req FR:now-screen/now.compose @req FR:now-screen/now.thread @req FR:agent-team/web.avatar
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './AgentAvatar';
import { nameBeside } from './avatar';
import type { AvatarWho } from './avatar';
import { foldLines, tellThread, TELL_MAX } from './nowscreen';
import { unescapeMd } from './agents';
import { ago, type Thread } from './thread';

const POLL_MS = 10_000;

export interface NowChatProps {
  taskRef: string; busy: boolean;
  /** The task's agent; null: no agent covers it. */ agent: AvatarWho | null;
  /** The agent a reply came from (slug or name), for its name and avatar. */ agentOf: (who: string) => AvatarWho;
  onSend: (text: string) => Promise<boolean>; loadThread: (ref: string) => Promise<Thread>;
  /** Open a live agent session by id: the thread names the task's own session (never a review). */ onOpenSession?: (id: string) => void;
  /** Bump when tasks, asks, or sessions change so the thread re-reads. */ tick?: string;
}

export function NowChat({ taskRef, busy, agent, agentOf, onSend, loadThread, onOpenSession, tick }: NowChatProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ReturnType<typeof tellThread>>([]);
  const [session, setSession] = useState<Thread['session']>();
  const seq = useRef(0); // only the latest load replaces the thread
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try { const t = await loadThread(taskRef); if (mine === seq.current) { setItems(tellThread(t.items)); setSession(t.session); } } catch { /* keep what shows */ }
  }, [taskRef, loadThread]);
  useEffect(() => { void load(); }, [load, tick]);
  // A scheduled agent's reply shows up while Now stays open.
  useEffect(() => {
    const h = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(h);
  }, [load]);
  const name = agent ? nameBeside(agent) : 'the agent';
  const label = agent ? agent.name : 'the agent'; // accessible names keep the emoji: the avatar is aria-hidden
  const sending = useRef(false); // two fast Enters send once
  const send = async () => {
    const t = foldLines(text);
    if (busy || !t || sending.current) return;
    sending.current = true;
    const sent = text;
    try {
      if (await onSend(t)) {
        // Clear only what was sent: text typed while the send was in flight stays.
        setText((cur) => { if (cur !== sent) return cur; const el = document.getElementById('now-msg'); if (el) el.style.height = ''; return ''; });
        void load();
      }
    } finally { sending.current = false; }
  };
  /** Grows with the text where `field-sizing` is missing (Safari, Firefox). */
  const grow = (el: HTMLTextAreaElement) => { if (CSS.supports?.('field-sizing', 'content')) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  const now = new Date();
  return (
    <section class="now-chat" aria-label={`Messages with ${label}`} data-testid="now-chat">
      {items.length > 0 && (
        <ol class="now-thread" data-testid="now-thread">
          {items.map((i) => {
            const who = i.kind === 'agent' ? agentOf(i.agent) : null;
            return (
              <li key={i.id} class={`now-bubble ${who ? 'from-agent' : 'from-me'}`}>
                {who && <Avatar who={who} size={28} />}
                <div class="now-bubble-body">
                  <span class="now-bubble-who">{who ? nameBeside(who) : `You to ${name}`}{i.at && <> · <time dateTime={i.at}>{ago(i.at, now)}</time></>}</span>
                  <p class="now-bubble-text">{unescapeMd(i.text)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 0 && items[items.length - 1].kind === 'owner' && (
        <p class="now-awaits" data-testid="now-awaits">{name === 'the agent' ? 'The agent' : name} replies here</p>
      )}
      <form class="now-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {/* Who the box talks to, above the field. @req FR:now-screen/now.compose */}
        <p class="now-to" data-testid="now-to">{agent && <Avatar who={agent} size={28} />}<span class="now-to-name">{agent ? nameBeside(agent) : 'The agent'}</span></p>
        <div class="now-compose-row">
        <textarea id="now-msg" rows={1} maxLength={TELL_MAX} value={text} aria-label={`Message ${label}`} placeholder={`Message ${name}…`}
          onInput={(e) => { const el = e.target as HTMLTextAreaElement; setText(el.value); grow(el); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLTextAreaElement).blur(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); void send(); }
          }} />
        <button type="submit" class="now-send" disabled={busy || !foldLines(text)}>Send</button>
        </div>
      </form>
      {onOpenSession && session && session.state !== 'stale' && <button type="button" class="now-live" onClick={() => onOpenSession(session.id)}>Open live chat</button>}
    </section>
  );
}
