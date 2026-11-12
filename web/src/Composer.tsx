/**
 * The shared message composer: who (avatar chips, owner first, others behind `+ Other agent`), what, and Ask | Do it.
 * @req FR:task-detail-design/compose.to @req FR:task-detail-design/compose.text @req FR:task-detail-design/compose.mode
 * @req FR:task-detail-design/compose.doit @req FR:task-detail-design/compose.nokeep @req FR:task-detail-design/a11y.names
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './AgentAvatar';
import { displayName, modeHint, type Mode } from './detail';
import { ownerOf, type TeamAgent } from './team';

/** A thread note is saved through /inbox first: its text limit applies. */
const MAX = 1000;

export interface ComposerProps {
  /** Agents for the task, owner first. */
  agents: TeamAgent[];
  /** No runner: Ask saves on the task; Do it is off. */
  offline: boolean;
  busy?: boolean;
  /** Focus the box on mount (the row's message button). */
  autoFocus?: boolean;
  onAsk: (text: string, agent: string) => Promise<boolean>;
  onDo: (text: string, agent: string) => Promise<boolean>;
}

/** The task's owner (`ownerOf`) first, then the rest in order. */
export function ownerFirst(agents: TeamAgent[]): TeamAgent[] {
  const owner = ownerOf(agents);
  return owner ? [owner, ...agents.filter((a) => a !== owner)] : [];
}

export function Composer({ agents: raw, offline, busy: outer = false, autoFocus = false, onAsk, onDo }: ComposerProps) {
  const agents = ownerFirst(raw);
  const [to, setTo] = useState(agents[0]?.slug ?? '');
  const [shown, setShown] = useState<string[]>(agents[0] ? [agents[0].slug] : []);
  const [mode, setMode] = useState<Mode>('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (!agents.some((a) => a.slug === to) && agents[0]) { setTo(agents[0].slug); setShown([agents[0].slug]); } }, [agents.map((a) => a.slug).join(), to]);
  useLayoutEffect(() => {
    if (!picking) return;
    pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const out = (e: MouseEvent) => { if (!pop.current?.parentElement?.contains(e.target as Node)) setPicking(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [picking]);
  const chosen = agents.find((a) => a.slug === to);
  const name = chosen ? displayName(chosen) : 'the agent';
  const none = agents.length === 0;
  const others = agents.filter((a) => !shown.includes(a.slug));
  const canSend = !none && !busy && !outer && (mode === 'ask' ? !!text.trim() : !offline);
  const send = async () => {
    if (!canSend || !chosen) return;
    setBusy(true);
    try { if (await (mode === 'ask' ? onAsk(text.trim(), chosen.slug) : onDo(text.trim(), chosen.slug))) setText(''); } finally { setBusy(false); }
  };
  const pick = (slug: string) => { setTo(slug); setShown((s) => (s.includes(slug) ? s : [...s, slug])); setPicking(false); setTimeout(() => box.current?.focus(), 0); };
  const seg = (m: Mode) => ({
    role: 'radio' as const, 'aria-checked': mode === m, tabIndex: mode === m ? 0 : -1, type: 'button' as const, onClick: () => setMode(m),
    onKeyDown: (e: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const n: Mode = m === 'ask' ? 'do' : 'ask'; setMode(n); ((e.currentTarget as HTMLElement).parentElement?.querySelector(`[data-mode="${n}"]`) as HTMLElement | null)?.focus(); } },
  });
  return (
    <div class="fl composer" role="group" aria-label="Message" onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Tab') return; e.stopPropagation(); if (e.key === 'Escape') { if (picking) { setPicking(false); more.current?.focus(); } else (document.activeElement as HTMLElement | null)?.blur(); } }}>
      <div class="cm-to" role="group" aria-label="To">
        {agents.filter((a) => shown.includes(a.slug)).map((a) => (
          <button key={a.slug} type="button" class="fl-chip" aria-pressed={a.slug === to} title={a.role} onClick={() => setTo(a.slug)}>
            <Avatar who={{ slug: a.slug, name: displayName(a), icon: a.icon }} size={24} /><span>{displayName(a)}</span>
          </button>
        ))}
        {others.length > 0 && (
          <span class="fl-pop-wrap">
            <button ref={more} type="button" class="fl-chip add" aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>+ Other agent</button>
            {picking && (
              <div ref={pop} class="fl-popover" role="menu" aria-label="Other agents"
                onKeyDown={(e) => { const l = [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]; const i = l.indexOf(document.activeElement as HTMLElement); if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length]?.focus(); } }}>
                {others.map((a) => (
                  <button key={a.slug} type="button" role="menuitem" class="fl-option" onClick={() => pick(a.slug)}>
                    <Avatar who={{ slug: a.slug, name: displayName(a), icon: a.icon }} size={24} /><span>{displayName(a)}{a.role && a.role !== displayName(a) ? <span class="cm-role"> · {a.role}</span> : null}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
        {none && <span class="fl-hint">No agent covers this task</span>}
      </div>
      <div class="cm-mode">
        <div class="fl-seg" role="radiogroup" aria-label={`What should ${name} do?`}>
          <button {...seg('ask')} data-mode="ask">Ask</button>
          <button {...seg('do')} data-mode="do">Do it</button>
        </div>
        <p class="fl-hint" data-testid="mode-hint">{offline && mode === 'do' ? 'Runs in stack web on your machine; Ask still saves on the task.' : modeHint(mode, name)}</p>
      </div>
      <form class="cm-send" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input ref={box} type="text" class="fl-input" value={text} maxLength={MAX} disabled={none} aria-label={`Message ${name}`}
          placeholder={none ? 'No agent covers this task' : `Message ${name}…`}
          onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button type="submit" class="fl-btn primary" disabled={!canSend}>{mode === 'ask' ? 'Ask' : 'Do it'}</button>
      </form>
    </div>
  );
}
