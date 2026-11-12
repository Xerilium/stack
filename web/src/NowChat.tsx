/**
 * Now: message the task's agent. A chat thread (your messages and the agent's replies) over one composer; Enter sends.
 * @req FR:now-screen/now.compose @req FR:now-screen/now.thread @req FR:agent-team/web.avatar
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Avatar } from './AgentAvatar';
import type { AvatarWho } from './avatar';
import { foldLines, tellThread, TELL_MAX } from './nowscreen';
import { ago, type Thread } from './thread';

export interface NowChatProps {
  taskRef: string; busy: boolean;
  /** The task's agent; null: no agent covers it. */ agent: AvatarWho | null;
  /** The agent a reply came from (slug or name), for its name and avatar. */ agentOf: (who: string) => AvatarWho;
  onSend: (text: string) => Promise<boolean>; loadThread: (ref: string) => Promise<Thread>;
  /** The task has a live agent session: open it. */ onLiveChat?: () => void;
}

export function NowChat({ taskRef, busy, agent, agentOf, onSend, loadThread, onLiveChat }: NowChatProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ReturnType<typeof tellThread>>([]);
  const load = useCallback(() => loadThread(taskRef).then((t) => setItems(tellThread(t.items)), () => undefined), [taskRef, loadThread]);
  useEffect(() => { void load(); }, [load]);
  const name = agent?.name ?? 'the agent';
  const send = async () => {
    const t = foldLines(text);
    if (busy || !t) return;
    if (await onSend(t)) { setText(''); void load(); }
  };
  const now = new Date();
  return (
    <section class="now-chat" aria-label={`Messages with ${name}`} data-testid="now-chat">
      {items.length > 0 && (
        <ol class="now-thread" data-testid="now-thread">
          {items.map((i) => {
            const who = i.kind === 'agent' ? agentOf(i.agent) : null;
            return (
              <li key={i.id} class={`now-bubble ${who ? 'from-agent' : 'from-me'}`}>
                {who && <Avatar who={who} size={28} />}
                <div class="now-bubble-body">
                  <span class="now-bubble-who">{who ? who.name : 'You'}{i.at && <> · <time dateTime={i.at}>{ago(i.at, now)}</time></>}</span>
                  <p class="now-bubble-text">{i.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <form class="now-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {agent && <Avatar who={agent} size={36} />}
        <textarea id="now-msg" rows={1} maxLength={TELL_MAX} value={text} aria-label={`Message ${name}`} placeholder={`Message ${name}…`}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLTextAreaElement).blur(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); void send(); }
          }} />
        <button type="submit" class="now-send" disabled={busy || !foldLines(text)}>Send</button>
      </form>
      {onLiveChat && <button type="button" class="now-live" onClick={onLiveChat}>Open live chat</button>}
    </section>
  );
}
