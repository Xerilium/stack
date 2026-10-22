import { useEffect, useRef, useState } from 'preact/hooks';
import type { CapacityRow } from './capacity';
import type { Filters } from './filters';
import { Chip, GROUPS, GROUP_NAMES, Md, type GroupName } from './parts';
import { parseRow } from './row';
import type { NextTask, Project, Task } from './types';

export const chipsOf = (text: string) => {
  const r = parseRow(text);
  return GROUP_NAMES.filter((g) => r[g]).map((g) => ({ group: g, value: r[g]! }));
};

/** @req FR:web-app/next.show @req FR:web-app/next.actions */
export function NextView({ task, busy, onAct, onPick }: {
  task: NextTask | null; busy: boolean; onAct: (a: 'start' | 'done' | 'skip' | 'suspend', days?: number) => void; onPick: (refs: string[], g: GroupName | GroupName[]) => void;
}) {
  if (!task) {
    return (
      <section class="empty" aria-label="Next task">
        <h1>Nothing active</h1>
        <p>Add something with the capture box, or press <kbd>c</kbd>.</p>
      </section>
    );
  }
  const r = parseRow(task.text);
  return (
    <section class="next-card" aria-label="Next task">
      <p class="eyebrow">Next up · {task.project}</p>
      <h1 data-testid="next-title"><Md text={r.title || task.text} /></h1>
      <div class="chips">
        {chipsOf(task.text).map((c) => <Chip key={c.group} {...c} onPick={(g) => onPick([task.ref], g)} />)}
        <button type="button" class="chip ghost" aria-label="Set properties" onClick={() => onPick([task.ref], GROUP_NAMES)}>＋</button>
        {r.due && <span class="meta">Due {r.due}</span>}
        {r.recurrence && <span class="meta">Repeats {r.recurrence}</span>}
      </div>
      <div class="actions">
        <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start')}><u>S</u>tart</button>
        <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('done')}><u>D</u>one</button>
        <button type="button" class="btn" disabled={busy} onClick={() => onAct('skip')}>Ski<u>p</u></button>
        <button type="button" class="btn" disabled={busy} onClick={() => onAct('suspend', 1)}>Suspend 1 day</button>
        <button type="button" class="btn" disabled={busy} onClick={() => onAct('suspend', 7)}>Suspend 1 week</button>
      </div>
    </section>
  );
}

export interface ListProps {
  rows: Task[]; projects: Project[]; filters: Filters; cursor: string | null; selected: Set<string>; editing: string | null; busy: boolean;
  drag: { ref: string; over: string | null; half: 'top' | 'bottom' } | null;
  onFilters: (f: Partial<Filters>) => void; onCursor: (ref: string) => void; onSelect: (ref: string) => void;
  onEdit: (ref: string | null) => void; onSave: (ref: string, text: string) => void; onToggle: (t: Task) => void;
  onPick: (refs: string[], g: GroupName | GroupName[]) => void; onMove: (ref: string, dir: 'up' | 'down') => void;
  onDragStart: (ref: string, e: PointerEvent) => void; searchRef: { current: HTMLInputElement | null };
}

/** @req FR:web-app/list.view @req FR:web-app/list.filters */
export function ListView(p: ListProps) {
  const f = p.filters;
  const chips: [string, string, () => void][] = [];
  if (f.project) chips.push(['Project', f.project, () => p.onFilters({ project: '' })]);
  if (f.state !== 'open') chips.push(['Show', f.state, () => p.onFilters({ state: 'open' })]);
  for (const g of ['status', 'priority', 'effort'] as const) if (f[g]) chips.push([GROUPS[g].label, f[g], () => p.onFilters({ [g]: '' })]);
  let lastKey = '';
  return (
    <section aria-label="Task list">
      <div class="filters" role="search">
        <input ref={(el) => { p.searchRef.current = el; }} type="search" aria-label="Search tasks" placeholder="Search ( / )" value={f.q} onInput={(e) => p.onFilters({ q: (e.target as HTMLInputElement).value })}
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
      <p class="count" aria-live="polite">{p.rows.length} task{p.rows.length === 1 ? '' : 's'}</p>
      {p.rows.length === 0 && <p class="empty-note">No tasks match.</p>}
      <ul class="rows" data-testid="rows">
        {p.rows.map((t) => {
          const key = `${t.project}/${t.section}`;
          const head = key !== lastKey;
          lastKey = key;
          return (
            <>
              {head && <li class="group" key={`h-${key}`} role="presentation"><span>{t.project}</span> <span class="sec">{t.section}</span></li>}
              <TaskRow key={t.ref} t={t} p={p} />
            </>
          );
        })}
      </ul>
    </section>
  );
}

function TaskRow({ t, p }: { t: Task; p: ListProps }) {
  const r = parseRow(t.text);
  const isCursor = p.cursor === t.ref;
  const editing = p.editing === t.ref;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (isCursor && !editing) ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [isCursor, editing]);
  const d = p.drag;
  const cls = ['row', t.done ? 'done' : '', isCursor ? 'cursor' : '', p.selected.has(t.ref) ? 'selected' : '',
    d?.over === t.ref ? `drop-${d.half}` : '', d?.ref === t.ref ? 'dragging' : ''].filter(Boolean).join(' ');
  return (
    <li ref={ref} class={cls} data-ref={t.ref} style={{ '--depth': t.depth }} aria-current={isCursor ? 'true' : undefined} onClick={() => p.onCursor(t.ref)}>
      <button type="button" class="handle" aria-label={`Drag ${r.title || 'task'} to reorder`} title="Drag to reorder (Shift+J/K)"
        onPointerDown={(e) => p.onDragStart(t.ref, e as unknown as PointerEvent)}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); p.onMove(t.ref, 'up'); } if (e.key === 'ArrowDown') { e.preventDefault(); p.onMove(t.ref, 'down'); } }}>⠿</button>
      <input type="checkbox" class="sel" aria-label={`Select ${r.title || 'task'}`} checked={p.selected.has(t.ref)} onClick={(e) => e.stopPropagation()} onChange={() => p.onSelect(t.ref)} />
      <button type="button" class="tick" aria-label={t.done ? 'Mark not done' : 'Mark done'} disabled={p.busy} onClick={(e) => { e.stopPropagation(); p.onToggle(t); }}>{t.done ? '✓' : '○'}</button>
      <div class="body">
        {editing ? (
          <Editor text={t.text} onSave={(v) => p.onSave(t.ref, v)} onCancel={() => p.onEdit(null)} />
        ) : (
          <>
            <div class="title" onDblClick={() => p.onEdit(t.ref)}><Md text={r.title || t.text} /></div>
            <div class="chips">
              {chipsOf(t.text).map((c) => <Chip key={c.group} {...c} onPick={(g) => p.onPick([t.ref], g)} />)}
              <button type="button" class="chip ghost" aria-label="Set properties" onClick={(e) => { e.stopPropagation(); p.onPick([t.ref], GROUP_NAMES); }}>＋</button>
              {r.due && <span class="meta">Due {r.due}</span>}
              {r.recurrence && <span class="meta">↻ {r.recurrence}</span>}
              {r.suspend && <span class="meta">💤 {r.suspend}</span>}
            </div>
            {t.notes.length > 0 && <div class="notes">{t.notes.map((n, i) => <div key={i}><Md text={n.trim()} /></div>)}</div>}
          </>
        )}
      </div>
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

/** @req FR:web-app/capacity.view */
export function CapacityView({ rows }: { rows: CapacityRow[] }) {
  return (
    <section aria-label="Capacity">
      <h1>Capacity</h1>
      <ul class="cap-list">
        {rows.map((r) => (
          <li key={r.project} class={`cap${r.over ? ' over' : ''}${r.capacity === null ? ' nocap' : ''}`} data-testid={`cap-${r.project}`}>
            <div class="cap-head"><strong>{r.title || r.project}</strong><span>{r.open} open</span></div>
            <div class="bar" role="meter" aria-label={`${r.project} load`} aria-valuemin={0} aria-valuemax={r.capacity ?? undefined} aria-valuenow={Math.round(r.hours * 10) / 10}>
              <div class="fill" style={{ width: `${Math.min(100, (r.ratio ?? (r.hours > 0 ? 1 : 0)) * 100)}%` }} />
            </div>
            <div class="cap-foot">
              <span>{fmt(r.hours)}h of effort</span>
              <span>{r.capacity === null ? 'no capacity set' : `${fmt(r.capacity)}h capacity${r.over ? ' · over' : ''}`}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
const fmt = (n: number) => String(Math.round(n * 10) / 10);
