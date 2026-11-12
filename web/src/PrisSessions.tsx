/**
 * The owner's Priorities (inline edit) and the Claude sessions that wait on him, each on its own page (`FR:notifications/pris.route`, `FR:notifications/sessions.route`).
 * @req FR:pris-sessions-ui/pris.block @req FR:pris-sessions-ui/pris.status @req FR:pris-sessions-ui/pris.expand @req FR:pris-sessions-ui/pris.edit
 * @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.row @req FR:pris-sessions-ui/sessions.archive
 * @req NFR:pris-sessions-ui/a11y.targets @req NFR:pris-sessions-ui/a11y.keys @req NFR:pris-sessions-ui/a11y.calm @req NFR:pris-sessions-ui/a11y.axe
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { groupNeeds, idsText, PROJECT_LABEL, reasonText, rowLine, safeLink, sessionLabel, STATE_WORD, ago, type SessionItem } from './inventory';
import { edits, ITEM_STATUS, LIMITS, nextItem, PRI_STATUS, progress, visiblePris, type ItemStatus, type Pri, type PriStatus } from './pris';
import type { InventoryCtl, PrisCtl } from './usePrisSessions';
import './pris-sessions.css';

/**
 * A text that turns into a field on tap. Enter or blur saves, Escape cancels; the parent drops an empty or unchanged text.
 * @req FR:pris-sessions-ui/pris.edit
 */
function InlineText({ value, label, editLabel, max, onSave, onEditing, cls, shown }: { value: string; label: string; editLabel: string; max: number; onSave: (t: string) => void; onEditing: (on: boolean) => void; cls: string; /** Button text when it is not the value itself. */ shown?: string }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState(value);
  // Enter or Escape closes first; the blur that follows the unmount must not save again.
  const live = useRef(false);
  // A field that unmounts while open (the list re-renders) must not leave re-reads paused.
  useEffect(() => () => { if (live.current) { live.current = false; onEditing(false); } }, []);
  const close = (save: boolean) => { if (!live.current) return; live.current = false; setOn(false); onEditing(false); if (save) onSave(text); };
  if (!on) return <button type="button" class={`inline-text ${cls}`} aria-label={editLabel} onClick={() => { setText(value); live.current = true; setOn(true); onEditing(true); }}>{shown ?? value}</button>;
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

function StatusSelect<S extends string>({ value, label, words, onChange }: { value: S; label: string; words: Record<S, { glyph: string; word: string }>; onChange: (s: S) => void }) {
  return (
    <select class="status-select" aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as S)}>
      {(Object.keys(words) as S[]).map((k) => <option key={k} value={k}>{words[k].glyph} {words[k].word}</option>)}
    </select>
  );
}

function PriRow({ pri, n, ids, open, onToggle, ctl }: { pri: Pri; n: number; /** Ids on screen, in order: Up and Down move among these. */ ids: string[]; open: boolean; onToggle: () => void; ctl: PrisCtl }) {
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
          <span class={`pri-status${st.warn ? ' warn' : ''}`}><span class="g">{st.glyph}</span> {st.word}</span>
        </span>
      </button>
      {open && (
        <div class="pri-panel" id={panel}>
          <div class="pri-edit-row">
            <InlineText cls="pri-title-edit" shown="Rename" value={pri.title} label="Priority title" editLabel="Rename priority" max={LIMITS.title} onEditing={ctl.setEditing} onSave={(t) => ctl.apply(edits.title(pri.id, t))} />
            <StatusSelect<PriStatus> value={pri.status} label={`Status of ${pri.title}`} words={PRI_STATUS} onChange={(s) => ctl.apply(edits.status(pri.id, s))} />
          </div>
          <ul class="pri-items">
            {pri.items.map((it, i) => (
              <li class="pri-item" key={`${i}:${it.text}`} data-status={it.status}>
                <span class={`item-glyph${ITEM_STATUS[it.status].warn ? ' warn' : ''}`} aria-hidden="true">{ITEM_STATUS[it.status].glyph}</span>
                <InlineText cls={`item-text${it.status === 'done' ? ' done' : ''}`} value={it.text} label="Item text" editLabel={`Edit item ${it.text}`} max={LIMITS.item} onEditing={ctl.setEditing} onSave={(t) => ctl.apply(edits.itemText(pri.id, i, it.text, t))} />
                <StatusSelect<ItemStatus> value={it.status} label={`Status of item ${it.text}`} words={ITEM_STATUS} onChange={(s) => ctl.apply(edits.itemStatus(pri.id, i, it.text, s))} />
                <button type="button" class="icon-btn" aria-label={`Remove item ${it.text}`} title="Remove" onClick={(e) => { const li = (e.currentTarget as HTMLElement).closest('.pri'); ctl.apply(edits.removeItem(pri.id, i, it.text)); setTimeout(() => (li?.querySelector<HTMLElement>('.add-line') ?? li?.querySelector<HTMLElement>('.pri-toggle'))?.focus(), 0); }}>×</button>
              </li>
            ))}
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

/** @req FR:pris-sessions-ui/pris.block */
/** `bare` drops the section heading: the page heading names it. */
export function PrisBlock({ ctl, bare }: { ctl: PrisCtl; bare?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  if (ctl.phase === 'absent' || ctl.phase === 'loading' || ctl.phase === 'error') return null;
  const { shown, more } = visiblePris(ctl.pris, showAll);
  const canAdd = ctl.pris.length < LIMITS.pris;
  return (
    <section class="pris" data-testid="pris" aria-labelledby={bare ? 'page-h' : 'pris-h'}>
      {!bare && <h2 class="pris-h" id="pris-h">Priorities</h2>}
      {ctl.pris.length === 0 && <p class="pris-empty">No priorities yet</p>}
      {shown.length > 0 && (
        <ol class="pri-list">
          {shown.map(({ n, pri }) => <PriRow key={pri.id} pri={pri} n={n} ids={shown.map((x) => x.pri.id)} open={openId === pri.id} onToggle={() => setOpenId(openId === pri.id ? null : pri.id)} ctl={ctl} />)}
        </ol>
      )}
      <div class="pris-foot">
        {more > 0 && <button type="button" class="more-btn" onClick={() => setShowAll(true)}>Show {more} more</button>}
        {canAdd && !adding && <button type="button" class="more-btn" onClick={() => setAdding(true)}>+ Add priority</button>}
      </div>
      {adding && <AddLine label="New priority" placeholder="New priority" max={LIMITS.title} autoFocus onEditing={(on) => { ctl.setEditing(on); if (!on) setAdding(false); }} onAdd={(t) => { ctl.apply(edits.addPri(t)); setAdding(false); ctl.setEditing(false); }} />}
    </section>
  );
}

function SessionRow({ s, now }: { s: SessionItem; now: Date }) {
  const st = STATE_WORD[s.state] ?? { glyph: '·', word: s.state };
  const href = safeLink(s.link);
  const body = (
    <>
      <span class={`s-state ${s.state}`} aria-hidden="true"><span class="g">{st.glyph}</span> {st.word}</span>
      <span class="s-main" aria-hidden="true"><span class="s-title">{s.title}</span><span class="s-line">{rowLine(s)}</span></span>
      <span class="s-time" aria-hidden="true">{ago(s.lastActivityAt, now)}</span>
    </>
  );
  return <li>{href ? <a class="session-row" href={href} aria-label={sessionLabel(s, now)}>{body}</a> : <span class="session-row" role="group" aria-label={sessionLabel(s, now)}>{body}</span>}</li>;
}

/**
 * Sessions that wait on the owner or are stuck, by project, then archive candidates (copy ids only).
 * @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.archive
 */
export function SessionsBlock({ ctl, toast, label = 'Sessions' }: { ctl: InventoryCtl; toast: (t: string, kind?: 'ok' | 'err') => void; label?: string }) {
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
