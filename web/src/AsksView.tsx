/**
 * The Asks view: the few things that need the owner, ranked, one exact ask each.
 * @req FR:ask-queue/web.home @req FR:ask-queue/web.card @req FR:ask-queue/web.actions @req FR:ask-queue/web.keys @req FR:ask-queue/web.empty
 * @req FR:ask-queue/web.a11y @req FR:ask-queue/web.responsive @req FR:ask-queue/web.live @req FR:ask-queue/web.optimistic
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { actionsFor, deadline, freshness, ifSilent, splitTop, type Action, type AskItem } from './asks';
import type { Asks } from './useAsks';
import './asks.css';

const TOP = 5;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
const ANSWER_WORD: Record<string, string> = { go: 'Approved', no: 'Rejected', option: 'Chose', reply: 'Replied', ask: 'Asked', done: 'Done' };

const Icon = {
  clock: <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M8 4.6V8l2.3 1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>,
  hourglass: <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 2h7M4.5 14h7M5 2c0 3.2 3 3.6 3 6s-3 2.8-3 6M11 2c0 3.2-3 3.6-3 6s3 2.8 3 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>,
  out: <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>,
  check: <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M15.5 24.5l5.8 5.8 11.2-12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>,
};

/** Sync state with a working action in every state that is not good. @req FR:live-deploy/web.state @req FR:live-deploy/web.action */
function LiveBadge({ a, onSignIn }: { a: Asks; onSignIn?: () => void }) {
  const at = a.syncedAt ? a.syncedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const text = { connecting: 'Connecting…', live: 'Live', poll: at ? `Synced ${at}` : 'Synced', offline: 'Offline · retrying', signin: 'Sign-in expired' }[a.status];
  return (
    <div class={`live ${a.status}`} role="status" aria-live="polite" data-testid="live-status" title={a.status === 'poll' ? 'Checks for changes every 15 s' : undefined}>
      <span class="dot" aria-hidden="true" />
      <span>{text}</span>
      {a.status === 'offline' && <button type="button" class="link" onClick={a.retryNow}>Retry now</button>}
      {a.status === 'signin' && <button type="button" class="link" onClick={onSignIn ?? (() => location.assign('/.auth/login/github'))}>Sign in</button>}
    </div>
  );
}

/** Row text for a deadline: the time, plus how late when it has passed, so an overdue row never reads like one due later today. */
function rowDeadline(d: ReturnType<typeof deadline>): string | undefined {
  if (!d) return undefined;
  return d.tone === 'late' ? `${d.label} · ${d.rel}` : d.label;
}

function DeadlineChip({ by, now, long }: { by?: string; now: Date; long?: boolean }) {
  const d = deadline(by, now);
  if (!d) return null;
  const late = d.tone === 'late';
  return <span class={`dl ${d.tone}`} title={d.rel}>{long && Icon.clock}<span>{d.label}</span>{(long || late) && <span class="rel">· {d.rel}</span>}</span>;
}

/** What the owner would do with this ask, so the list can be triaged without opening each row. */
function verbOf(a: AskItem): string | undefined {
  const p = actionsFor(a).find((x) => x.primary)?.label;
  return { approve: p, decide: 'Decide', review: 'Review', 'go-do': 'Do', answer: 'Answer' }[a.kind];
}

function Row({ a, n, now, fresh, leaving, onPick }: { a: AskItem; n: number; now: Date; fresh: boolean; leaving?: boolean; onPick: () => void }) {
  const verb = verbOf(a);
  return (
    <li class={`ask-li${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}`} data-key={a.key}>
      <button type="button" class="ask-row" onClick={onPick} aria-label={[`${n}. ${a.ask}`, verb, rowDeadline(deadline(a.by, now)), a.project].filter(Boolean).join(', ')}>
        <span class="row-title">{a.ask}</span>
        {fresh && <span class="new" aria-label="New">New</span>}
        <span class="row-meta"><span class="verb">{verb ?? ''}</span>{a.by ? <DeadlineChip by={a.by} now={now} /> : <span class="dl empty" aria-hidden="true" />}<span class="proj">{a.project ?? ''}</span></span>
      </button>
    </li>
  );
}

function Btn({ a, act, run, panel }: { a: Action; act: AskItem; run: (x: Action) => void; panel: string }) {
  const cls = `btn${a.primary ? ' primary' : ''}`;
  const key = a.key === 'Enter' ? '⏎' : a.key;
  const tag = a.primary && act.kind === 'decide' && act.recommend ? <span class="rec-tag">recommended</span> : null;
  if (a.open) return <a class={cls} href={act.link} target="_blank" rel="noopener noreferrer" aria-keyshortcuts="o">{a.label} {Icon.out}<kbd aria-hidden="true">{a.key}</kbd></a>;
  return <button type="button" class={cls} onClick={() => run(a)} aria-keyshortcuts={a.key}>{a.label}{tag}{!(a.primary && panel === 'reply') && <kbd aria-hidden="true">{key}</kbd>}</button>;
}

function Card({ a, n, total, asks, run }: { a: AskItem; n: number; total: number; asks: Asks; run: (x: Action) => void }) {
  const actions = actionsFor(a);
  const silent = ifSilent(a);
  const primary = actions.find((x) => x.primary);
  const showRec = !!a.recommend && !(primary && primary.label.toLowerCase() === a.recommend.trim().toLowerCase());
  const replyRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { if (asks.panel !== 'reply') setText(''); }, [asks.panel, a.key]);
  const choices = asks.deferChoices();
  const isAnswer = a.kind === 'answer';
  const replying = (asks.panel === 'reply' || isAnswer) && asks.panel !== 'defer';
  return (
    <li class={`ask-li${asks.fresh.has(a.key) ? ' fresh' : ''}`} data-key={a.key}>
      <article class="ask-card" data-kind={a.kind} data-panel={asks.panel} aria-label={`Ask ${n} of ${total}`}>
        <div class="ask-eyebrow">
          <span class="of" aria-hidden="true">{n} of {total}</span>
          {a.project && <span class="proj">{a.project}</span>}
          <span class="from">{a.from}</span>
          {asks.fresh.has(a.key) && <span class="new">New</span>}
          <span class="grow" />
          <DeadlineChip by={a.by} now={asks.now} long />
        </div>
        <h2 class="ask-title">{a.ask}</h2>
        {a.why && <p class="ask-why">{a.why}</p>}
        {a.agentReply && <p class="ask-reply"><strong>{a.from}</strong>{a.agentReply}</p>}
        <dl class="ask-facts">
          {showRec && <div><dt>Recommend</dt><dd>{a.recommend}</dd></div>}
          <div class={silent.waits ? 'waits' : ''}><dt class="sr-only">Default</dt><dd class="silent">{Icon.hourglass}<span>{silent.text}</span></dd></div>
        </dl>
        {asks.panel === 'defer' ? (
          <div class="ask-defer" role="group" aria-label="Defer until">
            <span class="lbl">Defer until</span>
            {choices.map((c) => <button type="button" class="btn" key={c.key} onClick={() => void asks.defer(a, c.at, c.label)}>{c.label}<kbd aria-hidden="true">{c.key}</kbd></button>)}
            <button type="button" class="btn quiet cancel" onClick={() => asks.setPanel('none')}>Cancel<kbd aria-hidden="true">Esc</kbd></button>
          </div>
        ) : (
          !isAnswer && (
            <div class="ask-actions">
              {actions.map((x) => <Btn key={x.id} a={x} act={a} run={run} panel={asks.panel} />)}
              <span class="grow" />
              <button type="button" class="btn quiet" onClick={() => asks.setPanel('defer')}>Defer<kbd aria-hidden="true">z</kbd></button>
              <button type="button" class="btn quiet" onClick={() => asks.setPanel(asks.panel === 'reply' ? 'none' : 'reply')} aria-expanded={asks.panel === 'reply'}>Reply<kbd aria-hidden="true">r</kbd></button>
            </div>
          )
        )}
        {replying && (
          <>
            <form class="ask-reply-box" onSubmit={(e) => { e.preventDefault(); void asks.reply(a, text); }}>
              <input ref={(el) => { replyRef.current = el; if (el && asks.panel === 'reply' && document.activeElement !== el) el.focus(); }} type="text" value={text} maxLength={1000} aria-label={isAnswer ? `Answer ${a.from}` : `Reply to ${a.from}`} placeholder={isAnswer ? `Answer ${a.from}` : `Reply to ${a.from}`}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLElement).blur(); asks.setPanel('none'); } }} />
              <button type="submit" class="btn primary send" disabled={!text.trim()}>Send<kbd aria-hidden="true">⏎</kbd></button>
              {isAnswer && <button type="button" class="btn quiet" onClick={() => asks.setPanel('defer')}>Defer<kbd aria-hidden="true">z</kbd></button>}
            </form>
            <p class="hint">End with ? to ask a question; anything else is an instruction</p>
          </>
        )}
        {a.detail && <button type="button" class="more-link" onClick={() => asks.setDetail(!asks.detail)} aria-expanded={asks.detail}>{asks.detail ? 'Hide details' : 'Show details'}<kbd aria-hidden="true">e</kbd></button>}
        {asks.detail && a.detail && <pre class="ask-detail">{a.detail}</pre>}
      </article>
    </li>
  );
}

function Skeleton() {
  return <ol class="asks" aria-busy="true" aria-label="Loading asks"><li class="sk big" /><li class="sk" /><li class="sk" /></ol>;
}

export interface NotifyCtl { supported: boolean; on: boolean; blocked: boolean; toggle: () => void }

export function AsksView({ asks, notify, offline = false, onSignIn }: { asks: Asks; notify?: NotifyCtl; offline?: boolean; onSignIn?: () => void }) {
  const { items, cursor } = asks;
  const [openSent, setOpenSent] = useState(false);
  const [openSnoozed, setOpenSnoozed] = useState(false);
  const { shown, more } = splitTop(items, TOP, asks.showAll);
  const live = useRef('');
  const [announce, setAnnounce] = useState('');
  // announce a changed count politely, never on the first load and never by moving focus
  useEffect(() => {
    if (asks.phase !== 'ready') return;
    const text = `${asks.total} ${asks.total === 1 ? 'ask needs' : 'asks need'} you`;
    if (live.current && live.current !== text) setAnnounce(text);
    live.current = text;
  }, [asks.total, asks.phase]);

  useEffect(() => { document.querySelector('.ask-card')?.scrollIntoView({ block: 'nearest' }); }, [asks.cursor]);

  const run = (x: Action) => {
    const a = asks.itemsRef.current.find((i) => i.key === asks.cursorRef.current) ?? asks.current;
    if (!a) return;
    if (x.open) { if (a.link) window.open(a.link, '_blank', 'noopener,noreferrer'); return; }
    if (x.reply) { asks.setPanel('reply'); return; }
    if (x.send) void asks.answer(a, x.send, x.send.answer === 'option' ? `Sent to ${a.from}: ${x.send.text}` : `${ANSWER_WORD[x.send.answer] ?? 'Sent'} · ${a.from} has it`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && asks.panelRef.current !== 'none') { e.preventDefault(); asks.setPanel('none'); return; }
      if (isTyping(e.target)) return;
      const k = e.key;
      const list = asks.itemsRef.current;
      const a = list.find((i) => i.key === asks.cursorRef.current) ?? null;
      const at = a ? list.indexOf(a) : 0;
      const step = (d: number) => { const n = list[Math.max(0, Math.min(list.length - 1, at + d))]; if (n) { asks.setCursor(n.key); asks.setPanel('none'); asks.setDetail(false); } };
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); return; }
      if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); return; }
      if (k === 'u') { e.preventDefault(); asks.undo(); return; }
      if (k === 'm' && more > 0) { e.preventDefault(); asks.setShowAll(true); return; }
      if (!a) return;
      const actions = actionsFor(a);
      if (asks.panelRef.current === 'defer') {
        const c = asks.deferChoices().find((x) => x.key === k);
        if (c) { e.preventDefault(); void asks.defer(a, c.at, c.label); }
        return;
      }
      if (k === 'z') { e.preventDefault(); asks.setPanel('defer'); return; }
      if (k === 'r') { e.preventDefault(); asks.setPanel('reply'); return; }
      if (k === 'e' && a.detail) { e.preventDefault(); asks.setDetail(!asks.detail); return; }
      if (k === 'Enter') {
        if (e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName)) return;
        const p = actions.find((x) => x.primary);
        if (p) { e.preventDefault(); run(p); } else if (a.kind === 'answer') { e.preventDefault(); asks.setPanel('reply'); }
        return;
      }
      const hit = actions.find((x) => x.key === k);
      if (hit) { e.preventDefault(); run(hit); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const leavingKeys = new Set(items.map((i) => i.key));
  const ghosts = asks.leaving.filter((g) => !leavingKeys.has(g.key));

  return (
    <section class={`asks-view${offline ? ' offline' : ''}`} aria-label="Asks">
      <header class="asks-head">
        <h1 class="h1">Needs you{asks.total > 0 && <span class="count" aria-label={`${asks.total} open`}>{asks.total}</span>}</h1>
        <LiveBadge a={asks} onSignIn={onSignIn} />
        {notify?.supported && (
          <button type="button" class={`notify-btn${notify.on ? ' on' : ''}`} aria-pressed={notify.on} disabled={notify.blocked && !notify.on} aria-label={notify.blocked && !notify.on ? 'Blocked in browser settings' : notify.on ? 'Notifications on' : 'Notify me'} title={notify.blocked ? 'Blocked in browser settings' : notify.on ? 'Notifications are on: tap to turn off' : 'Get a notification when an agent needs you'} onClick={notify.toggle}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0Z" fill={notify.on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
            <span class="notify-label">{notify.blocked && !notify.on ? 'Blocked' : notify.on ? 'On' : 'Notify me'}</span>
          </button>
        )}
      </header>
      <p class="sr-only" role="status" aria-live="polite">{announce}</p>
      {!offline && asks.phase === 'loading' && <Skeleton />}
      {offline && asks.phase !== 'ready' && <div class="asks-error offline" role="status"><p>Offline. Asks load when you're back online.</p></div>}
      {!offline && asks.phase === 'error' && (
        <div class="asks-error" role="alert"><p>Cannot load asks: {asks.error}</p><button type="button" class="btn primary" onClick={asks.retryNow}>Retry</button></div>
      )}
      {asks.phase === 'ready' && items.length === 0 && ghosts.length === 0 && (
        <div class="asks-empty" data-testid="asks-empty">
          <div class="tick-art">{Icon.check}</div>
          <p class="big">Nothing needs you.</p>
          <p class="sub">{asks.latest ? `Last agent update ${freshness(asks.latest, asks.now)}` : 'No agent has written an ask yet'}</p>
        </div>
      )}
      {(items.length > 0 || ghosts.length > 0) && (
        <ol class="asks" aria-label="Asks, highest score first">
          {shown.map((a) => (a.key === cursor ? <Card key={a.key} a={a} n={a.rank ?? 0} total={asks.total} asks={asks} run={run} /> : <Row key={a.key} a={a} n={a.rank ?? 0} now={asks.now} fresh={asks.fresh.has(a.key)} onPick={() => { asks.setCursor(a.key); asks.setPanel('none'); asks.setDetail(false); }} />))}
          {ghosts.map((g) => <Row key={`gone-${g.key}`} a={g} n={g.rank ?? 0} now={asks.now} fresh={false} leaving onPick={() => undefined} />)}
        </ol>
      )}
      {more > 0 && <button type="button" class="more-btn" onClick={() => asks.setShowAll(true)}>Show {more} more <kbd aria-hidden="true">m</kbd></button>}
      {items.length > 0 && <p class="keys-hint" aria-hidden="true">j k move · z defer · r reply · u undo</p>}
      {(asks.sent.length > 0 || asks.snoozed.length > 0) && (
        <footer class="asks-foot">
          {asks.sent.length > 0 && (
            <div>
              <button type="button" class="foot-btn" aria-expanded={openSent} onClick={() => setOpenSent(!openSent)}>Sent · {asks.sent.length}<span class="hint"> waiting on the agent</span></button>
              {openSent && (
                <ul class="foot-list">
                  {asks.sent.map((s) => (
                    <li key={s.key}><span class="f-t">{s.ask}</span><span class="f-what">{ANSWER_WORD[s.answer ?? ''] ?? 'Sent'}{s.text ? `: ${s.text}` : ''} · {s.from}</span><button type="button" class="link" onClick={() => void asks.retract(s)}>Undo</button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {asks.snoozed.length > 0 && (
            <div>
              <button type="button" class="foot-btn" aria-expanded={openSnoozed} onClick={() => setOpenSnoozed(!openSnoozed)}>Snoozed · {asks.snoozed.length}</button>
              {openSnoozed && (
                <ul class="foot-list">
                  {asks.snoozed.map((s) => <li key={s.key}><span class="f-t">{s.ask}</span><span class="f-what">back <DeadlineChip by={s.snoozedUntil} now={asks.now} /></span></li>)}
                </ul>
              )}
            </div>
          )}
        </footer>
      )}
    </section>
  );
}
