import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CapacityRow } from './capacity';
import type { Filters } from './filters';
import { children } from './now';
import { Chip, glyphOf, GROUPS, GROUP_NAMES, Md, type GroupName } from './parts';
import { parseRow } from './row';
import type { NextTask, Task } from './types';

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
      onPointerDown={(e) => { if (e.pointerType !== 'touch') return; const h = setTimeout(() => p.onSelect(t.ref), 450); const off = () => { clearTimeout(h); window.removeEventListener('pointerup', off); window.removeEventListener('pointermove', off); }; window.addEventListener('pointerup', off); window.addEventListener('pointermove', off); }}>
      <div class="line">
        {p.handles && <button type="button" class="handle" aria-label={`Drag ${r.title || 'task'} to reorder`} title="Drag to reorder (Shift+J/K)"
          onPointerDown={(e) => p.onDragStart(t.ref, e as unknown as PointerEvent)}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); p.onMove(t.ref, 'up'); } if (e.key === 'ArrowDown') { e.preventDefault(); p.onMove(t.ref, 'down'); } }}>⠿</button>}
        <button type="button" class="tick" aria-label={t.done ? 'Mark not done' : 'Mark done'} disabled={p.busy} onClick={(e) => { e.stopPropagation(); if (e.shiftKey || e.metaKey || e.ctrlKey) p.onSelect(t.ref); else p.onToggle(t); }}><span class="box">{t.done ? '✓' : ''}</span></button>
        {editing ? (
          <Editor text={t.text} onSave={(v) => p.onSave(t.ref, v)} onCancel={() => p.onEdit(null)} />
        ) : (
          <>
            <div class="title" onDblClick={() => p.onEdit(t.ref)}>{r.status && <Chip group="status" value={r.status} onPick={(g) => p.onPick([t.ref], g)} />}<Tags r={r} /><Md text={r.title || t.text} /></div>
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
export function ProjectsView({ rows, onOpen }: { rows: (CapacityRow & { top?: Task })[]; onOpen: (p: string) => void }) {
  return (
    <section aria-label="Projects">
      <h1 class="h1">Projects</h1>
      <ul class="proj-list">
        {rows.map((r) => (
          <li key={r.project} class={`proj${r.over ? ' over' : ''}${r.capacity === null ? ' nocap' : ''}`} data-testid={`cap-${r.project}`}>
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
