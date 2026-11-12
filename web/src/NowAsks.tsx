/**
 * Now's `Waiting on you`: the top asks as cards. The body expands the card in place with the ask's context and every
 * response it supports; answers go through the same calls as Needs you (toast and Undo).
 * @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.expand @req FR:ux-consolidation/one.answer
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Avatar } from './AgentAvatar';
import { actionsFor, deadline, ifSilent, type Action, type AskItem, type DeferChoice, type Send } from './asks';
import type { AvatarWho } from './avatar';

export interface AskCtl {
  busy: boolean; now: Date;
  /** The agent an ask comes from, for its name and avatar. */
  whoOf: (from: string) => AvatarWho;
  answer: (a: AskItem, s: Send) => void;
  reply: (a: AskItem, text: string) => void;
  defer: (a: AskItem, c: DeferChoice) => void;
  deferChoices: () => DeferChoice[];
  /** A task row's Details. */
  openTask: (a: AskItem) => void;
  /** The ask in Needs you. */
  openInNeeds: (a: AskItem) => void;
}

type Panel = 'none' | 'reply' | 'defer';
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function Card({ a, i, open, panel, ctl, onToggle, onPanel }: { a: AskItem; i: number; open: boolean; panel: Panel; ctl: AskCtl; onToggle: () => void; onPanel: (p: Panel) => void }) {
  const who = ctl.whoOf(a.from);
  const actions = actionsFor(a);
  const primary = actions.find((x) => x.primary && x.send) ?? actions.find((x) => x.send);
  const dl = deadline(a.by, ctl.now);
  const silent = ifSilent(a);
  const isAnswer = a.kind === 'answer';
  const replying = panel === 'reply' || (isAnswer && panel !== 'defer');
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (open && panel === 'reply') field.current?.focus(); }, [open, panel]);
  const id = `now-ask-${i}`;
  const run = (x: Action) => {
    if (x.send) ctl.answer(a, x.send);
    else if (x.reply) onPanel('reply');
    else if (x.open && a.source === 'task') ctl.openTask(a);
  };
  const send = () => { const t = text.trim(); if (!t || ctl.busy) return; ctl.reply(a, t); setText(''); };
  return (
    <li class={`now-ask${open ? ' open' : ''}`} data-key={a.key}>
      <div class="now-ask-head">
        <button type="button" class="now-ask-body" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span class="now-ask-title">{a.ask}</span>
          <span class="now-ask-meta">
            <Avatar who={who} size={20} /><span class="now-ask-from">{who.name}</span>
            {dl && <span class={`now-ask-dl ${dl.tone}`}>{dl.tone === 'late' ? dl.rel : dl.label}</span>}
            {a.overdue && dl?.tone !== 'late' && <span class="now-late">overdue</span>}
          </span>
        </button>
        {!open && (primary
          ? <button type="button" class="now-mini" disabled={ctl.busy} onClick={() => ctl.answer(a, primary.send!)}>{primary.label}</button>
          : <button type="button" class="now-mini" onClick={() => onPanel('reply')}>Reply</button>)}
      </div>
      {open && (
        <div class="now-ask-more" id={id} data-testid="now-ask-more">
          {a.why && <p class="now-ask-why">{a.why}</p>}
          <dl class="now-ask-facts">
            {a.recommend && <div><dt>Recommend</dt><dd>{a.recommend}</dd></div>}
            {a.options && a.options.length > 0 && a.kind !== 'decide' && <div><dt>Options</dt><dd>{a.options.join(' · ')}</dd></div>}
            <div class={silent.waits ? 'waits' : ''}><dt>Default</dt><dd>{silent.text}</dd></div>
            {dl && <div><dt>Due</dt><dd class={`now-ask-dl ${dl.tone}`}>{dl.label} · {dl.rel}</dd></div>}
            <div><dt>From</dt><dd class="now-ask-who"><Avatar who={who} size={24} />{who.name}{a.project ? ` · ${a.project}` : ''}</dd></div>
          </dl>
          <div class="now-ask-acts" role="group" aria-label="Respond">
            {actions.map((x) => (x.open && a.source !== 'task'
              ? a.link && <a key={x.id} class="now-act" href={a.link} target="_blank" rel="noopener noreferrer">Open {host(a.link)} <span aria-hidden="true">↗</span></a>
              : <button key={x.id} type="button" class={`now-act${x.primary ? ' primary' : ''}`} disabled={ctl.busy && !!x.send} onClick={() => run(x)}>{x.label}</button>))}
            {!isAnswer && <button type="button" class="now-act quiet" aria-expanded={panel === 'reply'} onClick={() => onPanel(panel === 'reply' ? 'none' : 'reply')}>Reply</button>}
            <button type="button" class="now-act quiet" aria-expanded={panel === 'defer'} onClick={() => onPanel(panel === 'defer' ? 'none' : 'defer')}>Defer</button>
          </div>
          {panel === 'defer' && (
            <div class="now-ask-defer" role="group" aria-label="Defer until">
              {ctl.deferChoices().map((c) => <button key={c.key} type="button" class="now-act" onClick={() => ctl.defer(a, c)}>{c.label}</button>)}
            </div>
          )}
          {replying && (
            <form class="now-ask-reply" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input ref={field} type="text" maxLength={1000} value={text} aria-label={`Reply to ${who.name}`} placeholder={isAnswer ? `Answer ${who.name}` : `Reply to ${who.name}`} aria-describedby={`${id}-hint`}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLElement).blur(); onPanel('none'); } }} />
              <button type="submit" class="now-act primary" disabled={!text.trim() || ctl.busy}>Send</button>
              <p class="now-ask-hint" id={`${id}-hint`}>End with ? to ask a question; anything else is an instruction.</p>
            </form>
          )}
          <button type="button" class="now-ask-needs" onClick={() => ctl.openInNeeds(a)}>Open in Needs you</button>
        </div>
      )}
    </li>
  );
}

export function NowAsks({ rows, more, ctl, onOpenAsks }: { rows: AskItem[]; more: number; ctl: AskCtl; onOpenAsks: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  // An answered card leaves; nothing stays open in its place.
  const openRow = rows.find((r) => r.key === openKey) ?? null;
  return (
    <>
      <h2 class="now-h2">Waiting on you</h2>
      {rows.length === 0 ? <p class="now-none">Nothing waiting.</p> : (
        <ul class="now-asks" data-testid="now-asks">
          {rows.map((a, i) => (
            <Card key={a.key} a={a} i={i} open={openRow?.key === a.key} panel={openRow?.key === a.key ? panel : 'none'} ctl={ctl}
              onToggle={() => { setOpenKey(openRow?.key === a.key ? null : a.key); setPanel('none'); }}
              onPanel={(p) => { setOpenKey(a.key); setPanel(p); }} />
          ))}
        </ul>
      )}
      {more > 0 && <button type="button" class="now-more" onClick={onOpenAsks}>{more} more in Needs you <span aria-hidden="true">→</span></button>}
    </>
  );
}
