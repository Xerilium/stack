/**
 * The Sessions view: live Claude sessions on this machine, a cost strip, and a drawer to read, message, and watch one.
 * @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.cost
 * @req FR:agent-sessions/web.new @req FR:agent-sessions/web.states @req FR:agent-sessions/web.keys @req FR:agent-sessions/web.a11y
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { barWidths, costStrip, dayLabel, fmtTokens, fmtUsd, groupTurns, localDay, rowOf, splitSessions, type Line, type SessionItem } from './sessions';
import type { Sessions } from './useSessions';
import './sessions.css';

const TOP = 20;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
const MARK: Record<string, string> = { pending: '…', in_progress: '…', completed: '✓', failed: '✕', cancelled: '–' };

function Row({ s, now, cursor, onOpen, onCursor }: { s: SessionItem; now: Date; cursor: boolean; onOpen: () => void; onCursor: () => void }) {
  const r = rowOf(s, now);
  return (
    <li class={`sess-li${cursor ? ' cursor' : ''}`} data-id={s.id} data-state={s.state}>
      <button type="button" class="sess-row" onClick={onOpen} onMouseEnter={onCursor} aria-label={`${s.title}, ${r.label}, ${r.where}, ${r.when}, ${r.cost}`}>
        <span class="sess-state"><span class="dot" aria-hidden="true" />{r.label}</span>
        <span class="sess-title">{s.title}</span>
        <span class="sess-where">{r.where}</span>
        <span class="sess-when">{r.when}</span>
        <span class="sess-cost">{r.cost}</span>
        <span class="sess-mob" aria-hidden="true">{r.when} · {r.cost}</span>
      </button>
    </li>
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

function Drawer({ s, item, cursorItem, onClose }: { s: Sessions; item: SessionItem | null; cursorItem: SessionItem | null; onClose: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const [cwd, setCwd] = useState(item?.cwd ?? cursorItem?.cwd ?? '');
  const isNew = s.composing;
  useEffect(() => { box.current?.focus(); }, []);
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
    const ok = isNew ? await s.start(cwd.trim(), text) : await s.send(text);
    if (ok) setText('');
  };
  const running = s.streaming || item?.state === 'running';
  const title = isNew ? 'New session' : (item?.title ?? 'Session');
  const r = item ? rowOf(item, s.now) : null;
  const facts = item && r && !isNew ? [r.label, r.when, item.project, item.branch, fmtUsd(item.cost.usd), `${fmtTokens(item.cost.tokens)} tokens`].filter(Boolean).join(' · ') : '';
  const cwds = [...new Set(s.items.map((x) => x.cwd))];
  return (
    <aside ref={ref} class={`sess-drawer${isNew ? ' new' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap}>
      <header class="drawer-head">
        <div class="drawer-titles"><h2>{title}</h2>{facts && <p class="facts">{facts}</p>}</div>
        <button type="button" class="btn quiet" onClick={onClose} aria-label="Close">Close<kbd aria-hidden="true">Esc</kbd></button>
      </header>
      <div class="drawer-body">
        {isNew && (
          <label class="cwd-field">Folder
            <input type="text" list="sess-cwds" value={cwd} placeholder="/absolute/path/to/repo" onInput={(e) => setCwd((e.target as HTMLInputElement).value)} aria-label="Folder" />
            <datalist id="sess-cwds">{cwds.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
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
          <textarea ref={box} rows={2} value={text} maxLength={4000} aria-label={isNew ? 'First prompt' : `Message ${item?.title ?? 'the session'}`} placeholder={isNew ? 'What should it do?' : 'Message this session. Enter sends, Shift+Enter for a new line'}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } else if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
          <div class="compose-actions">
            {running && !s.transcript.done ? <button type="button" class="btn" onClick={() => void s.stop()}>Stop<kbd aria-hidden="true">s</kbd></button> : null}
            <button type="submit" class="btn primary" disabled={!text.trim() || (isNew && !cwd.trim()) || (running && !s.transcript.done)}>{isNew ? 'Start' : 'Send'}<kbd aria-hidden="true">⏎</kbd></button>
          </div>
        </form>
      </footer>
    </aside>
  );
}

export function SessionsView({ s, enabled }: { s: Sessions; enabled: boolean | null }) {
  const { items, cursor } = s;
  const { shown, more } = splitSessions(items, TOP, s.showAll);
  const item = items.find((i) => i.id === s.open) ?? null;
  const today = localDay(s.now);
  const strip = s.cost ? costStrip(s.cost, today) : null;
  const widths = s.cost ? barWidths(s.cost.days) : [];

  const stopArm = useRef(0);
  /** From the list, `s` asks for a second press within 2 s before stopping. */
  const stopFromList = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    if (it.state !== 'running' && it.state !== 'needs-you') { s.note('Only sessions Stack is running can be stopped here'); return; }
    if (Date.now() - stopArm.current < 2000) { stopArm.current = 0; void s.stop(id); return; }
    stopArm.current = Date.now();
    s.note(`Press s again to stop ${it.title}`);
  };
  /** Closes the drawer and puts focus back on the row it came from. */
  const close = () => { const was = s.open; s.closeDrawer(); setTimeout(() => document.querySelector<HTMLElement>(`.sess-li[data-id="${CSS.escape(was ?? '')}"] button`)?.focus(), 0); };

  // Keys act on this render's state, not the state of the render whose effect last registered the listener: the cursor row (or the drawer) paints before that effect re-runs, and a key in that gap must see what is on screen.
  const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape' && (s.open || s.composing)) { e.preventDefault(); close(); return; }
      if (isTyping(e.target)) return;
      if (s.open || s.composing) { if (k === 's') { e.preventDefault(); void s.stop(); } return; }
      const i = items.findIndex((x) => x.id === cursor);
      const step = (d: number) => { const n = items[Math.max(0, Math.min(items.length - 1, i + d))]; if (n) s.setCursor(n.id); };
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (k === 'Enter' && cursor) { if (e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName)) return; e.preventDefault(); void s.openDrawer(cursor); }
      else if (k === 'c') { e.preventDefault(); s.setShowCosts(!s.showCosts); }
      else if (k === 'n') { e.preventDefault(); s.setComposing(true); }
      else if (k === 'm' && more > 0) { e.preventDefault(); s.setShowAll(true); }
      else if (k === 's' && cursor) { e.preventDefault(); stopFromList(cursor); }
  };
  const latest = useRef(onKey); latest.current = onKey;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => latest.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  return (
    <section class="sess-view" aria-label="Sessions">
      <header class="sess-head">
        <div><h1 class="h1">Sessions</h1>{strip && <p class="cost-strip" data-testid="cost-strip"><strong>{strip.today}</strong><span class="sep">·</span><span>{strip.window}</span></p>}</div>
        <div class="sess-tools">
          <button type="button" class="btn quiet" onClick={() => s.setShowCosts(!s.showCosts)} aria-expanded={s.showCosts}>Costs<kbd aria-hidden="true">c</kbd></button>
          <button type="button" class="btn" onClick={() => s.setComposing(true)}>New<kbd aria-hidden="true">n</kbd></button>
        </div>
      </header>
      {s.showCosts && s.cost && (
        <section class="costs" aria-label="Costs, last 7 days" data-testid="costs">
          <ol class="cost-days">
            {s.cost.days.map((d, i) => (
              <li key={d.date}><span class="day">{dayLabel(d.date)}</span><span class="bar" aria-hidden="true"><span style={{ width: `${widths[i]}%` }} /></span><span class="n">{fmtUsd(d.usd)} · {fmtTokens(d.tokens)} · {d.sessions} {d.sessions === 1 ? 'session' : 'sessions'}</span></li>
            ))}
          </ol>
          <ul class="cost-chips projects" aria-label="By project">{s.cost.projects.length ? s.cost.projects.slice(0, 8).map((p) => <li key={p.project}>{p.project} <b>{fmtUsd(p.usd)}</b></li>) : <li class="none">No spend in the last 7 days</li>}{s.cost.projects.length > 8 && <li class="none">+{s.cost.projects.length - 8} more</li>}</ul>
          {s.cost.models.length > 0 && <ul class="cost-chips models" aria-label="By model">{s.cost.models.slice(0, 6).map((m) => <li key={m.model}>{m.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')} <b>{fmtUsd(m.usd)}</b></li>)}</ul>}
        </section>
      )}
      {enabled === false && <div class="sess-empty" data-testid="sessions-unavailable"><p class="big">Not available on this host.</p><p class="sub">Sessions live on the machine that runs the agents. Open Stack with <code>stack web</code> there.</p></div>}
      {enabled !== false && s.phase === 'loading' && <ol class="sess-list" aria-busy="true" aria-label="Loading sessions"><li class="sk" /><li class="sk" /><li class="sk" /></ol>}
      {enabled !== false && s.phase === 'error' && <div class="sess-error" role="alert"><p>Cannot load sessions: {s.error}</p><button type="button" class="btn primary" onClick={() => void s.reload()}>Retry</button></div>}
      {enabled !== false && s.phase === 'ready' && items.length === 0 && <div class="sess-empty" data-testid="sessions-empty"><p class="big">No sessions on this machine yet.</p><p class="sub">Start one with <kbd aria-hidden="true">n</kbd> New.</p></div>}
      {items.length > 0 && (
        <ol class="sess-list" aria-label="Sessions, attention first">
          {shown.map((x) => <Row key={x.id} s={x} now={s.now} cursor={x.id === cursor} onOpen={() => void s.openDrawer(x.id)} onCursor={() => s.setCursor(x.id)} />)}
        </ol>
      )}
      {more > 0 && <button type="button" class="more-btn" onClick={() => s.setShowAll(true)}>Show {more} more <kbd aria-hidden="true">m</kbd></button>}
      {items.length > 0 && <p class="keys-hint" aria-hidden="true">j k move · Enter open · s stop · c costs · n new</p>}
      {(s.open || s.composing) && <div class="sess-scrim" onClick={close} />}
      {(s.open || s.composing) && <Drawer key={s.open ?? 'new'} s={s} item={item} cursorItem={items.find((i) => i.id === cursor) ?? null} onClose={close} />}
    </section>
  );
}
