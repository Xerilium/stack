/**
 * The owner's Priorities (inline edit, a Settings section) and the Claude sessions that wait on him (the Sessions page).
 * @req FR:notifications/pris.route @req FR:notifications/sessions.route
 * @req FR:pris-sessions-ui/pris.block @req FR:pris-sessions-ui/pris.status @req FR:pris-sessions-ui/pris.item-status @req FR:pris-sessions-ui/pris.expand @req FR:pris-sessions-ui/pris.edit
 * @req FR:pris-sessions-ui/pris.rename @req FR:pris-sessions-ui/pris.context @req FR:settings/priorities.place
 * @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.row @req FR:pris-sessions-ui/sessions.line @req FR:pris-sessions-ui/sessions.name @req FR:pris-sessions-ui/sessions.link @req FR:pris-sessions-ui/sessions.archive
 * @req NFR:pris-sessions-ui/a11y.targets @req NFR:pris-sessions-ui/a11y.keys @req NFR:pris-sessions-ui/a11y.calm @req NFR:pris-sessions-ui/a11y.axe
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { groupNeeds, idsText, PROJECT_LABEL, reasonText, rowLine, safeLink, sessionLabel, stateChip, ago, type SessionItem } from './inventory';
import { Md } from './parts';
import { StatusChip } from './ui/StatusChip';
import { contextOf, edits, ITEM_STATUS, LIMITS, nextItem, PRI_STATUS, progress, visiblePris, type ItemStatus, type Pri, type PriStatus } from './pris';
import type { PrioritiesView } from './priorities';
import { LinkList } from './ui/LinkList';
import type { InventoryCtl, PrisCtl } from './usePrisSessions';
import './pris-sessions.css';
import { MoreButton } from './ui/MoreButton';

/**
 * A text that turns into a field on tap. Enter or blur saves, Escape cancels; the parent drops an empty or unchanged text.
 * @req FR:pris-sessions-ui/pris.edit
 */
function InlineText({ value, label, editLabel, max, onSave, onEditing, cls, shown, opener }: { value: string; label: string; editLabel: string; max: number; onSave: (t: string) => void; onEditing: (on: boolean) => void; cls: string; /** Button text when it is not the value itself. */ shown?: string; /** Gets the function that opens the field, for a Rename control beside it. */ opener?: { current: (() => void) | null } }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState(value);
  // Enter or Escape closes first; the blur that follows the unmount must not save again.
  const live = useRef(false);
  // A field that unmounts while open (the list re-renders) must not leave re-reads paused.
  useEffect(() => () => { if (live.current) { live.current = false; onEditing(false); } }, []);
  const close = (save: boolean) => { if (!live.current) return; live.current = false; setOn(false); onEditing(false); if (save) onSave(text); };
  const start = () => { setText(value); live.current = true; setOn(true); onEditing(true); };
  if (opener) opener.current = start;
  if (!on) return <button type="button" class={`inline-text ${cls}`} aria-label={editLabel} onClick={start}>{shown ?? value}</button>;
  return (
    <input class={`inline-input ${cls}`} type="text" value={text} maxLength={max} aria-label={label}
      ref={(el) => { if (el && document.activeElement !== el) el.focus(); }}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={() => close(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); close(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      }} />
  );
}

/** A field that adds one line on Enter or blur, then clears; Escape drops the text. */
function AddLine({ label, placeholder, max, onAdd, onEditing, autoFocus }: { label: string; placeholder: string; max: number; onAdd: (t: string) => void; onEditing: (on: boolean) => void; autoFocus?: boolean }) {
  const [text, setTextState] = useState('');
  // The ref, not the render value: Enter or Escape is followed by a blur that must see the cleared text.
  const cur = useRef('');
  const setText = (t: string) => { cur.current = t; setTextState(t); };
  const add = () => { const t = cur.current; if (t.trim()) { setText(''); onAdd(t); } };
  const focused = useRef(false);
  useEffect(() => () => { if (focused.current) onEditing(false); }, []);
  return (
    <input class="inline-input add-line" type="text" value={text} maxLength={max} aria-label={label} placeholder={placeholder}
      ref={(el) => { if (el && autoFocus && !el.dataset.f) { el.dataset.f = '1'; el.focus(); } }}
      onFocus={() => { focused.current = true; onEditing(true); }} onBlur={() => { focused.current = false; onEditing(false); add(); }}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); add(); }
        else if (e.key === 'Escape') { e.stopPropagation(); setText(''); (e.target as HTMLElement).blur(); }
      }} />
  );
}

function StatusSelect<S extends string>({ value, label, words, glyphs = true, onChange }: { value: S; label: string; words: Record<S, { glyph: string; word: string }>; /** Item statuses show a glyph; a priority status is the word only, as on its chip. */ glyphs?: boolean; onChange: (s: S) => void }) {
  return (
    <select class="status-select" aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as S)}>
      {(Object.keys(words) as S[]).map((k) => <option key={k} value={k}>{glyphs ? `${words[k].glyph} ${words[k].word}` : words[k].word}</option>)}
    </select>
  );
}

/** One item: its text (tap to edit), an explicit Rename, its status, and Remove. @req FR:pris-sessions-ui/pris.edit @req FR:pris-sessions-ui/pris.rename */
function PriItemRow({ pri, it, i, ctl }: { pri: Pri; it: Pri['items'][number]; i: number; ctl: PrisCtl }) {
  const rename = useRef<(() => void) | null>(null);
  return (
    <li class="pri-item" data-status={it.status}>
      <span class={`item-glyph${ITEM_STATUS[it.status].warn ? ' warn' : ''}`} aria-hidden="true">{ITEM_STATUS[it.status].glyph}</span>
      <InlineText cls={`item-text${it.status === 'done' ? ' done' : ''}`} value={it.text} label="Item text" editLabel={`Edit item ${it.text}`} max={LIMITS.item} opener={rename} onEditing={ctl.setEditing} onSave={(t) => ctl.apply(edits.itemText(pri.id, i, it.text, t))} />
      <button type="button" class="icon-btn" aria-label={`Rename item ${it.text}`} title="Rename" onClick={() => rename.current?.()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <StatusSelect<ItemStatus> value={it.status} label={`Status of item ${it.text}`} words={ITEM_STATUS} onChange={(s) => ctl.apply(edits.itemStatus(pri.id, i, it.text, s))} />
      <button type="button" class="icon-btn" aria-label={`Remove item ${it.text}`} title="Remove" onClick={(e) => { const li = (e.currentTarget as HTMLElement).closest('.pri'); ctl.apply(edits.removeItem(pri.id, i, it.text)); setTimeout(() => (li?.querySelector<HTMLElement>('.add-line') ?? li?.querySelector<HTMLElement>('.pri-toggle'))?.focus(), 0); }}>×</button>
    </li>
  );
}

function PriRow({ pri, n, ids, open, onToggle, ctl, report }: { pri: Pri; n: number; /** Ids on screen, in order: Up and Down move among these. */ ids: string[]; open: boolean; onToggle: () => void; ctl: PrisCtl; /** The priorities report, for the context links. */ report: PrioritiesView | null }) {
  const st = PRI_STATUS[pri.status];
  const pr = progress(pri);
  const next = nextItem(pri);
  const panel = `pri-panel-${pri.id}`;
  return (
    <li class={`pri${open ? ' open' : ''}${st.warn ? ' warn' : ''}`} data-id={pri.id}>
      <button type="button" class="pri-toggle" aria-expanded={open} aria-controls={panel} aria-label={[`${n}. ${pri.title}`, st.word, pr.total ? `${pr.done} of ${pr.total} done` : '', next ? `next: ${next.text}` : ''].filter(Boolean).join(', ')} onClick={onToggle}>
        <span class="pri-n" aria-hidden="true">{n}</span>
        <span class="pri-main" aria-hidden="true">
          <span class="pri-title">{pri.title}</span>
          {next && !open && <span class="pri-next">{next.text}</span>}
        </span>
        <span class="pri-side" aria-hidden="true">
          {pr.total > 0 && <span class="pri-progress">{pr.done}/{pr.total}</span>}
          <StatusChip label={st.word} tone={st.warn ? 'warn' : 'neutral'} />
        </span>
      </button>
      {open && (
        <div class="pri-panel" id={panel}>
          {/* @req FR:pris-sessions-ui/pris.context */}
          <LinkList label="Context" items={contextOf(pri, report)} />
          <div class="pri-edit-row">
            <InlineText cls="pri-title-edit" shown="Rename" value={pri.title} label="Priority title" editLabel="Rename priority" max={LIMITS.title} onEditing={ctl.setEditing} onSave={(t) => ctl.apply(edits.title(pri.id, t))} />
            <StatusSelect<PriStatus> value={pri.status} label={`Status of ${pri.title}`} words={PRI_STATUS} glyphs={false} onChange={(s) => ctl.apply(edits.status(pri.id, s))} />
          </div>
          <ul class="pri-items">
            {pri.items.map((it, i) => <PriItemRow key={`${i}:${it.text}`} pri={pri} it={it} i={i} ctl={ctl} />)}
          </ul>
          {pri.items.length < LIMITS.items && <AddLine label="New item" placeholder="Add item" max={LIMITS.item} onEditing={ctl.setEditing} onAdd={(t) => ctl.apply(edits.addItem(pri.id, t))} />}
          <div class="pri-move">
            <button type="button" class="btn quiet" disabled={ids[0] === pri.id} aria-label={`Move ${pri.title} up`} onClick={() => ctl.apply(edits.move(pri.id, -1, ids))}>↑ Up</button>
            <button type="button" class="btn quiet" disabled={ids.at(-1) === pri.id} aria-label={`Move ${pri.title} down`} onClick={() => ctl.apply(edits.move(pri.id, 1, ids))}>↓ Down</button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * What the Sessions page shows while its data is not ready: loading, failed, or not on this host.
 * @req FR:notifications/pris.states
 */
export function PageNote({ phase, what }: { phase: 'loading' | 'ready' | 'absent' | 'error'; what: string }) {
  if (phase === 'loading') return <p class="page-note" role="status" data-testid="page-note">Loading {what.toLowerCase()}…</p>;
  if (phase === 'error') return <p class="page-note" role="alert" data-testid="page-note">Cannot load {what.toLowerCase()}. It tries again by itself.</p>;
  if (phase === 'absent') return <p class="page-note" data-testid="page-note">{what} are not on this host.</p>;
  return null;
}

/** `labelledBy` drops the section heading: the heading with that id names it (the Settings section). @req FR:pris-sessions-ui/pris.block */
export function PrisBlock({ ctl, labelledBy, report = null }: { ctl: PrisCtl; labelledBy?: string; /** The priorities report, for the context links. */ report?: PrioritiesView | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  if (ctl.phase === 'absent' || ctl.phase === 'loading' || ctl.phase === 'error') return null;
  const { shown, more } = visiblePris(ctl.pris, showAll);
  const canAdd = ctl.pris.length < LIMITS.pris;
  return (
    <section class="pris" data-testid="pris" aria-labelledby={labelledBy ?? 'pris-h'}>
      {!labelledBy && <h2 class="pris-h" id="pris-h">Priorities</h2>}
      {ctl.pris.length === 0 && <p class="pris-empty">No priorities yet</p>}
      {shown.length > 0 && (
        <ol class="pri-list">
          {shown.map(({ n, pri }) => <PriRow key={pri.id} pri={pri} n={n} ids={shown.map((x) => x.pri.id)} open={openId === pri.id} onToggle={() => setOpenId(openId === pri.id ? null : pri.id)} ctl={ctl} report={report} />)}
        </ol>
      )}
      <div class="pris-foot">
        {more > 0 && <MoreButton count={more} onMore={() => setShowAll(true)} />}
        {canAdd && !adding && <button type="button" class="more-btn" onClick={() => setAdding(true)}>+ Add priority</button>}
      </div>
      {adding && <AddLine label="New priority" placeholder="New priority" max={LIMITS.title} autoFocus onEditing={(on) => { ctl.setEditing(on); if (!on) setAdding(false); }} onAdd={(t) => { ctl.apply(edits.addPri(t)); setAdding(false); ctl.setEditing(false); }} />}
    </section>
  );
}

function SessionRow({ s, now }: { s: SessionItem; now: Date }) {
  const st = stateChip(s.state);
  const href = safeLink(s.link);
  const body = (
    <>
      <span class="s-main" aria-hidden="true"><span class="s-title">{s.title}</span><span class="s-line"><Md text={rowLine(s)} links={false} /></span></span>
      <span class="s-state" aria-hidden="true"><StatusChip label={st.word} tone={st.tone} /></span>
      <span class="s-time" aria-hidden="true">{ago(s.lastActivityAt, now)}</span>
    </>
  );
  return <li>{href ? <a class="session-row" href={href} aria-label={sessionLabel(s, now)}>{body}</a> : <span class="session-row" role="group" aria-label={sessionLabel(s, now)}>{body}</span>}</li>;
}

/**
 * Sessions that wait on the owner or are stuck, by project, then archive candidates (copy ids only).
 * @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.archive
 */
export function SessionsBlock({ ctl, toast, label = 'Sessions' }: { ctl: InventoryCtl; toast: (t: string, kind?: 'ok' | 'err') => void; /** The list heading. */ label?: string }) {
  const [openArchive, setOpenArchive] = useState(false);
  const inv = ctl.inv;
  const now = new Date();
  const announce = <p class="sr-only" role="status" aria-live="polite" data-testid="sessions-announce">{ctl.announce}</p>;
  if (ctl.phase === 'absent' || !inv) return null;
  const groups = groupNeeds(inv.needsYou);
  const copy = async () => {
    const text = idsText(inv.archive);
    try { await navigator.clipboard.writeText(text); } catch {
      // Fallback for hosts that deny the async clipboard.
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
      if (!ok) { toast('Copy failed', 'err'); return; }
    }
    toast(`Copied ${inv.archive.length} ${inv.archive.length === 1 ? 'id' : 'ids'}`);
  };
  return (
    <>
      {announce}
      {/* @req FR:pris-sessions-ui/sessions.empty */}
      {ctl.phase === 'ready' && groups.length === 0 && inv.archive.length === 0 && <p class="sessions-empty" data-testid="sessions-empty">No sessions wait on you.</p>}
      {groups.length > 0 && (
        <section class="sessions-need" data-testid="sessions" aria-labelledby="sessions-h">
          <h2 class="sessions-h" id="sessions-h">{label} <span class="count" aria-label={`${inv.needsYou.length} need you`}>{inv.needsYou.length}</span></h2>
          {groups.map((g) => (
            <div class="s-group" key={g.project}>
              <h3 class="s-proj">{g.label}</h3>
              <ul class="s-list">{g.items.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</ul>
            </div>
          ))}
        </section>
      )}
      {inv.archive.length > 0 && (
        <div class="archive">
          <button type="button" class="foot-btn" aria-expanded={openArchive} aria-controls="archive-list" onClick={() => setOpenArchive(!openArchive)}>Archive candidates · {inv.archive.length}</button>
          {openArchive && (
            <div id="archive-list">
              <ul class="archive-list">
                {inv.archive.map((s) => {
                  const href = safeLink(s.link);
                  return <li key={s.id}>{href ? <a href={href}>{s.title}</a> : <span>{s.title}</span>}<span class="a-meta">{PROJECT_LABEL[s.project] ?? s.project} · {reasonText(s.reason)}</span></li>;
                })}
              </ul>
              <button type="button" class="btn" onClick={() => void copy()}>Copy ids</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
