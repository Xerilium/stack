/**
 * The shared task detail: facts as text, priority / effort / due as editable controls, plain-verb actions with an outcome line.
 * @req FR:task-detail-design/detail.actions @req FR:task-detail-design/detail.undo @req FR:task-detail-design/detail.priority
 * @req FR:task-detail-design/detail.effort @req FR:task-detail-design/detail.due @req FR:task-detail-design/detail.save @req FR:task-detail-design/detail.facts
 * @req FR:web-app/now.focusmode
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { children } from './now';
import { ACTION_HINT, dueLabel, dueValue, EFFORT_OPTIONS, effortOf, nearestEffort, PRIORITY_OPTIONS, priorityOf, withDue, type Option } from './detail';
import { Md } from './parts';
import { parseRow } from './row';
import type { SetProps, Task } from './types';
import './detail.css';

/** Saves a new row text (the due tag); the host shows the toast with Undo. Resolves true when saved. */
export type SaveText = (next: string, prev: string, label: string) => Promise<boolean>;
/** Sets priority or effort through `/tasks/set`; Undo restores `prev`, or the old row text when `prev` is a marker `set` does not take (`🔹`). */
export type SetPropsFn = (props: SetProps, prev: SetProps | { text: string }, label: string) => Promise<boolean>;
type Act = 'start' | 'done' | 'defer' | 'open';

/** Start / Done / Defer (and Open in a row) as plain verbs; the line under them says what the hovered or focused one does. */
export function DetailActions({ t, busy, onStart, onDone, onDefer, onOpen }: { t: Task; busy: boolean; onStart: () => void; onDone: () => void; onDefer: () => void; onOpen?: () => void }) {
  const [hover, setHover] = useState<Act | null>(null);
  const [focus, setFocus] = useState<Act | null>(null);
  const done = t.done ? ACTION_HINT.reopen : ACTION_HINT.done;
  const hint = { start: ACTION_HINT.start, done, defer: ACTION_HINT.defer, open: ACTION_HINT.open };
  // Focus wins over hover: the keyboard user reads what the focused action does.
  const on = (a: Act) => ({ title: hint[a], onMouseEnter: () => setHover(a), onMouseLeave: () => setHover(null), onFocus: () => setFocus(a), onBlur: () => setFocus(null) });
  return (
    <div class="fl-actions">
      <div class="fl-row" role="group" aria-label="Actions">
        <button type="button" class="fl-btn primary" disabled={busy} {...on('start')} onClick={(e) => { e.stopPropagation(); onStart(); }}>Start</button>
        <button type="button" class="fl-btn" disabled={busy} {...on('done')} onClick={(e) => { e.stopPropagation(); onDone(); }}>{t.done ? 'Reopen' : 'Done'}</button>
        <button type="button" class="fl-btn" disabled={busy} {...on('defer')} onClick={(e) => { e.stopPropagation(); onDefer(); }}>Defer</button>
        {onOpen && <button type="button" class="fl-btn subtle" {...on('open')} onClick={(e) => { e.stopPropagation(); onOpen(); }}>Open</button>}
      </div>
      <p class="fl-hint" data-testid="action-hint">{hint[focus ?? hover ?? 'start']}</p>
    </div>
  );
}

/** One popover at a time; Esc and a click outside close it and focus returns to the control. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const w = wrap.current;
    (w?.querySelector<HTMLElement>('[aria-selected="true"]') ?? w?.querySelector<HTMLElement>('[role="option"], input'))?.focus(); // the current value first
    const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);
  const close = () => { setOpen(false); wrap.current?.querySelector<HTMLElement>('.fl-prop')?.focus(); };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const l = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]; const i = l.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault(); l[(i + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length]?.focus();
  };
  return { open, setOpen, wrap, close, keys };
}

function Picker({ label, current, options, tone, onPick, custom }: { label: string; current: Option; options: Option[]; tone?: string; onPick: (o: Option) => void; custom?: (close: () => void) => ComponentChildren }) {
  const p = usePopover();
  return (
    <span class="fl-pop-wrap" ref={p.wrap} onKeyDown={p.keys}>
      <button type="button" class="fl-prop" aria-haspopup="listbox" aria-expanded={p.open} onClick={(e) => { e.stopPropagation(); p.setOpen(!p.open); }}>
        <span class="k">{label}:</span> <span class={`v${tone ? ` ${tone}` : ''}`}>{current.name}</span>
      </button>
      {p.open && (
        <div class="fl-popover" onClick={(e) => e.stopPropagation()}>
          <div role="listbox" aria-label={label}>
            {options.map((o) => <button key={o.value} type="button" role="option" class="fl-option" aria-selected={o.value === current.value} onClick={() => { p.close(); if (o.value !== current.value) onPick(o); }}>{o.name}</button>)}
          </div>
          {custom?.(p.close)}
        </div>
      )}
    </span>
  );
}

function DuePicker({ text, onSave }: { text: string; onSave: (ymd: string | null) => void }) {
  const p = usePopover();
  const label = dueLabel(text);
  const has = !!parseRow(text).due;
  const [day, setDay] = useState('');
  return (
    <span class="fl-pop-wrap" ref={p.wrap} onKeyDown={p.keys}>
      <button type="button" class="fl-prop" aria-haspopup="dialog" aria-expanded={p.open} onClick={(e) => { e.stopPropagation(); setDay(dueValue(text, new Date())); p.setOpen(!p.open); }}>
        <span class={`v${has ? '' : ' none'}`}>{label}</span>
      </button>
      {p.open && (
        <div class="fl-popover" role="dialog" aria-label="Due date" onClick={(e) => e.stopPropagation()}>
          {/* Saved on Set or Enter, not on change: typing a date fires change on every partial value. */}
          <form class="fl-due" onSubmit={(e) => { e.preventDefault(); if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) >= 2000) { p.close(); onSave(day); } }}>
            <label class="fl-field">Due date<input type="date" class="fl-input" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} /></label>
            <span class="fl-row"><button type="submit" class="fl-btn primary" disabled={!day}>Set</button>
              {has && <button type="button" class="fl-btn subtle" onClick={() => { p.close(); onSave(null); }}>No date</button>}</span>
          </form>
        </div>
      )}
    </span>
  );
}

/** Priority, effort, and due: each saves at once with Saving… / Saved and Undo (from the host). */
export function PropertyBar({ t, onSave, onSet }: { t: Task; onSave: SaveText; onSet: SetPropsFn }) {
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const save = async (write: () => Promise<boolean>) => {
    setState('saving'); clearTimeout(timer.current);
    const ok = await write();
    setState(ok ? 'saved' : '');
    if (ok) timer.current = setTimeout(() => setState(''), 2000);
  };
  const pri = priorityOf(t.text);
  const eff = effortOf(t.text);
  const effPrev = EFFORT_OPTIONS.some((o) => o.value === eff.value) ? { effort: eff.value } : { text: t.text };
  const [mins, setMins] = useState('');
  return (
    <div class="fl-props" role="group" aria-label="Properties">
      <Picker label="Priority" current={pri} options={PRIORITY_OPTIONS} tone={pri.name === 'Critical' ? 'hot' : undefined} onPick={(o) => void save(() => onSet({ priority: o.value }, { priority: pri.value }, `Priority: ${o.name}`))} />
      <Picker label="Effort" current={eff} options={EFFORT_OPTIONS} onPick={(o) => void save(() => onSet({ effort: o.value }, effPrev, `Effort: ${o.name}`))}
        custom={(close) => (
          <form class="fl-pop-row" onSubmit={(e) => { e.preventDefault(); const n = Number(mins); if (!(n > 0)) return; const o = nearestEffort(n); close(); setMins(''); if (o.value !== eff.value) void save(() => onSet({ effort: o.value }, effPrev, `Saved as ${o.name}`)); }}>
            <input type="number" min={1} max={2880} inputMode="numeric" class="fl-input" aria-label="Custom minutes" placeholder="Minutes" value={mins} onInput={(e) => setMins((e.target as HTMLInputElement).value)} />
            <button type="submit" class="fl-btn">Set</button>
          </form>
        )} />
      <DuePicker text={t.text} onSave={(v) => { const next = withDue(t.text, v, new Date()); if (next !== t.text) void save(() => onSave(next, t.text, v ? dueLabel(next) : 'Due date cleared')); }} />
      <span class="fl-saved" role="status">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>
    </div>
  );
}

const plainSection = (name: string) => name.replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();

/** The full-screen detail (focus mode): one task, its properties, actions, subtasks, then the thread. */
export function TaskDetail({ task, all, busy, project, onToggle, onAct, onSave, onSet, onBack, extra }: {
  task: Task; all: Task[]; busy: boolean; project?: string; onToggle: (t: Task) => void; onAct: (a: 'start' | 'defer') => void; onSave: SaveText; onSet: SetPropsFn; onBack: () => void;
  /** Rendered under the actions (the task's agent thread). @req FR:agent-thread/web.hero */
  extra?: ComponentChildren;
}) {
  const r = parseRow(task.text);
  const subs = children(all, task.ref);
  const box = useRef<HTMLDivElement>(null);
  // Read the opener during the first render: the composer may take focus (autoFocus) before this component's effect runs.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => { const row = opener?.closest?.('[data-ref]')?.querySelector<HTMLElement>('.row-open'); (opener?.isConnected ? opener : row)?.focus?.(); };
  }, []);
  // The focus trap: the dialog plus the toasts, whose Undo (a property change, Done) must stay in reach by keyboard while the detail is open.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const b = box.current;
      if (e.key !== 'Tab' || !b) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && !a.closest('.toasts') && !b.contains(a)) return;
      const els = [
        ...b.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
        ...document.querySelectorAll<HTMLElement>('.toasts button'),
      ].filter((x) => !(x as HTMLButtonElement).disabled && x.getAttribute('type') !== 'hidden' && x.tabIndex >= 0);
      if (!els.length) return;
      const i = els.indexOf(a as HTMLElement);
      e.preventDefault();
      e.stopPropagation();
      els[e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length].focus();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const status = r.status ? { '🚧': 'In progress', '⏸': 'Paused', '👀': 'In review', '⏳': 'Waiting', '⛔': 'Blocked' }[r.status.replace(/️/g, '')] : undefined;
  return (
    <div ref={box} tabIndex={-1} class="focus-mode fl" role="dialog" aria-modal="true" aria-label="Task detail">
      <button type="button" class="close" aria-label="Close" title="Close" onClick={onBack}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button>
      <div class="focus-inner">
        <p class="fl-facts">{project ?? task.project} · {plainSection(task.section)}{status ? ` · ${status}` : ''}</p>
        <h1><Md text={r.title || task.text} project={task.project} /></h1>
        {/* Bare URLs parseRow lifts out of the title stay usable here. @req FR:task-detail-design/detail.facts */}
        {r.links.length > 0 && <p class="fl-links">{r.links.map((l) => <a key={l.href} class="fl-link" href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}</p>}
        <PropertyBar t={task} onSave={onSave} onSet={onSet} />
        {task.notes.length > 0 && <div class="notes big">{task.notes.map((n, i) => <p key={i}><Md text={n.trim()} project={task.project} /></p>)}</div>}
        {subs.length > 0 && (
          <ul class="checklist" aria-label="Subtasks">
            {subs.map((s) => <li key={s.ref} class={s.done ? 'done' : ''} style={{ '--depth': s.depth - task.depth - 1 }}>
              <button type="button" class="tick" aria-label={s.done ? 'Mark not done' : 'Mark done'} disabled={busy} onClick={() => onToggle(s)}><span class="box">{s.done ? '✓' : ''}</span></button>
              <span><Md text={parseRow(s.text).title || s.text} /></span>
            </li>)}
          </ul>
        )}
        <DetailActions t={task} busy={busy} onStart={() => onAct('start')} onDone={() => onToggle(task)} onDefer={() => onAct('defer')} />
        {extra}
      </div>
    </div>
  );
}
