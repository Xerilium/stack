/**
 * The thread inside the expanded task: entries in time order, asks answerable in place, the composer at the bottom.
 * @req FR:agent-thread/web.expand @req FR:agent-thread/web.hero @req FR:agent-thread/web.keys @req FR:agent-thread/web.a11y
 */
import { actionsFor, type AskItem } from './asks';
import { AgentTalk } from './AgentTalk';
import { foldSubtasks, verdictLine, whoLine } from './thread';
import type { ThreadCtl } from './useThread';
import type { Team } from './useTeam';
import type { Task } from './types';

const ANSWERED: Record<string, string> = { go: 'Approved', no: 'Rejected', option: 'Chose', reply: 'Replied', ask: 'Asked', done: 'Done' };

function AskEntry({ a, th }: { a: AskItem; th: ThreadCtl }) {
  const actions = actionsFor(a).filter((x) => x.send);
  return (
    <div class="th-ask" data-key={a.key}>
      <p class="th-text">{a.ask}</p>
      {a.why && <p class="th-why">{a.why}</p>}
      {a.state === 'open' ? (
        <div class="th-actions">
          {actions.map((x) => <button type="button" key={x.id} class={`btn${x.primary ? ' primary' : ''}`} onClick={(e) => { e.stopPropagation(); void th.answer(a.key, x.send!, `Sent to ${a.from}`); }}>{x.label}</button>)}
          <a href="#/asks" class={`btn${actions.length ? ' quiet' : ''}`} onClick={(e) => e.stopPropagation()}>Reply in Asks</a>
        </div>
      ) : <p class="th-state">{ANSWERED[a.answer ?? ''] ?? 'Answered'}{a.text ? `: ${a.text}` : ''}</p>}
    </div>
  );
}

export function ThreadView({ t, th, team, now }: { t: Task; th: ThreadCtl; team: Team; now: Date }) {
  const name = (slug: string) => team.team.find((a) => a.slug === slug || a.name === slug)?.name ?? slug;
  const agents = team.agentsOf(t);
  const items = foldSubtasks(th.thread.items);
  const lastAgent = [...th.thread.items].reverse().find((i): i is Extract<typeof i, { kind: 'agent' }> => i.kind === 'agent');
  const running = th.thread.session?.state === 'running' || th.thread.session?.state === 'needs-you';
  return (
    <section class="thread" aria-label="Agent thread" onClick={(e) => e.stopPropagation()}>
      {th.phase === 'loading' && items.length === 0 && <p class="th-note">Loading…</p>}
      {th.phase === 'error' && <p class="th-note err">Cannot load the thread. <button type="button" class="link" onClick={() => void th.reload()}>Retry</button></p>}
      {items.length > 0 && <p class="th-head" id={`th-head-${t.ref}`}>Agent thread</p>}
      {items.length > 0 && (
        <ol class="th-items" aria-labelledby={`th-head-${t.ref}`}>
          {items.map((i) => (
            <li key={i.kind === 'ask' ? i.ask.key : 'id' in i ? i.id : `${i.kind}-${i.at}`} class={`th-item ${i.kind}`}>
              <p class="th-meta">{whoLine(i, now, name)}</p>
              {i.kind === 'owner' && <p class="th-text you">{i.text}</p>}
              {i.kind === 'agent' && <p class="th-text">{i.text}</p>}
              {i.kind === 'review' && <p class={`th-text verdict ${i.verdict}`}>{verdictLine(i)}</p>}
              {i.kind === 'ask' && <AskEntry a={i.ask} th={th} />}
            </li>
          ))}
        </ol>
      )}
      {th.phase === 'ready' && items.length === 0 && <p class="th-note">No thread yet. Ask the agent anything, or assign the task.</p>}
      {/* One live line announces the newest agent reply (not the owner's own words or state flips). @req FR:agent-thread/web.a11y */}
      <p class="sr-only" role="status" aria-live="polite">{lastAgent ? `${name(lastAgent.agent)}: ${lastAgent.text}` : ''}</p>
      {running && th.thread.session && <p class="th-note live" role="status"><span class="dot" aria-hidden="true" />{th.thread.session.state === 'needs-you' ? 'Waiting for you in Asks' : 'Working…'} · <button type="button" class="link" onClick={() => team.openSession(t.ref)}>Open the session</button></p>}
      <AgentTalk team={team} talk={{ ref: t.ref, project: t.project, about: t.text }} agents={agents} mode="thread" busy={th.busy}
        onAsk={(text, agent, keep) => th.ask(text, agent, keep)} onAssign={(agent, keep) => th.assign(agent, keep)} />
    </section>
  );
}
