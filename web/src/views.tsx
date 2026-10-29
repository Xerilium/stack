import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CapacityRow } from './capacity';
import type { Filters } from './filters';
import { children, dueDays } from './now';
import type { Week } from './week';
import { clock, estimate, span, type Block, type Decision, type Plan } from './plan';
import { joinable, type Busy, type CalEvent } from './meetings';
import type { Countdown, Home, HomeItem } from './home';
import { ago, AGENT_LABEL, attention, lastLine, repliesFor, unescapeMd } from './agents';
import { Chip, glyphOf, GROUPS, GROUP_NAMES, Md, type GroupName } from './parts';
import { parseRow } from './row';
import type { Agent, InboxItem, NextTask, Task } from './types';

export const chipsOf = (text: string) => {
  const r = parseRow(text);
  return GROUP_NAMES.filter((g) => r[g]).map((g) => ({ group: g, value: r[g]! }));
};

type Pick = (refs: string[], g: GroupName | GroupName[]) => void;
const dueClass = (due: string) => { const d = new Date(`${due.split('-')[0].trim()} ${new Date().getFullYear()}`); return Number.isFinite(+d) && +d < Date.now() - 864e5 ? ' late' : ''; };

/** Shared row props for the Now and list views. */
export interface RowProps {
  titles: Map<string, string>; showProject: boolean; all: Task[]; cursor: string | null; selected: Set<string>; editing: string | null; busy: boolean; expanded: Set<string>; handles: boolean;
  drag: { ref: string; over: string | null; half: 'top' | 'bottom' } | null;
  prog: Map<string, { done: number; total: number }>;
  onSelect: (ref: string) => void; onCursor: (ref: string) => void; onEdit: (ref: string | null) => void; onSave: (ref: string, text: string) => void; onToggle: (t: Task) => void;
  onPick: Pick; onMove: (ref: string, dir: 'up' | 'down') => void; onDragStart: (ref: string, e: PointerEvent) => void; onExpand: (ref: string) => void; onOpen: (ref: string) => void;
}

export interface NowSection { id: string; title: string; rows: Task[] }

/** @req FR:web-app/now.focus @req FR:web-app/now.active */
export function NowView({ task, sections, hidden, allOpen, p, busy, onAct, onToggleAll }: {
  task: NextTask | null; sections: NowSection[]; hidden: number; allOpen: boolean; p: RowProps; busy: boolean;
  onAct: (a: 'start' | 'done' | 'defer') => void; onToggleAll: () => void;
}) {
  const hero = task ? parseRow(task.text) : null;
  return (
    <section aria-label="Now">
      {!task && (
        <div class="empty"><h1>Nothing active</h1><p>Add something: press <kbd>c</kbd></p></div>
      )}
      {task && hero && (
        <div class={`focus-block${p.cursor === task.ref ? ' cursor' : ''}`} data-ref={task.ref} aria-label="Next task" role="group" onClick={() => p.onCursor(task.ref)}>
          <p class="eyebrow">Next · {p.titles.get(task.project) ?? task.project}</p>
          <h1 data-testid="next-title" onDblClick={() => p.onOpen(task.ref)}><Md text={hero.title || task.text} /></h1>
          <div class="chips">
            {chipsOf(task.text).map((c) => <Chip key={c.group} {...c} onPick={(g) => p.onPick([task.ref], g)} />)}
            <Tags r={hero} />
            {hero.due && <span class={`meta${dueClass(hero.due)}`}>{hero.due}</span>}
            {hero.recurrence && <span class="meta">↻ {hero.recurrence}</span>}
          </div>
          <div class="actions">
            <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start')}>Start <kbd>s</kbd></button>
            <button type="button" class="btn" disabled={busy} onClick={() => onAct('done')}>Done <kbd>d</kbd></button>
            <button type="button" class="btn quiet" disabled={busy} onClick={() => onAct('defer')}>Not now <kbd>z</kbd></button>
          </div>
        </div>
      )}
      {sections.map((s) => s.rows.length > 0 && (
        <div key={s.id}>
          <h2 class="h2">{s.title}</h2>
          <ul class="rows" data-testid={s.id === 'then' ? 'rows' : undefined}>
            {s.rows.map((t) => <TaskRow key={t.ref} t={t} p={p} />)}
          </ul>
        </div>
      ))}
      {(hidden > 0 || allOpen) && <button type="button" class="btn quiet more-all" onClick={onToggleAll}>{allOpen ? 'Show less' : `Show all active (${hidden} more)`}</button>}
    </section>
  );
}

/** Who/outcome/links lifted out of the title. */
function Tags({ r }: { r: ReturnType<typeof parseRow> }) {
  return (
    <>
      {r.outcome && <span class="tag" title="Outcome">◎</span>}
      {r.who === 'agent' && <span class="tag ai" title="An agent can do this">AI</span>}
      {r.who === 'human' && <span class="tag you" title="Needs you">You</span>}
      {r.links.map((l) => <a key={l.href} class="tag link" href={l.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{l.label} ↗</a>)}
    </>
  );
}

export interface ListProps extends RowProps {
  rows: Task[]; filters: Filters; projects: { name: string; title: string }[]; collapsed: Set<string>; total: number;
  onFilters: (f: Partial<Filters>) => void; onSection: (key: string) => void; searchRef: { current: HTMLInputElement | null };
}

/** @req FR:web-app/list.view @req FR:web-app/list.filters */
export function ListView(p: ListProps) {
  const f = p.filters;
  const chips: [string, string, () => void][] = [];
  if (f.project) chips.push(['Project', f.project, () => p.onFilters({ project: '' })]);
  if (f.state !== 'open') chips.push(['Show', f.state, () => p.onFilters({ state: 'open' })]);
  for (const g of ['status', 'priority', 'effort'] as const) if (f[g]) chips.push([GROUPS[g].label, f[g], () => p.onFilters({ [g]: '' })]);
  let lastKey = '', lastProject = '';
  const counts = new Map<string, number>();
  for (const t of p.rows) counts.set(`${t.project}/${t.section}`, (counts.get(`${t.project}/${t.section}`) ?? 0) + 1);
  return (
    <section aria-label="Task list">
      <div class="filters" role="search">
        <input ref={(el) => { p.searchRef.current = el; }} type="search" aria-label="Search tasks" placeholder="Search" value={f.q} onInput={(e) => p.onFilters({ q: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <select aria-label="Project" value={f.project} onChange={(e) => p.onFilters({ project: (e.target as HTMLSelectElement).value })}>
          <option value="">All projects</option>
          {p.projects.map((pr) => <option key={pr.name} value={pr.name}>{pr.title || pr.name}</option>)}
        </select>
        <select aria-label="State" value={f.state} onChange={(e) => p.onFilters({ state: (e.target as HTMLSelectElement).value as Filters['state'] })}>
          <option value="open">Open</option><option value="done">Done</option><option value="all">All</option>
        </select>
        {(['status', 'priority', 'effort'] as const).map((g) => (
          <select key={g} aria-label={GROUPS[g].label} value={f[g]} onChange={(e) => p.onFilters({ [g]: (e.target as HTMLSelectElement).value })}>
            <option value="">{GROUPS[g].label}</option>
            {GROUPS[g].set.map((c) => <option key={c.e} value={c.e}>{c.e} {c.name}</option>)}
            <option value="None">None</option>
          </select>
        ))}
      </div>
      {chips.length > 0 && (
        <div class="active-filters">
          {chips.map(([k, v, rm]) => <button type="button" class="chip removable" key={k} aria-label={`Remove filter ${k}: ${v}`} onClick={rm}>{k}: {v} ×</button>)}
        </div>
      )}
      <p class="count" aria-live="polite">{p.total} task{p.total === 1 ? '' : 's'}</p>
      {p.total === 0 && <p class="empty-note">No tasks match.</p>}
      <ul class="rows" data-testid="rows">
        {p.rows.map((t) => {
          const key = `${t.project}/${t.section}`;
          const head = key !== lastKey; lastKey = key;
          const phead = t.project !== lastProject; lastProject = t.project;
          return <>
            {phead && <li class="group" key={`p-${t.project}`} role="presentation"><span>{p.titles.get(t.project) ?? t.project}</span></li>}
            {head && <li class="section" key={`h-${key}`} role="presentation"><button type="button" aria-expanded="true" onClick={() => p.onSection(key)}>▾ {t.section}</button></li>}
            <TaskRow key={t.ref} t={t} p={p} />
          </>;
        })}
        {[...p.collapsed].filter((k) => p.all.some((t) => `${t.project}/${t.section}` === k)).map((k) => <li class="section" key={`c-${k}`} role="presentation"><button type="button" aria-expanded="false" onClick={() => p.onSection(k)}>▸ {k.replace('/', ' · ')}</button></li>)}
      </ul>
    </section>
  );
}

/** Touch hold (450 ms) fires `fn`; lifting, a scroll, a cancel, or moving more than 10 px cancels it. */
function longPress(e: PointerEvent, fn: () => void) {
  const x = e.clientX, y = e.clientY;
  const h = setTimeout(() => { off(); fn(); }, 450);
  const ends = ['pointerup', 'pointercancel', 'scroll'] as const; // not contextmenu: Android fires it at ~400 ms, before the hold completes
  const move = (m: PointerEvent) => { if (Math.hypot(m.clientX - x, m.clientY - y) > 10) off(); };
  function off() { clearTimeout(h); for (const n of ends) window.removeEventListener(n, off, true); window.removeEventListener('pointermove', move, true); }
  for (const n of ends) window.addEventListener(n, off, true);
  window.addEventListener('pointermove', move, true);
}

function TaskRow({ t, p }: { t: Task; p: RowProps }) {
  const r = parseRow(t.text);
  const isCursor = p.cursor === t.ref;
  const editing = p.editing === t.ref;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (isCursor && !editing) ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [isCursor, editing]);
  const d = p.drag;
  const pr = p.prog.get(t.ref);
  const open = p.expanded.has(t.ref);
  const cls = ['row', t.done ? 'done' : '', isCursor ? 'cursor' : '', p.selected.has(t.ref) ? 'selected' : '',
    d?.over === t.ref ? `drop-${d.half}` : '', d?.ref === t.ref ? 'dragging' : ''].filter(Boolean).join(' ');
  return (
    <li ref={ref} class={cls} data-ref={t.ref} style={{ '--depth': t.depth }} aria-current={isCursor ? 'true' : undefined} onClick={() => p.onCursor(t.ref)}
      onPointerDown={(e) => { if (e.pointerType === 'touch') longPress(e, () => p.onSelect(t.ref)); }}>
      <div class="line">
        {p.handles && <button type="button" class="handle" aria-label={`Drag ${r.title || 'task'} to reorder`} title="Drag to reorder (Shift+J/K)"
          onPointerDown={(e) => p.onDragStart(t.ref, e as unknown as PointerEvent)}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); p.onMove(t.ref, 'up'); } if (e.key === 'ArrowDown') { e.preventDefault(); p.onMove(t.ref, 'down'); } }}>⠿</button>}
        <button type="button" class="tick" aria-label={t.done ? 'Mark not done' : 'Mark done'} disabled={p.busy} onClick={(e) => { e.stopPropagation(); if (e.shiftKey || e.metaKey || e.ctrlKey) p.onSelect(t.ref); else p.onToggle(t); }}><span class="box">{t.done ? '✓' : ''}</span></button>
        {editing ? (
          <Editor text={t.text} onSave={(v) => p.onSave(t.ref, v)} onCancel={() => p.onEdit(null)} />
        ) : (
          <>
            <div class="title" onDblClick={() => p.onEdit(t.ref)}>{r.status && <Chip group="status" value={r.status} onPick={(g) => p.onPick([t.ref], g)} />}<Tags r={r} /><span class="text"><Md text={r.title || t.text} /></span></div>
            <button type="button" class="edit-btn" aria-label={`Edit ${r.title || 'task'}`} onClick={(e) => { e.stopPropagation(); p.onEdit(t.ref); }}>✎</button>
            <div class="chips">
              {(['priority', 'effort'] as const).map((g) => { const c = chipsOf(t.text).find((x) => x.group === g); return c ? <Chip key={g} {...c} onPick={(gg) => p.onPick([t.ref], gg)} /> : <span key={g} class="slot" />; })}
              <button type="button" class="chip ghost" aria-label="Set properties" onClick={(e) => { e.stopPropagation(); p.onPick([t.ref], GROUP_NAMES); }}>＋</button>
              {p.showProject && <span class="proj-tag">{p.titles.get(t.project) ?? t.project}</span>}
              <span class={`meta due${r.due ? dueClass(r.due) : ''}`}>{r.suspend ? `💤 ${r.suspend}` : r.due ?? ''}{r.recurrence ? ' ↻' : ''}</span>
              {(pr && pr.total > 0) || t.notes.length > 0 ? (
                <button type="button" class="more" aria-expanded={open} aria-label={open ? 'Collapse details' : 'Expand details'} onClick={(e) => { e.stopPropagation(); p.onExpand(t.ref); }}>
                  {open ? '▾' : '▸'}{pr && pr.total > 0 ? ` ${pr.done}/${pr.total}` : ''}
                </button>
              ) : <span class="more-slot" />}
            </div>
          </>
        )}
      </div>
      {open && !editing && t.notes.length > 0 && <div class="notes">{t.notes.map((n, i) => <div key={i}><Md text={n.trim()} /></div>)}</div>}
    </li>
  );
}

/** @req FR:web-app/edit.open @req FR:web-app/edit.preview */
function Editor({ text, onSave, onCancel }: { text: string; onSave: (t: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(text);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div class="editor">
      <input ref={ref} type="text" aria-label="Edit task text" value={v} maxLength={2000} onClick={(e) => e.stopPropagation()}
        onInput={(e) => setV((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); onSave(v); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }} />
      <div class="preview" aria-label="Preview"><Md text={v} /></div>
      <p class="hint"><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel · markdown: **bold** *italic* `code` [link](https://...)</p>
    </div>
  );
}

/** @req FR:web-app/now.focusmode */
export function FocusMode({ task, all, busy, onToggle, onAct, onBack }: {
  task: Task; all: Task[]; busy: boolean; onToggle: (t: Task) => void; onAct: (a: 'start' | 'defer') => void; onBack: () => void;
}) {
  const r = parseRow(task.text);
  const subs = children(all, task.ref);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div ref={box} tabIndex={-1} class="focus-mode" role="dialog" aria-modal="true" aria-label="Focus"
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const els = [...box.current!.querySelectorAll<HTMLElement>('button')].filter((x) => !(x as HTMLButtonElement).disabled);
        if (!els.length) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        els[e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length].focus();
      }}>
      <div class="focus-inner">
        <p class="eyebrow">{task.project} · {task.section}</p>
        <h1><Md text={r.title || task.text} /></h1>
        <div class="chips">
          {chipsOf(task.text).map((c) => <span key={c.group} class={`chip ${glyphOf(c.group, c.value).tone}`}>{GROUPS[c.group].set.find((x) => x.e.replace(/\uFE0F/g, '') === c.value.replace(/\uFE0F/g, ''))?.name}</span>)}
          <Tags r={r} />
          {r.due && <span class={`meta${dueClass(r.due)}`}>{r.due}</span>}
        </div>
        {task.notes.length > 0 && <div class="notes big">{task.notes.map((n, i) => <p key={i}><Md text={n.trim()} /></p>)}</div>}
        {subs.length > 0 && (
          <ul class="checklist" aria-label="Subtasks">
            {subs.map((s) => <li key={s.ref} class={s.done ? 'done' : ''} style={{ '--depth': s.depth - task.depth - 1 }}>
              <button type="button" class="tick" aria-label={s.done ? 'Mark not done' : 'Mark done'} disabled={busy} onClick={() => onToggle(s)}><span class="box">{s.done ? '✓' : ''}</span></button>
              <span><Md text={parseRow(s.text).title || s.text} /></span>
            </li>)}
          </ul>
        )}
        <div class="actions">
          <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start')}>Start <kbd>s</kbd></button>
          <button type="button" class="btn" disabled={busy} onClick={() => onToggle(task)}>Done <kbd>d</kbd></button>
          <button type="button" class="btn" disabled={busy} onClick={() => onAct('defer')}>Defer <kbd>z</kbd></button>
          <button type="button" class="btn quiet" onClick={onBack}>Back <kbd>Esc</kbd></button>
        </div>
      </div>
    </div>
  );
}

/** @req FR:web-app/projects.glance */
export function ProjectsView({ rows, week, onOpen }: { rows: (CapacityRow & { top?: Task })[]; week?: Week; onOpen: (p: string) => void }) {
  return (
    <section aria-label="Projects">
      {week && <WeekView w={week} />}
      <h1 class="h1">Projects</h1>
      <ul class="proj-list">
        {rows.map((r) => (
          <li key={r.project} class={`prow${r.over ? ' over' : ''}${r.capacity === null ? ' nocap' : ''}`} data-testid={`cap-${r.project}`}>
            <button type="button" class="proj-btn" onClick={() => onOpen(r.project)}>
              <span class="proj-name">{r.title || r.project}</span>
              <span class="proj-top">{r.top ? <Md text={parseRow(r.top.text).title || r.top.text} /> : <i>Nothing open</i>}</span>
              <span class="proj-count">{r.open}</span>
              <span class="bar" role="meter" aria-label={`${r.project} load`} aria-valuemin={0} aria-valuemax={r.capacity ?? undefined} aria-valuenow={Math.round(r.hours * 10) / 10} title={`${fmt(r.hours)}h effort${r.capacity === null ? '' : ` of ${fmt(r.capacity)}h capacity`}`}>
                <span class="fill" style={{ width: `${Math.min(100, (r.ratio ?? (r.hours > 0 ? 1 : 0)) * 100)}%` }} />
              </span>
              <span class="proj-hrs">{fmt(r.hours)}h{r.capacity === null ? '' : ` / ${fmt(r.capacity)}h`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Cards and the open reply box follow the task, not its line number, which shifts when the file changes:
 *  project + text, plus which same-text row it is in file order (so identical rows never share a key). */
function taskKeys(rows: { ref: string; project: string; text: string }[]): Map<string, string> {
  const line = (x: { ref: string }) => Number(x.ref.slice(x.ref.lastIndexOf(':') + 1));
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const x of [...rows].sort((a, b) => line(a) - line(b))) {
    const base = `${x.project}\u241F${x.text}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(x.ref, `${base}\u241F${n}`);
  }
  return out;
}

function Reply({ onSend, onClose, to, placeholder }: { onSend: (text: string) => Promise<unknown>; onClose: () => void; to: string; placeholder: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <form class="reply" onSubmit={(e) => { e.preventDefault(); if (!text.trim() || sending) return; setSending(true); void onSend(text.trim()).catch(() => undefined).finally(() => setSending(false)); }}>
      <p class="reply-to">To <b>{to}</b> · lands in its inbox</p>
      <div class="reply-row">
        <input ref={ref} type="text" aria-label="Reply" placeholder={placeholder} value={text} maxLength={1000} onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }} />
        <button type="submit" class="btn primary" disabled={!text.trim() || sending}>Send <kbd>↵</kbd></button>
      </div>
    </form>
  );
}

/** Your open inbox messages for an item, newest last. */
function Sent({ items, now }: { items: InboxItem[]; now: Date }) {
  if (items.length === 0) return null;
  return (
    <ul class="sent" aria-label="Sent to the agent">
      {items.slice(-2).map((e) => <li key={e.id}><span class="sent-who">You · {ago(e.at, now)}</span> <span class="sent-text">{unescapeMd(e.text)}</span></li>)}
    </ul>
  );
}

type RefText = { ref: string; text: string };
type RowKey = RefText & { project: string };
/** Agent rows often start with a project glyph and an `[AI]` tag; both are noise in the panel. */
const agentTitle = (s: string) => s.replace(/^(?:[^\p{L}\p{N}`*[]+\s*)+/u, '').replace(/^\[AI\]\s*/i, '').replace(/\s+[—-]\s*$/, '').trim() || s;
const CHECK = { passing: '✓', failing: '✕', pending: '…', none: '' } as const;

export interface TodayProps {
  now: Date; plan: Plan; day: { start: number; end: number }; budget: { minutes: number; isDefault: boolean }; onBudget: (m: number | null) => void;
  decisions: Decision[]; agents: Agent[] | null; agentsError: string; onRetryAgents: () => void; inbox: InboxItem[]; p: RowProps; busy: boolean;
  tops: { project: string; title: string; task?: Task; open: number }[]; onProject: (name: string) => void;
  allDay: CalEvent[]; calError: string; onEmail: () => void;
  onAct: (a: 'start' | 'done' | 'defer', ref: string) => void; onReply: (task: RefText, text: string, label: string) => Promise<boolean>; onAccept: (d: Decision) => void;
}

/**
 * The day plan sized to the time you have, then what needs you, then what your agents are doing.
 * @req FR:web-app/today.plan @req FR:web-app/today.capacity @req FR:web-app/today.fit @req FR:web-app/today.needs @req FR:web-app/today.reply @req FR:web-app/today.agents @req FR:web-app/today.projects
 */
export function TodayView(t: TodayProps) {
  const [replying, setReplying] = useState<string | null>(null);
  const [moreNeeds, setMoreNeeds] = useState(false);
  const [queuedOpen, setQueuedOpen] = useState(false);
  const nowMin = t.now.getHours() * 60 + t.now.getMinutes();
  const start = Math.max(t.day.start, Math.ceil(nowMin / 15) * 15);
  const lastEnd = Math.max(0, ...t.plan.blocks.map((b) => b.end), t.plan.email?.end ?? 0, ...t.plan.meetings.filter((m) => m.start < t.day.end + 120).map((m) => m.end));
  const end = Math.min(24 * 60, Math.max(t.day.end, start + t.budget.minutes, lastEnd));
  const nextMeeting = t.plan.meetings.find((m) => m.end > nowMin);
  const joinOf = (m: Busy) => joinable(m.events, t.now, Math.max(10, m.start - nowMin)) ?? m.events.find((e) => e.joinUrl)?.joinUrl;
  const meetingMin = t.plan.meetings.reduce((m, x) => m + Math.max(0, Math.min(x.end, t.day.end) - Math.max(x.start, start)), 0);
  type Row = { at: number; kind: 'block'; b: Block; lead: boolean } | { at: number; kind: 'meeting'; m: Busy } | { at: number; kind: 'email'; e: NonNullable<Plan['email']> };
  const timeline: Row[] = [
    ...t.plan.blocks.map((b, i): Row => ({ at: b.start, kind: 'block', b, lead: i === 0 })),
    ...t.plan.meetings.filter((m) => m.start < end).map((m): Row => ({ at: m.start, kind: 'meeting', m })),
    ...(t.plan.email ? [{ at: t.plan.email.start, kind: 'email' as const, e: t.plan.email }] : []),
  ].sort((a, b) => a.at - b.at || (a.kind === 'meeting' ? -1 : 1));
  const total = Math.max(1, end - t.day.start);
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - t.day.start) / total) * 100));
  const markAt = pct(Math.max(nowMin, t.day.start)); // the time label hugs the bar ends so it never clips
  const date = t.now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const repliesOf = (x: RowKey) => repliesFor(t.inbox, x);
  const sorted = [...t.decisions].sort((a, b) => Number(repliesOf(a.task).length > 0) - Number(repliesOf(b.task).length > 0));
  const needs = moreNeeds ? sorted : sorted.slice(0, 4);
  const agents = t.agents ?? [];
  const live = agents.filter((a) => a.state !== 'queued');
  const queued = agents.filter((a) => a.state === 'queued');
  const shownQueued = queuedOpen ? queued : [];
  const heads = attention(agents).filter((x) => !/queued$/.test(x)).slice(0, 2);
  const over = t.plan.overflow.length > 0;
  const shownOver = t.plan.atRisk.length > 0 ? t.plan.atRisk.slice(0, 12) : t.plan.overflow.slice(0, 5);
  const replyBox = (key: string, task: RefText, owner: string, placeholder: string, ok: string) => replying === key && (
    <Reply to={`the ${owner} agent`} placeholder={placeholder} onClose={() => setReplying(null)} onSend={async (text) => { if (await t.onReply(task, text, ok)) setReplying(null); }} />
  );
  const keys = taskKeys([...t.decisions.map((d) => d.task), ...agents]);
  const agentRow = (a: Agent) => {
    const key = keys.get(a.ref) ?? a.ref;
    const r = parseRow(a.text);
    const owner = t.p.titles.get(a.project) ?? a.project;
    const line = lastLine(a, t.now);
    return (
      <li key={key} class={`agent ${a.state}`}>
        <span class="pulse" aria-hidden="true" />
        <div class="agent-body">
          <p class="agent-title"><Md text={agentTitle(r.title || a.title)} /></p>
          <p class="agent-meta">
            <span class="agent-state">{AGENT_LABEL[a.state]}</span>
            <span>{owner}</span>
            {a.prs.map((pr) => (
              <a key={pr.url} class={`pr ${pr.checks ?? ''} ${pr.state ?? ''}`} href={pr.url} target="_blank" rel="noopener noreferrer" title={pr.title ? `${pr.title}${pr.checks ? ` · checks ${pr.checks}` : ''}` : undefined}>
                {pr.repo.split('/')[1]}#{pr.number}{pr.state === 'merged' ? ' merged' : pr.checks && CHECK[pr.checks] ? ` ${CHECK[pr.checks]}` : ''}
              </a>
            ))}
            {line && <span class="agent-last">{line}</span>}
          </p>
          <Sent items={repliesOf(a)} now={t.now} />
        </div>
        <button type="button" class="btn quiet reveal" aria-expanded={replying === key} onClick={() => setReplying(replying === key ? null : key)}>Reply</button>
        {replyBox(key, a, owner, 'Message the agent', 'Sent to the agent')}
      </li>
    );
  };
  return (
    <section class="today" aria-label="Today">
      <header class="t-head">
        <div class="t-top">
          <div>
            <p class="t-date">{date}{t.allDay.length > 0 && <span class="allday"> · {t.allDay.map((e) => e.subject).join(' · ')}</span>}</p>
            <h1>{t.plan.blocks.length === 0 ? (t.budget.minutes > 0 ? 'Nothing planned' : 'No time planned') : <>{span(t.plan.busy)} <span class="of">of {span(t.budget.minutes)}</span></>}</h1>
          </div>
          <div class="avail" role="group" aria-label="Available today" data-testid="available">
            <span class="avail-label">Available</span>
            <button type="button" class="step" aria-label="Less time" title="Less time ([)" disabled={t.budget.minutes <= 0} onClick={() => t.onBudget(t.budget.minutes - 30)}>−</button>
            <output aria-live="polite">{span(t.budget.minutes)}</output>
            <button type="button" class="step" aria-label="More time" title="More time (])" disabled={t.budget.minutes >= 960} onClick={() => t.onBudget(t.budget.minutes + 30)}>+</button>
            {!t.budget.isDefault && <button type="button" class="link-btn" onClick={() => t.onBudget(null)}>Reset</button>}
          </div>
        </div>
        <p class="t-sub">
          {t.plan.atRisk.length > 0 ? <span class="warn">{t.plan.atRisk.length} at-risk task{t.plan.atRisk.length === 1 ? '' : 's'} don't fit ({span(t.plan.riskShort)})</span> : <span>{span(t.plan.free)} free</span>}
          {meetingMin > 0 && <span>{span(meetingMin)} in meetings</span>}
          {nextMeeting && <span class="next-meeting">{nextMeeting.titles[0]} {nextMeeting.start <= nowMin ? 'now' : `in ${span(nextMeeting.start - nowMin)}`}{joinOf(nextMeeting) && <> · <a href={joinOf(nextMeeting)} target="_blank" rel="noopener noreferrer">Join{joinable(nextMeeting.events, t.now) && <kbd>J</kbd>}</a></>}</span>}
          {t.plan.assumed > 0 && <span class="quiet" title="No effort set; 30 min assumed">{t.plan.assumed} estimated</span>}
          {t.decisions.length > 0 && <button type="button" class="jump" onClick={() => jump('needs-you')}>{t.decisions.length} to decide</button>}
          {heads.length > 0 && <button type="button" class="jump" onClick={() => jump('ai-team')}>{heads.join(' · ')}</button>}
        </p>
        <div class="day-bar" role="img" aria-label={`${span(t.plan.busy)} planned of ${span(t.budget.minutes)} available${meetingMin ? ` · ${span(meetingMin)} in meetings` : ''}${t.plan.email ? ` · email at ${clock(t.plan.email.start)}` : ''}`}>
          <s style={{ left: `${pct(start)}%`, width: `${pct(start + t.budget.minutes) - pct(start)}%` }} />
          {t.plan.meetings.filter((m) => m.start < end).map((m) => <u key={`m${m.start}`} title={`${clock(m.start)} ${m.titles.join(', ')}`} style={{ left: `${pct(m.start)}%`, width: `${pct(m.end) - pct(m.start)}%` }} />)}
          {t.plan.email && <i class="mail" title={`${clock(t.plan.email.start)} Email`} style={{ left: `${pct(t.plan.email.start)}%`, width: `${pct(t.plan.email.end) - pct(t.plan.email.start)}%` }} />}
          {t.plan.blocks.map((b) => <i key={b.task.ref} title={`${clock(b.start)} ${parseRow(b.task.text).title}`} style={{ left: `${pct(b.start)}%`, width: `${pct(b.end) - pct(b.start)}%` }} />)}
          <b class={markAt < 8 ? 'edge-l' : markAt > 92 ? 'edge-r' : undefined} style={{ left: `${markAt}%` }}><em>{clock(Math.max(nowMin, t.day.start))}</em></b>
        </div>
        <p class="day-ends"><span>{clock(t.day.start)}</span><span>{clock(end)}</span></p>
      </header>

      <div class="t-cols">
        <div class="t-plan">
          <h2 class="h2">Your day</h2>
          {t.calError && <p class="cal-note">{t.calError}; meetings are not counted.</p>}
          {t.plan.blocks.length === 0 && <p class="empty-note">{t.budget.minutes === 0 ? 'No time set for today. Add some with + or ].' : <>Nothing left that fits. Add something with <kbd>c</kbd>.</>}</p>}
          <ol class="plan" data-testid="plan">
            {timeline.map((r) => r.kind === 'block'
              ? <PlanBlock key={r.b.task.ref} b={r.b} lead={r.lead} p={t.p} busy={t.busy} onAct={t.onAct} />
              : r.kind === 'meeting' ? <MeetingRow key={`m${r.m.start}`} m={r.m} />
                : <li key="email" class="email-block"><time class="when">{clock(r.e.start)}<small>{span(r.e.end - r.e.start)}</small></time><div class="what"><button type="button" class="email-open" onClick={t.onEmail}>Email · {r.e.count} ask{r.e.count === 1 ? '' : 's'}</button><kbd>g k</kbd></div></li>)}
          </ol>
          {over && (
            <div class="nofit" data-testid="nofit">
              <div class="nofit-head">
                <h3>Doesn't fit{t.plan.atRisk.length > 0 && <span>{t.plan.atRisk.length} at risk</span>}</h3>
                <button type="button" class="btn quiet" title="More time (])" onClick={() => t.onBudget(t.budget.minutes + 30)}>+30m <kbd>]</kbd></button>
              </div>
              <ul>
                {shownOver.map((o) => {
                  const e = estimate(o);
                  return (
                    <li key={o.ref} class={t.plan.atRisk.includes(o) ? 'risk' : undefined} onDblClick={() => t.p.onOpen(o.ref)}>
                      <span class="nofit-est">{e.assumed ? '~' : ''}{span(e.minutes)}{e.partial ? '+' : ''}</span>
                      <span class="nofit-title"><Md text={parseRow(o.text).title || o.text} /></span>
                      <span class="nofit-proj"><DueNote due={parseRow(o.text).due} />{t.p.titles.get(o.project) ?? o.project}</span>
                    </li>
                  );
                })}
              </ul>
              {t.plan.overflow.length > shownOver.length && <p class="nofit-later">{t.plan.overflow.length - shownOver.length} later</p>}
            </div>
          )}
        </div>

        <div class="t-side">
          {t.decisions.length > 0 && <h2 class="h2" id="needs-you">Needs you</h2>}
          <ul class="cards" data-testid="needs">
            {needs.map((d) => {
              const r = parseRow(d.task.text);
              const key = keys.get(d.task.ref) ?? d.task.ref;
              const owner = t.p.titles.get(d.task.project) ?? d.task.project;
              const sent = repliesOf(d.task);
              const rec = d.recommendation && !/:$/.test(d.recommendation) ? d.recommendation : undefined;
              return (
                <li class={`card need${sent.length ? ' decided' : ''}`} key={key}>
                  <p class="card-eyebrow">{owner}{d.context ? ` · ${parseRow(d.context.text).title.replace(/\s--\s/g, ' — ')}` : ''}</p>
                  <p class="card-title"><Md text={r.title || d.task.text} /></p>
                  {rec && sent.length === 0 && <p class="rec"><span>Recommended</span><Md text={rec} /></p>}
                  {sent.length > 0 && <p class="waiting-agent">Sent, waiting on the agent</p>}
                  <Sent items={sent} now={t.now} />
                  <div class="card-actions">
                    {rec && sent.length === 0 && <button type="button" class="btn primary" disabled={t.busy} onClick={() => t.onAccept(d)}>Go with it</button>}
                    <button type="button" class="btn" aria-expanded={replying === key} onClick={() => setReplying(replying === key ? null : key)}>Reply</button>
                    <button type="button" class="btn quiet" onClick={() => t.p.onOpen(d.task.ref)}>Details</button>
                  </div>
                  {replyBox(key, d.task, owner, 'Tell the agent what you decided', 'Reply sent')}
                </li>
              );
            })}
          </ul>
          {t.decisions.length > 4 && <button type="button" class="link-btn" onClick={() => setMoreNeeds((m) => !m)}>{moreNeeds ? 'Show fewer' : `${t.decisions.length - 4} more`}</button>}

          {(agents.length > 0 || t.agentsError) && <h2 class="h2" id="ai-team">Your AI team</h2>}
          {t.agentsError && (
            <div class="agents-error" role="alert" data-testid="agents-error">
              <span>Couldn't load agent activity: {t.agentsError}</span>
              <button type="button" class="btn quiet" onClick={t.onRetryAgents}>Retry</button>
            </div>
          )}
          <ul class="agents" data-testid="agents">
            {live.map(agentRow)}
            {shownQueued.map(agentRow)}
          </ul>
          {queued.length > 0 && <button type="button" class="link-btn queued-toggle" aria-expanded={queuedOpen} onClick={() => setQueuedOpen((o) => !o)}>{queuedOpen ? 'Hide queued' : `${queued.length} queued`}</button>}

          <h2 class="h2">Projects</h2>
          <ul class="tiles" data-testid="tops">
            {t.tops.filter((x) => x.task).map((x) => (
              <li key={x.project}>
                <button type="button" class="tile" onClick={() => t.onProject(x.project)}>
                  <span class="tile-name">{x.title}</span>
                  <span class="tile-top"><Md text={parseRow(x.task!.text).title || x.task!.text} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Meetings: fixed time, not tasks; overlapping ones stack, each with its own Join. @req FR:web-app/today.meetings */
function MeetingRow({ m }: { m: Busy }) {
  return (
    <li class="meeting">
      <time class="when">{clock(m.start)}<small>{clock(m.end)}</small></time>
      <div class="what">
        {m.events.map((e) => (
          <p key={e.id} class="m-line">
            <span class="m-title">{e.subject}</span>
            {e.showAs === 'tentative' && <span class="m-tent">Tentative</span>}
            {e.joinUrl && <a class="join" href={e.joinUrl} target="_blank" rel="noopener noreferrer">Join</a>}
          </p>
        ))}
      </div>
    </li>
  );
}

function PlanBlock({ b, lead, p, busy, onAct }: { b: Block; lead: boolean; p: RowProps; busy: boolean; onAct: TodayProps['onAct'] }) {
  const r = parseRow(b.task.text);
  const isCursor = p.cursor === b.task.ref;
  return (
    <li class={`block${lead ? ' lead' : ''}${isCursor ? ' cursor' : ''}`} data-ref={b.task.ref} style={{ '--min': b.end - b.start }} onClick={() => p.onCursor(b.task.ref)}>
      <time class="when">{clock(b.start)}<small title={b.assumed ? 'No effort set; 30 min assumed' : undefined}>{b.assumed ? '~' : ''}{span(b.end - b.start)}{b.partial ? '+' : ''}</small></time>
      <div class="what">
        <button type="button" class="tick" aria-label="Mark done" disabled={busy} onClick={(e) => { e.stopPropagation(); onAct('done', b.task.ref); }}><span class="box" /></button>
        <div class="what-body">
          <p class="what-title" onDblClick={() => p.onOpen(b.task.ref)}><Md text={r.title || b.task.text} /></p>
          <p class="what-meta">
            <span>{p.titles.get(b.task.project) ?? b.task.project}</span>
            <DueNote due={r.due} />
            {chipsOf(b.task.text).filter((c) => c.group === 'status' || (lead && c.group === 'priority')).map((c) => <Chip key={c.group} {...c} onPick={(g) => p.onPick([b.task.ref], g)} />)}
            <Tags r={r} />
          </p>
          {lead && (
            <div class="lead-actions">
              <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start', b.task.ref)}>Start <kbd>s</kbd></button>
              <button type="button" class="btn" disabled={busy} onClick={() => onAct('done', b.task.ref)}>Done <kbd>d</kbd></button>
              <button type="button" class="btn quiet" disabled={busy} onClick={() => onAct('defer', b.task.ref)}>Not now <kbd>z</kbd></button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Due date only when it matters: within two days or late; stale dates stay quiet. */
function DueNote({ due }: { due?: string }) {
  const d = dueDays(due);
  if (!due || d === null || d > 2) return null;
  if (d < -30) return <span class="due stale" title={`Due ${due}`}>stale</span>;
  return <span class={`due${d < 0 ? ' late' : ''}`}>{d < 0 ? `${-d}d late` : d === 0 ? 'due today' : `due in ${d}d`}</span>;
}

/** This week: available time vs planned work per day. @req FR:web-app/week.days @req FR:web-app/week.summary @req FR:web-app/week.bars */
export function WeekView({ w }: { w: Week }) {
  const top = Math.max(60, ...w.days.map((d) => Math.max(d.available, d.planned)));
  const h = (m: number) => `${Math.round((m / top) * 100)}%`;
  const hrs = (m: number) => (m === 0 ? '0' : m % 60 === 0 ? `${m / 60}h` : `${(m / 60).toFixed(1).replace(/\.0$/, '')}h`);
  return (
    <section class="week" aria-label="This week" data-testid="week">
      <div class="week-head">
        <h1 class="h1">This week</h1>
        <p class="week-sum"><span>{hrs(w.available)} available</span><span>{hrs(w.planned)} planned</span>{w.leftover > 0 && <span class="warn">{hrs(w.leftover)} won't fit</span>}</p>
      </div>
      <ol class="week-days">
        {w.days.map((d) => {
          const name = d.today ? 'Today' : d.date.toLocaleDateString(undefined, { weekday: 'short' });
          const fill = Math.min(d.planned, d.available);
          return (
            <li key={d.date.toISOString()} class={`wd${d.today ? ' today' : ''}${d.over && d.available > 0 ? ' over' : ''}${d.available === 0 ? ' off' : ''}`}>
              <div class="wd-bar" role="img" aria-label={`${name}: ${hrs(d.planned)} planned of ${hrs(d.available)} available${d.over ? `, ${hrs(d.over)} over` : ''}`}>
                <span class="wd-track" style={{ height: h(d.available) }} />
                <span class="wd-fill" style={{ height: h(fill) }} />
                {d.over > 0 && d.available > 0 && <span class="wd-over" style={{ bottom: h(d.available), height: h(d.over) }} />}
                {d.available === 0 && d.planned > 0 && <span class="wd-unset" style={{ height: h(d.planned) }} />}
              </div>
              <p class="wd-label">{hrs(d.planned)}<small>{d.available === 0 ? (d.planned > 0 ? ' · no time set' : ' · off') : ` / ${hrs(d.available)}`}</small></p>
              <p class="wd-name">{name}<small>{d.date.getDate()}</small></p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Expected time and due countdown, the same on every Home row. */
function When({ i }: { i: { minutes: number; assumed: boolean; due: Countdown | null } }) {
  return (
    <span class="when-meta">
      <span class="expected" data-testid="expected" title={i.assumed ? 'No effort set; 30 min assumed' : 'Expected time'}>{i.assumed ? '~' : ''}{span(i.minutes)}</span>
      {i.due && <span class={`countdown ${i.due.tone}`} data-testid="countdown">{i.due.text}</span>}
    </span>
  );
}

/** Home: the one thing now, whether it fits, the next two, the top of every project. @req FR:web-app/home.one @req FR:web-app/home.fit @req FR:web-app/home.next @req FR:web-app/home.projects @req FR:web-app/home.quiet */
export function HomeView({ h, minutesLeft, p, busy, onAct, onProject, onMoreTime }: {
  h: Home; minutesLeft: number; p: RowProps; busy: boolean; onAct: (a: 'start' | 'done' | 'defer', ref?: string) => void; onProject: (name: string) => void; onMoreTime: () => void;
}) {
  const one = h.one;
  const hero = one ? parseRow(one.task.text) : null;
  const row = (i: HomeItem, extra?: string) => (
    <li key={i.task.ref} class={`row home-row${p.cursor === i.task.ref ? ' cursor' : ''}${extra ? ` ${extra}` : ''}`} data-ref={i.task.ref} onClick={() => p.onCursor(i.task.ref)}>
      <div class="line">
        <button type="button" class="tick" aria-label="Mark done" disabled={busy} onClick={(e) => { e.stopPropagation(); onAct('done', i.task.ref); }}><span class="box" /></button>
        <span class="title" onDblClick={() => p.onOpen(i.task.ref)}><Md text={parseRow(i.task.text).title || i.task.text} /><Tags r={parseRow(i.task.text)} /></span>
        <span class="proj-tag">{p.titles.get(i.task.project) ?? i.task.project}</span>
        <When i={i} />
      </div>
    </li>
  );
  return (
    <section class="home" aria-label="Now">
      {!one && <div class="empty"><h1>Nothing active</h1><p>Add something: press <kbd>c</kbd></p></div>}
      {one && hero && (
        <div class={`focus-block${p.cursor === one.task.ref ? ' cursor' : ''}${h.fits ? '' : ' unfit'}`} data-ref={one.task.ref} aria-label="Next task" role="group" onClick={() => p.onCursor(one.task.ref)}>
          <p class="eyebrow">Now · {p.titles.get(one.task.project) ?? one.task.project}</p>
          <h1 data-testid="next-title" onDblClick={() => p.onOpen(one.task.ref)}><Md text={hero.title || one.task.text} /></h1>
          <div class="chips">
            <When i={one} />
            {chipsOf(one.task.text).filter((c) => c.group !== 'effort').map((c) => <Chip key={c.group} {...c} onPick={(g) => p.onPick([one.task.ref], g)} />)}
            <Tags r={hero} />
            {hero.recurrence && <span class="meta">↻ {hero.recurrence}</span>}
          </div>
          {!h.fits && (
            <p class="nofit-line" data-testid="nofit">{minutesLeft > 0 ? `No time for this today: needs ${span(one.minutes)}, ${span(minutesLeft)} left` : "Day's over: no time left today"}</p>
          )}
          <div class="actions">
            <button type="button" class={`btn${h.fits ? ' primary' : ''}`} disabled={busy} onClick={() => onAct('start', one.task.ref)}>Start <kbd>s</kbd></button>
            <button type="button" class="btn" disabled={busy} onClick={() => onAct('done', one.task.ref)}>Done <kbd>d</kbd></button>
            <button type="button" class="btn quiet" disabled={busy} onClick={() => onAct('defer', one.task.ref)}>Not now <kbd>z</kbd></button>
            {!h.fits && <button type="button" class="btn quiet" onClick={onMoreTime}>More time <kbd>]</kbd></button>}
          </div>
        </div>
      )}
      {h.instead && (
        <div class="instead" data-testid="instead">
          <h2 class="h2">Instead, this fits</h2>
          <ul class="rows">{row(h.instead)}</ul>
          <div class="actions small"><button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start', h.instead!.task.ref)}>Start this</button></div>
        </div>
      )}
      {h.next.length > 0 && (
        <div>
          <h2 class="h2">Up next</h2>
          <ul class="rows" data-testid="up-next">{h.next.map((i) => row(i))}</ul>
        </div>
      )}
      {h.projects.length > 0 && (
        <div>
          <h2 class="h2">Projects</h2>
          <ul class="home-projects" data-testid="home-projects">
            {h.projects.map((x) => (
              <li key={x.project} class={x.shown ? 'shown' : ''}>
                <button type="button" class="proj-link" onClick={() => onProject(x.project)}>{x.title}</button>
                {x.task && !x.shown && <span class="proj-top" onDblClick={() => p.onOpen(x.task!.ref)}><Md text={parseRow(x.task.text).title || x.task.text} /></span>}
                {x.task && x.shown && <span class="proj-top quiet">above</span>}
                {x.task && !x.shown && <When i={{ minutes: x.minutes!, assumed: !!x.assumed, due: x.due ?? null }} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
