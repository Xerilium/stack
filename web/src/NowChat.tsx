/**
 * Now: message the task's agent. A chat thread (your messages and the agent's replies) over one composer; Enter sends.
 * The agent chip above the box is the recipient: tap it to send the next messages to another agent (the pick is kept per task, never written to the task).
 * @req FR:now-screen/now.compose @req FR:now-screen/now.thread @req FR:agent-team/web.avatar @req FR:product-reset/ui.thread @req FR:product-reset/ui.agentchip @req FR:agent-delivery/state.bubble @req FR:agent-delivery/live.offer
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './AgentAvatar';
import { nameBeside } from './avatar';
import type { AvatarWho } from './avatar';
import { foldLines, tellThread, TELL_MAX } from './nowscreen';
import { unescapeMd } from './agents';
import { ago, type Thread } from './thread';
import { deliveryNote, liveLink, type DeliveryInfo } from './delivery';
import { loadPick, loadRecent, pickerList, savePick } from './agentpick';
import { store } from './day';
import type { TeamAgent } from './team';

const POLL_MS = 10_000;

export interface NowChatProps {
  taskRef: string; busy: boolean;
  /** Where the pick is kept (`pickKeyOf`); default the ref. */ pickKey?: string;
  /** The task's owning agent (`ownerOf`); null: no agent covers it. */ agent: (AvatarWho & { slug?: string }) | null;
  /** The whole team, for the picker. */ team?: TeamAgent[];
  /** The agent a reply came from (slug or name), for its name and avatar. */ agentOf: (who: string) => AvatarWho;
  /** `agent`: the picked agent's slug when it is not the owner. */ onSend: (text: string, agent?: string) => Promise<boolean>; loadThread: (ref: string) => Promise<Thread>;
  /** Open a live agent session by id: the thread names the task's own session (never a review). */ onOpenSession?: (id: string) => void;
  /** Bump when tasks, asks, or sessions change so the thread re-reads. */ tick?: string;
  /** Delivery state of the row's messages (local host); absent or failing: no note. */ loadDelivery?: (ref: string) => Promise<DeliveryInfo>;
  /** Starts the Claude sign-in; resolves to the step to run when it cannot start. */ onSignIn?: () => Promise<string | null>;
}

export function NowChat({ taskRef, pickKey = taskRef, busy, agent: owner, team = [], agentOf, onSend, loadThread, onOpenSession, tick, loadDelivery, onSignIn }: NowChatProps) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | undefined>(() => loadPick(store(), pickKey));
  const pick = team.find((a) => a.slug === picked && a.slug !== owner?.slug);
  const agent: (AvatarWho & { slug?: string }) | null = pick ?? owner;
  /** Picking the owner again clears the pick. */
  const choose = (slug: string) => { const v = slug === owner?.slug ? undefined : slug; savePick(store(), pickKey, v); setPicked(v); };
  const [items, setItems] = useState<ReturnType<typeof tellThread>>([]);
  const [session, setSession] = useState<Thread['session']>();
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [signInStep, setSignInStep] = useState<string | null>(null);
  const seq = useRef(0); // only the latest load replaces the thread
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try { const t = await loadThread(taskRef); if (mine === seq.current) { setItems(tellThread(t.items)); setSession(t.session); } } catch { /* keep what shows */ }
    if (loadDelivery) { try { const d = await loadDelivery(taskRef); if (mine === seq.current) setDelivery(d); } catch { if (mine === seq.current) setDelivery(null); } }
  }, [taskRef, loadThread, loadDelivery]);
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
      if (await onSend(t, pick?.slug)) {
        // Clear only what was sent: text typed while the send was in flight stays.
        setText((cur) => { if (cur !== sent) return cur; const el = document.getElementById('now-msg'); if (el) el.style.height = ''; return ''; });
        void load();
      }
    } finally { sending.current = false; }
  };
  /** Grows with the text where `field-sizing` is missing (Safari, Firefox). */
  const grow = (el: HTMLTextAreaElement) => { if (CSS.supports?.('field-sizing', 'content')) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  const now = new Date();
  const note = deliveryNote(delivery, items[items.length - 1]);
  const live = liveLink(delivery);
  return (
    <section class="now-chat" aria-label={`Messages with ${label}`} data-testid="now-chat">
      {items.length > 0 && (
        <ol class="now-thread" data-testid="now-thread">
          {items.map((i) => {
            const who = i.kind === 'agent' ? agentOf(i.agent) : null;
            // An older message went to the owner, whatever is picked now.
            const to = i.kind === 'owner' && i.agent ? nameBeside(agentOf(i.agent)) : owner ? nameBeside(owner) : 'the agent';
            return (
              <li key={i.id} class={`now-bubble ${who ? 'from-agent' : 'from-me'}`}>
                {who && <Avatar who={who} size={28} />}
                <div class="now-bubble-body">
                  <span class="now-bubble-who">{who ? nameBeside(who) : `You to ${to}`}{i.at && <> · <time dateTime={i.at}>{ago(i.at, now)}</time></>}</span>
                  <p class="now-bubble-text">{unescapeMd(i.text)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {note?.kind === 'working' && agent && (
        <p class="now-bubble from-agent now-working" data-testid="now-working" aria-live="polite"><Avatar who={agent} size={28} /><span class="now-bubble-body"><span class="now-bubble-who">{nameBeside(agent)}</span><span class="now-bubble-text">working…</span></span></p>
      )}
      {note?.kind === 'failed' && (
        <p class="now-undelivered" data-testid="now-undelivered" role="status">{note.text}
          {note.signIn && onSignIn && <> <button type="button" class="now-live" onClick={() => { void onSignIn().then((step) => setSignInStep(step)); }}>Sign in</button></>}
          {signInStep && <> Run <code>{signInStep}</code> in Terminal.</>}
        </p>
      )}
      {note?.kind === 'off' && <p class="now-undelivered" data-testid="now-undelivered" role="status">Not delivered: agent delivery is off (set inbox.delivery to "claude")</p>}
      {!note && items.length > 0 && items[items.length - 1].kind === 'owner' && (
        <p class="now-awaits" data-testid="now-awaits">{name === 'the agent' ? 'The agent' : name} replies here</p>
      )}
      <form class="now-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {/* Who the box talks to, above the field. @req FR:now-screen/now.compose */}
        <AgentPicker agent={agent} owner={owner} team={team} onPick={choose} />
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
      {live && !(session && session.state !== 'stale') && <a class="now-live" href={live} data-testid="now-live-session">Send to live session</a>}
    </section>
  );
}

/**
 * The recipient chip: avatar and name; tap opens a searchable list of the whole team, recent first.
 * @req FR:product-reset/ui.thread @req FR:product-reset/ui.agentchip
 */
function AgentPicker({ agent, owner, team, onPick }: { agent: (AvatarWho & { slug?: string }) | null; owner: (AvatarWho & { slug?: string }) | null; team: TeamAgent[]; onPick: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = open ? pickerList(team, { recent: loadRecent(store()), query }) : [];
  useLayoutEffect(() => {
    if (!open) return;
    search.current?.focus();
    const out = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);
  const close = (focus = true) => { setOpen(false); setQuery(''); if (focus) chip.current?.focus(); };
  const choose = (slug: string) => { onPick(slug); close(); };
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const move = (by: number) => { const all = items(); const i = all.indexOf(document.activeElement as HTMLElement); const next = all[i + by]; if (next) next.focus(); else if (i + by < 0) search.current?.focus(); };
  const canPick = team.length > 0;
  return (
    <div class="now-pick" ref={root} data-c="AgentChip" data-agent={agent?.slug}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}>
      <button ref={chip} type="button" class="now-to" data-testid="now-to" disabled={!canPick} aria-haspopup="listbox" aria-expanded={open}
        title={canPick ? 'To: tap to send to another agent' : undefined}
        onClick={() => (open ? close() : setOpen(true))}>
        {agent && <Avatar who={agent} size={28} />}<span class="now-to-name">{agent ? nameBeside(agent) : 'The agent'}</span>
      </button>
      {open && (
        <div class="now-pick-pop" role="dialog" aria-label="Pick an agent">
          <input ref={search} type="search" class="now-pick-find" value={query} placeholder="Find an agent" aria-label="Find an agent" aria-controls="now-pick-list"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (list[0]) choose(list[0].slug); } }} />
          <ul id="now-pick-list" class="now-pick-list" role="listbox" aria-label="Agents">
            {list.map((a) => (
              <li key={a.slug} role="option" tabIndex={-1} aria-selected={a.slug === agent?.slug} data-agent={a.slug} class={a.slug === agent?.slug ? 'on' : ''}
                onClick={() => choose(a.slug)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(a.slug); } }}>
                <Avatar who={a} size={24} />
                <span class="now-pick-name">{nameBeside(a)}{a.slug === owner?.slug && <span class="now-pick-owner"> · owner</span>}</span>
                {a.role && <span class="now-pick-role">{a.role}</span>}
              </li>
            ))}
            {list.length === 0 && <li class="now-pick-none" role="presentation">No agent matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
