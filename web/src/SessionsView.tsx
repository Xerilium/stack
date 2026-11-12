/**
 * The Agents view: the team as a tree (or by project, or flat), each session a row, a usage strip, a drawer to read, message and watch one,
 * and an agent-first, prompt-first composer for a new session.
 * @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.usage @req FR:agent-sessions/web.usage.panel @req FR:agent-sessions/web.usage.price
 * @req FR:agent-sessions/web.new @req FR:agent-sessions/web.new.submit @req FR:agent-sessions/web.new.context @req FR:agent-sessions/web.states @req FR:agent-sessions/web.keys @req FR:agent-sessions/web.a11y
 * @req FR:agent-sessions/web.scope @req FR:agent-sessions/web.scope.all @req FR:agent-sessions/web.order @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups
 * @req FR:agent-team/org.tree @req FR:agent-team/org.tree.row @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched @req FR:agent-team/org.tree.pinned @req FR:agent-team/org.tree.phone
 * @req FR:agent-team/org.keys @req FR:agent-team/org.a11y @req FR:agent-team/compose.agent @req FR:agent-team/compose.agent.filter @req FR:agent-team/compose.folder @req FR:agent-team/compose.prompt @req FR:agent-team/compose.after
 */
import { Avatar } from './AgentAvatar';
import { nameBeside } from './avatar';
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { agentStatus, chartOrder, chatsFor, orgChart, otherSessions, type ChartNode } from './chart';
import { composeDefault, folderFor, orderAgents, repoRoot } from './org';
import { groupByProject, orderWithPins, type Pins } from './pins';
import { barWidths, dayLabel, fmtTokens, groupTurns, localDay, orderSessions, priceLine, rowOf, scopeSessions, splitSessions, usageStrip, type Line, type SessionItem } from './sessions';
import { matchAgent, nameKey, rollupOf, type TeamAgent } from './team';
import type { Sessions } from './useSessions';
import { feedbackActive } from './FeedbackPanel';
import './sessions.css';

const TOP = 20;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
const MARK: Record<string, string> = { pending: '…', in_progress: '…', completed: '✓', failed: '✕', cancelled: '–' };
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Row({ s, now, cursor, pinned, level = 0, onOpen, onCursor, onPin }: { s: SessionItem; now: Date; cursor: boolean; pinned: boolean; level?: number; onOpen: () => void; onCursor: () => void; onPin: () => void }) {
  const r = rowOf(s, now);
  return (
    <li class={`sess-li${cursor ? ' cursor' : ''}${pinned ? ' pinned' : ''}`} data-id={s.id} data-state={s.state} role={level ? 'treeitem' : undefined} aria-level={level ? level + 1 : undefined} data-level={level || undefined} style={level ? { '--level': level } : undefined}>
      <button type="button" class="sess-row" onClick={onOpen} onMouseEnter={onCursor} aria-label={`${s.title}, ${r.label}, ${r.where}, ${r.when}, ${r.usage} tokens`}>
        <span class="sess-state"><span class="dot" aria-hidden="true" />{r.label}</span>
        <span class="sess-title">{pinned && <span class="pin-mark" aria-hidden="true">★ </span>}{s.title}</span>
        <span class="sess-where">{r.where}</span>
        <span class="sess-when">{r.when}</span>
        <span class="sess-cost">{r.usage}</span>
        <span class="sess-mob" aria-hidden="true">{r.when} · {r.usage}</span>
      </button>
      <button type="button" class={`pin${pinned ? ' on' : ''}`} aria-label={pinned ? 'Unpin' : 'Pin'} title={pinned ? 'Unpin (f)' : 'Pin: always shown (f)'} onClick={(e) => { e.stopPropagation(); onPin(); }}>{pinned ? '★' : '☆'}</button>
    </li>
  );
}

/** One agent card in the chart: avatar, name, role, projects (else its home), status, chat count. The whole card selects it. @req FR:agents-team/chart.card */
function AgentCard({ agent, chats, on, onPick }: { agent: TeamAgent; chats: SessionItem[]; on: boolean; onPick: () => void }) {
  const status = agentStatus(chats);
  const state = status === 'needs-you' || status === 'running' ? status : '';
  const label = status === 'needs-you' ? 'needs you' : status === 'running' ? 'working' : status === 'idle' ? 'idle' : 'no session';
  const role = agent.role && agent.role.toLowerCase() !== agent.name.toLowerCase() ? agent.role : '';
  const where = agent.projects.length ? agent.projects : agent.home ? [agent.home] : [];
  return (
    <button type="button" class={`agent-card${on ? ' on' : ''}`} data-agent={agent.slug} data-state={state || undefined} aria-pressed={on} onClick={onPick}
      data-status={status} aria-label={`${agent.name}${role ? `, ${role}` : ''}${where.length ? `, ${where.join(', ')}` : ''}, ${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}, ${label}`}>
      <span class="ac-head"><Avatar who={agent} size={22} /><span class="ac-name">{nameBeside(agent)}</span>{state && <span class={`ac-dot ${state}`} title={label} aria-hidden="true" />}</span>
      {role && <span class="ac-role">{role}</span>}
      <span class="ac-foot">
        <span class="ac-projects" aria-hidden="true">{agent.scope.includes('*') ? <span class="chip">all projects</span> : where.slice(0, 2).map((p) => <span class="chip" key={p}>{p}</span>)}{where.length > 2 && !agent.scope.includes('*') && <span class="chip">+{where.length - 2}</span>}</span>
        <span class="ac-chats" aria-hidden="true"><span class={`ac-status ${status}`}>{label}</span>{chats.length > 0 && ` · ${chats.length}`}</span>
      </span>
    </button>
  );
}

/** The org chart: each node is a card, its reports in a row (a rail on a phone) beneath it. @req FR:agents-team/chart.tree @req FR:agents-team/chart.layout */
function Chart({ nodes, sel, chatsOf, onPick }: { nodes: ChartNode[]; sel: string; chatsOf: (a: TeamAgent) => SessionItem[]; onPick: (slug: string) => void }) {
  return (
    <ul class="chart">
      {nodes.map((n) => (
        <li key={n.agent.slug} class="chart-node">
          <AgentCard agent={n.agent} chats={chatsOf(n.agent)} on={n.agent.slug === sel} onPick={() => onPick(n.agent.slug)} />
          {n.children.length > 0 && <Chart nodes={n.children} sel={sel} chatsOf={chatsOf} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}

/** A text turn; long ones (a session's opening brief) clamp to six lines with Show more. */
function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 480;
  return (
    <div class={`turn ${role}`}>
      <p class={`tl ${role}${long && !more ? ' clamp' : ''}`}>{text}</p>
      {long && <button type="button" class="more-link" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

function TranscriptLine({ l }: { l: Line }) {
  if (l.kind === 'text') return <p class={`tl ${l.role}`}>{l.text}</p>;
  return <p class={`tl tool ${l.status}`} title={l.output}><span class="mark" aria-hidden="true">⚙</span><span class="tool-title">{l.title}</span><span class="status">{MARK[l.status]}</span></p>;
}

const NONE = '';
/** The agent chooser: a filterable list, the chosen one shown as the field value. @req FR:agent-team/compose.agent @req FR:agent-team/compose.agent.filter */
function AgentPicker({ agents, value, onPick }: { agents: TeamAgent[]; value: string; onPick: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const chosen = agents.find((a) => a.slug === value);
  const k = nameKey(q);
  const list: TeamAgent[] = [...agents.filter((a) => !k || [a.name, a.slug, a.role ?? '', ...a.projects].some((x) => nameKey(x).includes(k))), { slug: NONE, name: 'No agent (plain session)', role: 'No persona; runs in the folder below', scope: [], mode: 'ad-hoc', prompt: '', defined: false, source: 'metadata', projects: [] }];
  const pick = (slug: string) => { onPick(slug); setOpen(false); setQ(''); };
  return (
    <div class={`agent-pick${open ? ' open' : ''}`}>
      <label class="pick-label">Agent
        <input type="text" role="combobox" aria-label="Agent" aria-expanded={open} aria-controls="agent-pick-list" aria-autocomplete="list" value={open ? q : (chosen?.name ?? 'No agent (plain session)')}
          placeholder="Type to filter" onFocus={() => { setOpen(true); setHi(0); }} onBlur={() => setTimeout(() => setOpen(false), 120)} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setHi(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); const a = list[hi]; if (a) pick(a.slug); }
            else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); }
          }} />
      </label>
      {open && (
        <ul id="agent-pick-list" role="listbox" class="pick-list" aria-label="Agents">
          {list.map((a, i) => (
            <li key={a.slug || '_none'} role="option" aria-selected={a.slug === value} class={`${i === hi ? 'hi' : ''}${a.slug === value ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(a.slug); }} onMouseEnter={() => setHi(i)}>
              <span class="pick-name">{a.name}</span>
              {a.role && <span class="pick-role">{a.role}</span>}
              {a.projects.length > 0 && <span class="pick-projects">{a.scope.includes('*') ? 'all projects' : a.projects.slice(0, 3).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Drawer({ s, item, cursorItem, team = [], onClose, defaultAgent, inline = false }: { s: Sessions; /** Painted in the page under the chart, not as an overlay. @req FR:agents-team/chat.show */ inline?: boolean; item: SessionItem | null; cursorItem: SessionItem | null; team?: TeamAgent[]; onClose: () => void; /** The composer's preselected agent slug. */ defaultAgent?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const isNew = s.composing;
  const [agent, setAgentState] = useState(() => (isNew ? (defaultAgent ?? rollupOf(team)?.slug ?? NONE) : NONE));
  const chosen = team.find((a) => a.slug === agent);
  const [cwd, setCwd] = useState(() => (isNew ? (chosen ? folderFor(chosen, s.items, team) : (item?.cwd ?? cursorItem?.cwd ?? '')) : ''));
  const [editCwd, setEditCwd] = useState(() => isNew && !chosen);
  /** Choosing an agent sets the folder from its project. @req FR:agent-team/compose.folder */
  const setAgent = (slug: string) => { setAgentState(slug); const a = team.find((x) => x.slug === slug); setCwd(a ? folderFor(a, s.items, team) : (cursorItem?.cwd ?? '')); setEditCwd(!a); box.current?.focus(); };
  useEffect(() => { if (!inline) box.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [s.turns, s.transcript]);
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>('button, a[href], textarea, input')].filter((x) => !x.hasAttribute('disabled'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const submit = async () => {
    if (!text.trim()) return;
    // A plain session needs a folder; an agent session may run in the served folder. @req FR:agent-team/compose.prompt
    // The project is the one the chosen folder belongs to when the agent covers it, else its first. @req FR:agent-team/compose.prompt
    const folderOwner = s.items.find((x) => cwd.trim() && repoRoot(x.cwd) === repoRoot(cwd.trim()))?.owner ?? null;
    const project = chosen && !chosen.scope.includes('*') ? (folderOwner && chosen.projects.includes(folderOwner) ? folderOwner : chosen.projects[0]) : undefined;
    const ok = isNew ? await s.start(cwd.trim() || undefined, text, chosen ? { agent: chosen.slug, ...(project ? { project } : {}) } : undefined) : await s.send(text);
    if (ok) setText('');
  };
  const running = s.streaming || item?.state === 'running';
  const title = isNew ? 'New session' : (item?.title ?? 'Session');
  const r = item ? rowOf(item, s.now) : null;
  const facts = item && r && !isNew ? [r.label, r.when, item.project, item.branch, `${r.usage} tokens`].filter(Boolean).join(' · ') : '';
  const cwds = [...new Set(s.items.map((x) => x.cwd))];
  const runsIn = cwd.trim() ? cwd.trim().replace(/^.*\//, '') : 'the served folder';
  const canStart = !!text.trim() && (!!chosen || !!cwd.trim()) && !(running && !s.transcript.done);
  return (
    <aside ref={ref} class={`sess-drawer${isNew ? ' new' : ''}${inline ? ' inline' : ''}`} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : 'true'} aria-label={title} onKeyDown={inline ? undefined : trap}>
      <header class="drawer-head">
        <div class="drawer-titles"><h2>{title}</h2>{facts && <p class="facts">{facts}</p>}</div>
        {!inline && <button type="button" class="btn quiet" onClick={onClose} aria-label="Close">Close<kbd aria-hidden="true">Esc</kbd></button>}
      </header>
      {isNew ? (
        // Prompt first, the agent above it, the folder as a fact under it. @req FR:agent-sessions/web.new @req FR:agent-team/compose.prompt
        <form class="compose new" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {team.length > 0 && <AgentPicker agents={team} value={agent} onPick={setAgent} />}
          <textarea ref={box} rows={6} value={text} maxLength={4000} aria-label="First prompt" placeholder={chosen ? `Brief ${chosen.name}. ${mac ? '⌘' : 'Ctrl+'}Enter starts; Enter is a new line` : `What should it do? ${mac ? '⌘' : 'Ctrl+'}Enter starts`}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } else if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
          {editCwd ? (
            <label class="cwd-field">Folder
              <input type="text" list="sess-cwds" value={cwd} placeholder="/absolute/path/to/repo" onInput={(e) => setCwd((e.target as HTMLInputElement).value)} aria-label="Folder" />
              <datalist id="sess-cwds">{cwds.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
          ) : (
            <p class="cwd-fact" data-testid="runs-in">Runs in <code title={cwd || undefined}>{runsIn}</code> <button type="button" class="link" onClick={() => setEditCwd(true)}>Change</button></p>
          )}
          {s.sendError && <p class="drawer-note err" role="alert">{s.sendError}</p>}
          <div class="compose-actions">
            <button type="submit" class="btn primary" disabled={!canStart}>Start<kbd aria-hidden="true">{mac ? '⌘⏎' : 'Ctrl+⏎'}</kbd></button>
          </div>
        </form>
      ) : (
        <Fragment>
          <div class="drawer-body">
            {s.turnsError && <p class="drawer-note err">{s.turnsError}</p>}
            {s.turnsLoading && s.turns.length === 0 && <div class="turns" aria-busy="true"><p class="sk" /><p class="sk short" /><p class="sk" /></div>}
            <div class="turns">
              {groupTurns(s.turns).map((t, i) => (t.kind === 'tools' ? <p key={i} class="tl tools" title={t.titles.join('\n')}><span class="mark" aria-hidden="true">⚙</span><span class="count">{t.count} tool {t.count === 1 ? 'call' : 'calls'}</span><span class="tools-list"> · {t.summary}</span></p> : <Bubble key={i} role={t.role} text={t.text} />))}
            </div>
            <div class="stream" aria-live="off">
              {s.transcript.lines.map((l, i) => <TranscriptLine key={i} l={l} />)}
            </div>
            <p class="sr-only" role="status" aria-live="polite">{s.transcript.lines.filter((l) => l.kind === 'tool').map((l) => (l.kind === 'tool' ? `${l.title} ${l.status}` : '')).slice(-1)[0] ?? ''}</p>
            {s.transcript.waiting && <p class="drawer-note wait" role="status">Waiting for you: {s.transcript.waiting.title} · <a href="#/asks">Open in Asks</a></p>}
            {s.transcript.done && <p class={`drawer-note done${s.transcript.done.error ? ' err' : ''}`} role="status">{s.transcript.done.text}</p>}
            {item?.state === 'needs-you' && !s.transcript.waiting && <p class="drawer-note wait"><a href="#/asks">Answer in Asks</a></p>}
            {running && !s.transcript.done && <p class="drawer-note live" role="status"><span class="dot" aria-hidden="true" />Working…</p>}
            <div ref={end} />
          </div>
          <footer class="drawer-foot">
            {s.sendError && <p class="drawer-note err" role="alert">{s.sendError}</p>}
            <form class="compose" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <textarea ref={box} rows={2} value={text} maxLength={4000} aria-label={`Message ${item?.title ?? 'the session'}`} placeholder="Message this session. Enter sends, Shift+Enter for a new line"
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } else if (e.key === 'Escape') { e.stopPropagation(); if (inline) (e.target as HTMLElement).blur(); else onClose(); } }} />
              <div class="compose-actions">
                {running && !s.transcript.done ? <button type="button" class="btn" onClick={() => void s.stop()}>Stop<kbd aria-hidden="true">s</kbd></button> : null}
                <button type="submit" class="btn primary" disabled={!text.trim() || (running && !s.transcript.done)}>Send<kbd aria-hidden="true">⏎</kbd></button>
              </div>
            </form>
          </footer>
        </Fragment>
      )}
    </aside>
  );
}

export interface SessionsViewProps { s: Sessions; enabled: boolean | null; pinsCtl: Pins; /** The team, for the tree, the match, and the composer. */ team?: TeamAgent[]; /** Project name → priority rank (the Home order). @req FR:agent-sessions/web.order.project */ projectRank?: Map<string, number> }

export function SessionsView({ s, enabled, pinsCtl, team = [], projectRank = new Map() }: SessionsViewProps) {
  const { cursor } = s;
  const { pins, pin, mode, setMode } = pinsCtl;
  const hasTeam = team.length > 0;
  /** My team (chart + chat) is the default; anything else is Other sessions. @req FR:agents-team/other.toggle */
  const chartMode = mode === 'team' && hasTeam;
  const chart = useMemo(() => (chartMode ? orgChart(team, projectRank) : []), [chartMode, team, projectRank]);
  const chartKeys = useMemo(() => chartOrder(chart), [chart]);
  const [selState, setSel] = useState<string | null>(null);
  const sel = selState && chartKeys.includes(selState) ? selState : (chartKeys[0] ?? '');
  const selAgent = team.find((a) => a.slug === sel);
  const chatsOf = (a: TeamAgent) => chatsFor(a, s.items, team);
  const chats = selAgent ? chatsOf(selAgent) : [];
  // Sessions an agent claims count as owned whatever their repo. @req FR:agent-team/org.match @req FR:agent-sessions/web.scope
  const pool = useMemo(() => (hasTeam ? otherSessions(s.items, team) : s.items), [s.items, team, hasTeam]);
  const claimed = useMemo(() => new Set(pool.filter((x) => !x.owner && matchAgent(x, team)).map((x) => x.id)), [pool, team]);
  const scoped = scopeSessions(pool, pins, claimed, s.showAll);
  const ordered = orderWithPins(orderSessions(scoped.shown, projectRank), pins);
  const split = splitSessions(ordered, TOP, s.showAll);
  const groups = mode === 'project' || (hasTeam && mode !== '') ? groupByProject(split.shown, pins, projectRank) : (pins.some((p) => split.shown.some((x) => x.id === p)) ? [{ title: 'Pinned', items: split.shown.filter((x) => pins.includes(x.id)) }, { title: '', items: split.shown.filter((x) => !pins.includes(x.id)) }] : [{ title: '', items: split.shown }]);
  const keys = chartMode ? [] : groups.flatMap((g) => g.items.map((x) => x.id));
  const count = chartMode ? chartKeys.length : keys.length;
  const item = s.items.find((i) => i.id === s.open) ?? null;
  const today = localDay(s.now);
  const strip = s.cost ? usageStrip(s.cost, today) : null;
  const widths = s.cost ? barWidths(s.cost.days) : [];
  const agentsOrdered = useMemo(() => { const r = rollupOf(team); return [...(r ? [r] : []), ...orderAgents(team.filter((a) => a !== r), projectRank, new Set(), true)]; }, [team, projectRank]);

  // The chat under the chart: the selected agent's newest chat opens when the selection changes, when the first one arrives, or when the open one is another agent's.
  // An id the list does not know yet (a session just started) is left alone.
  const chatIds = chats.map((c) => c.id).join('\n');
  useEffect(() => {
    if (!chartMode || s.phase !== 'ready' || s.composing) return;
    const known = s.items.some((i) => i.id === s.open);
    if (chats.length) { if (!s.open || (known && !chats.some((c) => c.id === s.open))) void s.openDrawer(chats[0].id); } else if (s.open && known) s.closeDrawer();
  }, [chartMode, sel, chatIds, s.phase, s.open, s.composing]);
  const inlineChat = chartMode && !s.composing && !!s.open && chats.some((c) => c.id === s.open);
  const modal = s.composing || (!!s.open && !inlineChat);

  const stopArm = useRef(0);
  const stopFromList = (id: string) => {
    const it = s.items.find((x) => x.id === id);
    if (!it) return;
    if (it.state !== 'running' && it.state !== 'needs-you') { s.note('Only sessions Stack is running can be stopped here'); return; }
    if (Date.now() - stopArm.current < 2000) { stopArm.current = 0; void s.stop(id); return; }
    stopArm.current = Date.now();
    s.note(`Press s again to stop ${it.title}`);
  };
  /** Closes the overlay and puts focus back on the row or card it came from. */
  const close = () => { const was = s.open ?? cursor; s.closeDrawer(); setTimeout(() => document.querySelector<HTMLElement>(`[data-id="${CSS.escape(was ?? '')}"] button, [data-agent="${CSS.escape(sel)}"]`)?.focus(), 0); };
  const compose = (slug?: string) => { s.setComposing(true, slug ?? (chartMode ? sel : composeDefault(cursor, team, s.items))); };
  const pick = (slug: string) => { setSel(slug); };

  // Keys act on this render's state, not the state of the render whose effect last registered the listener.
  const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || feedbackActive()) return; // @req FR:feedback-button/ui.a11y
      const k = e.key;
      if (k === 'Escape' && modal) { e.preventDefault(); close(); return; }
      if (isTyping(e.target)) return;
      if (modal) { if (k === 's') { e.preventDefault(); void s.stop(); } return; }
      if (chartMode) {
        const i = chartKeys.indexOf(sel);
        if (k === 'j' || k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); pick(chartKeys[Math.min(chartKeys.length - 1, i + 1)]); }
        else if (k === 'k' || k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); pick(chartKeys[Math.max(0, i - 1)]); }
        else if (k === 'n') { e.preventDefault(); compose(); }
        else if (k === 'c') { e.preventDefault(); s.setShowCosts(!s.showCosts); }
        else if (k === 'p') { e.preventDefault(); setMode('project'); }
        return;
      }
      const i = keys.indexOf(cursor ?? '');
      const step = (d: number) => { const n = keys[Math.max(0, Math.min(keys.length - 1, i + d))]; if (n) s.setCursor(n); };
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (k === 'Enter' && cursor) { if (e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName)) return; e.preventDefault(); void s.openDrawer(cursor); }
      else if (k === 'c') { e.preventDefault(); s.setShowCosts(!s.showCosts); }
      else if (k === 'n') { e.preventDefault(); compose(); }
      else if (k === 'A') { e.preventDefault(); s.setShowAll(!s.showAll); }
      else if (k === 'm' && split.more > 0) { e.preventDefault(); s.setShowAll(true); }
      else if (k === 's' && cursor) { e.preventDefault(); stopFromList(cursor); }
      else if (k === 'f' && cursor) { e.preventDefault(); pin(cursor); }
      else if (k === 'p') { e.preventDefault(); setMode('project'); }
      else if (k === 't' && hasTeam) { e.preventDefault(); setMode('team'); }
  };
  const latest = useRef(onKey); latest.current = onKey;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => latest.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  const keyList = keys.join('\n');
  useEffect(() => { if (keys.length && !keys.includes(cursor ?? '')) s.setCursor(keys[0]); }, [keyList, cursor]);

  const hidden = scoped.hidden;
  const hiddenNote = hidden > 0 && !s.showAll ? `${hidden} more from other repos` : s.showAll && pool.length > 0 ? 'Showing every repo' : '';
  const empty = enabled !== false && s.phase === 'ready' && count === 0;
  const ready = enabled !== false && s.phase === 'ready';
  return (
    <section class={`sess-view${chartMode ? ' team' : ''}`} aria-label="Agents">
      <header class="sess-head">
        <div><h1 class="h1">Agents</h1>{strip && <p class="cost-strip" data-testid="cost-strip"><strong>{strip.today}</strong><span class="sep">·</span><span>{strip.window}</span></p>}</div>
        <div class="sess-tools" role="group" aria-label="View">
          {hasTeam && (
            <div class="seg" role="group" aria-label="Show">
              <button type="button" class={`seg-btn${chartMode ? ' on' : ''}`} onClick={() => setMode('team')} aria-pressed={chartMode}>My team</button>
              <button type="button" class={`seg-btn${!chartMode ? ' on' : ''}`} onClick={() => setMode('project')} aria-pressed={!chartMode}>Other sessions</button>
            </div>
          )}
          <button type="button" class="btn quiet" onClick={() => s.setShowCosts(!s.showCosts)} aria-expanded={s.showCosts}>Usage<kbd aria-hidden="true">c</kbd></button>
          <button type="button" class="btn" onClick={() => compose()}>New<kbd aria-hidden="true">n</kbd></button>
        </div>
      </header>
      {s.showCosts && s.cost && (
        <section class="costs" aria-label="Usage, last 7 days" data-testid="costs">
          <ol class="cost-days">
            {s.cost.days.map((d, i) => (
              <li key={d.date}><span class="day">{dayLabel(d.date)}</span><span class="bar" aria-hidden="true"><span style={{ width: `${widths[i]}%` }} /></span><span class="n">{fmtTokens(d.tokens)} · {d.sessions} {d.sessions === 1 ? 'session' : 'sessions'}</span></li>
            ))}
          </ol>
          <ul class="cost-chips projects" aria-label="By project">{s.cost.projects.length ? s.cost.projects.slice(0, 8).map((p) => <li key={p.project}>{p.project} <b>{fmtTokens(p.tokens)}</b></li>) : <li class="none">No usage in the last 7 days</li>}{s.cost.projects.length > 8 && <li class="none">+{s.cost.projects.length - 8} more</li>}</ul>
          {s.cost.models.length > 0 && <ul class="cost-chips models" aria-label="By model">{s.cost.models.slice(0, 6).map((m) => <li key={m.model}>{m.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')} <b>{fmtTokens(m.tokens)}</b></li>)}</ul>}
          <p class="price-line" data-testid="price-line">{priceLine(s.cost)}</p>
        </section>
      )}
      {enabled === false && <div class="sess-empty" data-testid="sessions-unavailable"><p class="big">Not available on this host.</p><p class="sub">Agents live on the machine that runs them. Open Stack with <code>stack web</code> there.</p></div>}
      {enabled !== false && s.phase === 'loading' && <ol class="sess-list" aria-busy="true" aria-label="Loading agents"><li class="sk" /><li class="sk" /><li class="sk" /></ol>}
      {enabled !== false && s.phase === 'error' && <div class="sess-error" role="alert"><p>Cannot load agents: {s.error}</p><button type="button" class="btn primary" onClick={() => void s.reload()}>Retry</button></div>}
      {ready && chartMode && (
        <Fragment>
          <nav class="chart-wrap" aria-label="My team: every agent by who they report to"><Chart nodes={chart} sel={sel} chatsOf={chatsOf} onPick={pick} /></nav>
          <section class="chat-pane" aria-label={selAgent ? `${selAgent.name} chat` : 'Chat'} data-testid="chat-pane">
            {chats.length > 1 && (
              <div class="chat-tabs" role="tablist" aria-label={`${selAgent?.name ?? 'Agent'} chats, newest first`}>
                {chats.map((c) => (
                  <button type="button" key={c.id} role="tab" class={`chat-tab${c.id === s.open ? ' on' : ''}`} aria-selected={c.id === s.open} data-id={c.id} data-state={c.state} onClick={() => void s.openDrawer(c.id)} title={c.title}>
                    <span class="dot" aria-hidden="true" /><span class="ct-title">{c.title.replace(/^[^·:]*[·:]\s*/, '') || c.title}</span><span class="ct-when">{rowOf(c, s.now).when}</span>
                  </button>
                ))}
              </div>
            )}
            {inlineChat && <Drawer key={s.open ?? 'chat'} inline s={s} item={item} cursorItem={null} team={agentsOrdered} onClose={close} />}
            {!chats.length && selAgent && (
              <div class="chat-empty" data-testid="chat-empty">
                <p class="big">{selAgent.name} has no chat yet.</p>
                <p class="sub">{selAgent.role ?? 'Start one to brief this agent.'}</p>
                <button type="button" class="btn primary" onClick={() => compose(selAgent.slug)}>Start chat</button>
              </div>
            )}
          </section>
        </Fragment>
      )}
      {empty && !chartMode && (
        <div class="sess-empty" data-testid="sessions-empty">
          <p class="big">{hidden > 0 ? 'No sessions for your projects yet.' : hasTeam ? 'No other sessions.' : 'No sessions on this machine yet.'}</p>
          <p class="sub">{hidden > 0 ? <Fragment><button type="button" class="link" onClick={() => s.setShowAll(true)}>Show all</button> · {hidden} from other repos, or start one with <kbd aria-hidden="true">n</kbd> New.</Fragment> : <Fragment>Start one with <kbd aria-hidden="true">n</kbd> New.</Fragment>}</p>
        </div>
      )}
      {!chartMode && count > 0 && (
        <ol class="sess-list" aria-label="Other sessions, pinned then by priority">
          {groups.map((g) => (
            <Fragment key={g.title || '_'}>
              {g.title && <li class="sess-group" aria-label={`${g.title} group`}>{g.title}</li>}
              {g.items.map((x) => <Row key={x.id} s={x} now={s.now} cursor={x.id === cursor} pinned={pins.includes(x.id)} onOpen={() => void s.openDrawer(x.id)} onCursor={() => s.setCursor(x.id)} onPin={() => pin(x.id)} />)}
            </Fragment>
          ))}
        </ol>
      )}
      {!chartMode && split.more > 0 && <button type="button" class="more-btn" onClick={() => s.setShowAll(true)}>Show {split.more} more <kbd aria-hidden="true">m</kbd></button>}
      {!chartMode && hiddenNote && ready && <p class="scope-note" data-testid="scope-note">{hiddenNote} · <button type="button" class="link" onClick={() => s.setShowAll(!s.showAll)}>{s.showAll ? 'Only my projects' : 'Show all'}<kbd aria-hidden="true">A</kbd></button></p>}
      {!chartMode && count > 0 && <p class="keys-hint" aria-hidden="true">j k move · Enter open · f pin{hasTeam ? ' · t my team' : ''} · A all repos · s stop · c usage · n new</p>}
      {chartMode && count > 0 && <p class="keys-hint" aria-hidden="true">j k pick an agent · n new · c usage · p other sessions</p>}
      {modal && <div class="sess-scrim" onClick={close} />}
      {modal && <Drawer key={s.open ?? 'new'} s={s} item={item} cursorItem={s.items.find((i) => i.id === cursor) ?? null} team={agentsOrdered} defaultAgent={s.composeAgent ?? undefined} onClose={close} />}
    </section>
  );
}
