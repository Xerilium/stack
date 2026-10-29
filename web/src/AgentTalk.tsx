/**
 * AI on every page: the agent chip on a row and the inline composer under it.
 * @req FR:agent-team/web.chip @req FR:agent-team/web.talk @req FR:agent-team/web.anything @req FR:agent-team/web.review @req FR:agent-team/web.norunner @req FR:agent-team/web.keys @req FR:agent-team/web.a11y
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { QUICK, type ChipView, type Talk, type TeamAgent } from './team';
import type { Team } from './useTeam';
import './team.css';

export function AgentChip({ view, onClick, onNeeds }: { view: ChipView; onClick: () => void; onNeeds?: () => void }) {
  return (
    <span class="agent-slot">
      <button type="button" class={`chip agent-chip ${view.tone}${view.state ? ' state' : ''}`} title={view.title} aria-label={`Agent: ${view.text}. ${view.title}`} onClick={(e) => { e.stopPropagation(); if (view.needs && onNeeds) onNeeds(); else onClick(); }}>
        {(view.tone === 'accent' || view.tone === 'warn') && <span class="dot" aria-hidden="true" />}
        <span>{view.text}</span>
      </button>
    </span>
  );
}

/** The composer: who, what, send. Only one is open at a time (the hook holds it). @req FR:agent-team/web.talk */
export function AgentTalk({ team, talk, agents, float = false }: { team: Team; talk: Talk; agents: TeamAgent[]; float?: boolean }) {
  const [agent, setAgent] = useState(agents[0]?.slug ?? '');
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(agents[0]?.mode === 'long-running');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  // Focus before paint: a key typed right after `a` must land in the box, not on the row.
  useLayoutEffect(() => { box.current?.focus(); }, []);
  useEffect(() => { if (!agents.some((a) => a.slug === agent)) { setAgent(agents[0]?.slug ?? ''); setKeep(agents[0]?.mode === 'long-running'); } }, [agents, agent]);
  const chosen = agents.find((a) => a.slug === agent);
  const none = agents.length === 0;
  const offline = team.enabled !== true;
  const close = () => { team.setTalk(null); setTimeout(() => (talk.ref ? document.querySelector<HTMLElement>(`.row[data-ref="${CSS.escape(talk.ref)}"]`) : null)?.focus?.(), 0); };
  const send = async (t = text) => {
    if (busy || none || !t.trim()) return;
    setBusy(true);
    try { if (await team.start(talk, agent, t.trim(), keep)) setText(''); } finally { setBusy(false); }
  };
  const quick = (id: 'review' | 'do' | 'plan') => {
    if (id === 'review') { if (talk.ref) void team.review(talk.ref, agent); return; }
    void send(QUICK.find((q) => q.id === id)!.text);
  };
  return (
    <div ref={root} class={`agent-talk${float ? ' float' : ''}`} role="group" aria-label={`Talk to ${chosen?.name ?? 'an agent'} about ${talk.about}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
      <div class="talk-row">
        <label class="talk-to">To
          <select value={agent} aria-label="Agent" disabled={none} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setAgent(v); setKeep(agents.find((a) => a.slug === v)?.mode === 'long-running'); }}>
            {none ? <option value="">No agent</option> : agents.map((a) => <option key={a.slug} value={a.slug} title={a.role}>{a.name}</option>)}
          </select>
        </label>
        {float && <span class="talk-about">About: {talk.about}</span>}
        <span class="grow" />
        <label class="talk-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep((e.target as HTMLInputElement).checked)} /> Keep open</label>
        <button type="button" class="btn quiet close" onClick={close} aria-label="Close" title="Close (Esc)">×</button>
      </div>
      <form class="talk-row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input ref={box} type="text" value={text} maxLength={4000} aria-label={`Message ${chosen?.name ?? 'the agent'}`} placeholder={none ? 'No agent covers this task' : offline ? 'Runs in stack web on your machine' : 'Ask anything…'} disabled={none || offline}
          onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button type="submit" class={`btn${text.trim() ? ' primary' : ''}`} disabled={none || offline || busy || !text.trim()}>Send<kbd aria-hidden="true">⏎</kbd></button>
      </form>
      {(talk.ref || offline) && <div class="talk-row quick">
        {QUICK.filter(() => !!talk.ref).map((q) => (
          <button type="button" key={q.id} class="btn" disabled={none || offline || busy} title={q.id === 'review' ? 'Can the agent do this task? What does it need from you?' : q.id === 'do' ? 'Hand the task to the agent' : 'Steps and estimates, no work yet'} onClick={() => quick(q.id)}>{q.label}</button>
        ))}
        {offline && <span class="talk-note">Runs in <code>stack web</code> on your machine</span>}
      </div>}
    </div>
  );
}
