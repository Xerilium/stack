/**
 * The Inbox page: all mail, unread Teams and Slack. Each row has a summary, one suggested action, and a menu of the rest.
 * A reply opens an editable draft first; the page can only create a draft, never send.
 * Mail only: no setup UI. Never says Inbox zero unless every source synced recently; a problem is one quiet line linked to Settings > Accounts.
 * Selecting a row opens its detail: the full message and its thread, read live and shown as plain text.
 * @req FR:inbox-page/detail.web @req FR:inbox-page/detail.split @req FR:inbox-page/detail.split.phone @req FR:inbox-page/detail.head @req FR:inbox-page/detail.body @req FR:inbox-page/detail.thread @req FR:inbox-page/detail.thread.fold @req FR:inbox-page/detail.offline @req FR:inbox-page/detail.safe
 * Junk (spam, cold outreach, newsletters) sits in one closed section; the owner restores a row or clears the section. Nothing is deleted.
 * @req FR:inbox-page/junk.web @req FR:inbox-page/junk.group @req FR:inbox-page/junk.group.fold @req FR:inbox-page/junk.group.count @req FR:inbox-page/junk.group.reason @req FR:inbox-page/junk.restore.web
 * @req FR:inbox-page/web.view @req FR:inbox-page/web.view.unread @req FR:inbox-page/web.view.border @req FR:inbox-page/web.view.button @req FR:inbox-page/web.draft @req FR:inbox-page/web.phone @req FR:inbox-page/web.empty @req FR:inbox-page/web.status @req FR:inbox-page/web.nocmd @req FR:inbox-page/web.accounts @req FR:inbox-page/web.toast
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionsFor, doneText, emptyText, junkActions, junkReason, junkToast, openLabel, person, SOURCE, splitJunk, statusLine, tomorrow, when, type ActionInfo, type DetailReply, type InboxRow, type SourcesReply } from './inbox';
import { EmptyState, type Toast } from './parts';
import { ActionBar } from './ui/ActionMenu';
import { Fold } from './ui/Fold';
import { SplitView } from './ui/SplitView';
import { ThreadMessage } from './ui/ThreadMessage';
import { useWide } from './ui/useWide';
import './inbox.css';

/** List and detail sit side by side from this width. @req FR:inbox-page/detail.split */
const WIDE = '(min-width: 900px)';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;

/** One item. Keeps its own markup until `AskCard` ships (product-reset Stage 4; issue 169). */
function Row({ row, catalog, api, toast, done, selected, onOpen, junk = false }: { row: InboxRow; catalog: ActionInfo[]; api: Client; toast: ToastFn; done: (id: string, action: string) => void; selected: boolean; onOpen: () => void; /** A junk row: Not junk leads and the reason shows. */ junk?: boolean }) {
  const { primary, more } = junk ? junkActions(row, catalog) : actionsFor(row, catalog);
  const [drafting, setDrafting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [menu, setMenu] = useState(false);

  async function run(a: ActionInfo) {
    setMenu(false);
    if (!a.ready) {
      setBusy(true);
      try {
        const r = await api.inboxAct(row.id, { action: a.id, request: true });
        toast('via' in r && r.via === 'issue' ? 'Requested: issue filed' : 'Requested: added as a Stack task');
      } catch (e) { toast(e instanceof ApiFailure ? e.message : 'Could not file the request', 'err'); }
      setBusy(false);
      return;
    }
    if (a.id === 'reply-draft') { setDrafting(true); return; }
    setBusy(true);
    try {
      await api.inboxAct(row.id, { action: a.id, ...(a.id === 'snooze' ? { until: tomorrow() } : {}) });
      toast(a.id === 'not-junk' ? 'Moved out of Junk' : doneText(a));
      done(row.id, a.id);
    } catch (e) { toast(e instanceof ApiFailure ? e.message : `${a.label} failed`, 'err'); }
    setBusy(false);
  }

  async function makeDraft() {
    setBusy(true);
    try {
      const r = await api.inboxAct(row.id, { action: 'reply-draft', text });
      if ('link' in r && r.link) setLink(r.link);
      toast('Draft created. Nothing was sent.');
      setDrafting(false);
    } catch (e) { toast(e instanceof ApiFailure ? e.message : 'Could not create the draft', 'err'); }
    setBusy(false);
  }

  return (
    <li class={`in-row${row.unread ? ' unread' : ''}`} data-id={row.id} data-source={row.source} data-selected={selected ? 'true' : undefined}>
      <div class="in-top">
        <span class={`in-src ${row.source}`}>{SOURCE[row.source]}</span>
        <span class="in-from">{row.from}</span>
        {junk && <span class="in-why">{junkReason(row)}</span>}
        <span class="in-when">{new Date(row.receivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      </div>
      <div class="in-subject">{row.unread && <span class="in-dot" role="img" aria-label="Unread" />}<button type="button" class="in-open-btn" aria-current={selected ? 'true' : undefined} onClick={onOpen}>{row.subject}</button></div>
      <p class="in-sum">{row.summary}</p>
      {drafting && (
        <div class="in-draft">
          <label class="sr-only" for={`d-${row.id}`}>Draft reply</label>
          <textarea id={`d-${row.id}`} rows={5} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Write the reply. It becomes a draft in Outlook. You send it there." />
          <div class="in-draft-actions">
            <button type="button" class="btn primary" disabled={busy || !text.trim()} onClick={() => void makeDraft()}>Create draft</button>
            <button type="button" class="btn" onClick={() => setDrafting(false)}>Cancel</button>
          </div>
        </div>
      )}
      {link && <p class="in-open"><a href={link} target="_blank" rel="noopener noreferrer">Open draft in Outlook</a> · review and send it there</p>}
      <div class="in-actions">
        {primary && <button type="button" class="btn" disabled={busy} onClick={() => void run(primary)}>{primary.ready ? primary.label : `Request: ${primary.label}`}</button>}
        <div class="in-more">
          <button type="button" class="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>More</button>
          {menu && (
            <ul class="in-menu" role="menu">
              {more.filter((a) => a.ready).map((a) => <li key={a.id} role="none"><button type="button" role="menuitem" disabled={busy} onClick={() => void run(a)}>{a.label}</button></li>)}
              {more.some((a) => !a.ready) && <li role="presentation" class="in-menu-h">Request this action</li>}
              {more.filter((a) => !a.ready).map((a) => <li key={a.id} role="none"><button type="button" role="menuitem" class="req" disabled={busy} onClick={() => void run(a)}>{a.label}</button></li>)}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The detail of one item. The text comes from the mailbox on each open and is never stored; `ThreadMessage` renders it as plain text.
 * @req FR:inbox-page/detail.head @req FR:inbox-page/detail.body @req FR:inbox-page/detail.thread @req FR:inbox-page/detail.offline @req FR:inbox-page/detail.safe
 */
function Detail({ row, api }: { row: InboxRow; api: Client }) {
  const [d, setD] = useState<DetailReply | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let on = true;
    setD(null); setFailed(false);
    api.inboxDetail(row.id).then((r) => { if (on) setD(r); }).catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [api, row.id]);
  const m = d?.live ? d.message : undefined;
  const thread = (d?.live && d.thread) || [];
  return (
    <div class="in-detail" data-id={row.id}>
      <h3 class="in-d-h" tabIndex={-1}>{row.subject}</h3>
      <p class="in-d-meta"><span class="in-src">{SOURCE[row.source]}</span><span>{row.account}</span></p>
      {!d && !failed && <p class="in-d-note" role="status">Loading the message</p>}
      {m && <ThreadMessage from={person(m.from, m.mine)} when={when(m.receivedAt)} meta={m.to.length ? `To: ${m.to.map((p) => person(p)).join(', ')}` : undefined} body={m.body} />}
      {(failed || (d && !m)) && (
        <>
          <p class="in-d-from">{row.from} · {when(row.receivedAt)}</p>
          <p class="in-sum">{row.summary}</p>
          <p class="in-d-note">Stack cannot read this message here. This is the summary.</p>
        </>
      )}
      {thread.length > 0 && (
        <section class="in-thread" aria-labelledby={`th-${row.id}`}>
          <h4 class="in-thread-h" id={`th-${row.id}`}>Other messages in this thread ({thread.length})</h4>
          {thread.map((t) => <ThreadMessage key={t.id} fold from={person(t.from, t.mine)} when={when(t.receivedAt)} body={t.body} />)}
        </section>
      )}
      {row.link && <ActionBar heading="Actions" items={[{ id: 'open', label: openLabel(row.source), href: row.link }]} />}
    </div>
  );
}

/**
 * `refresh` changes on the page's minute timer, when the tab comes back, and on live changes: the items and the summary
 * are read again together, so an open tab never keeps an old `Inbox zero`. @req FR:inbox-page/web.empty.refresh
 */
export function InboxView({ api, toast, onStatus, refresh }: { api: Client; toast: ToastFn; onStatus?: (r: SourcesReply) => void; refresh?: string | number }) {
  const [items, setItems] = useState<InboxRow[]>([]);
  const [catalog, setCatalog] = useState<ActionInfo[]>([]);
  const [src, setSrc] = useState<SourcesReply | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const seq = useRef(0);
  const [sel, setSel] = useState<string | null>(null);
  const wide = useWide(WIDE);
  const open = items.find((i) => i.id === sel);
  /** Items, catalog and summary from one reply; an older reply that lands late is dropped. A reply without a summary clears it, so zero is never claimed off old data. */
  const load = async (): Promise<boolean> => {
    const n = ++seq.current;
    const r = await api.inboxItems();
    if (n !== seq.current) return true;
    setItems(r.items); setCatalog(r.actions); setPhase('ready');
    if (r.sources && r.summary) { const s = { sources: r.sources, summary: r.summary }; setSrc(s); onStatus?.(s); } else setSrc(null);
    return true;
  };
  /** A read that failed cannot back a zero claim: keep the line, drop the claim. */
  const unverified = () => setSrc((s) => (s ? { ...s, summary: { ...s.summary, canClaimZero: false } } : s));
  useEffect(() => {
    void load().catch(() => { setPhase((p) => (p === 'ready' ? p : 'error')); unverified(); });
    return () => { seq.current++; };
  }, [api, refresh]);
  const { main, junk } = splitJunk(items);
  const [clearing, setClearing] = useState(false);
  /** One click clears the junk: the server moves it to Archive (never deletes) and answers the counts. @req FR:inbox-page/junk.archive @req FR:inbox-page/junk.unsubscribe */
  const clear = async (action: 'archive' | 'unsubscribe-archive') => {
    setClearing(true);
    try { toast(junkToast(await api.inboxJunk(action))); await load(); } catch (e) { toast(e instanceof ApiFailure ? e.message : 'Could not clear Junk. Try again.', 'err'); }
    setClearing(false);
  };
  /** Not junk keeps the row and moves it to the list; every other action removes the row. */
  const done = (id: string, action: string) => setItems((xs) => (action === 'not-junk' ? xs.map((x) => (x.id === id ? { ...x, notJunk: true } : x)) : xs.filter((x) => x.id !== id)));
  const row = (r: InboxRow, isJunkRow: boolean) => <Row key={r.id} row={r} catalog={catalog} api={api} toast={toast} junk={isJunkRow} selected={r.id === sel} onOpen={() => setSel(r.id)} done={done} />;
  const unread = main.filter((i) => i.unread).length;
  const empty = emptyText(src?.summary);
  const line = statusLine(src?.summary);
  /** Only a sign-in the owner can fix in Settings gets a link; a sync that is behind, or a failed model or sync, has nothing to fix there. @req FR:inbox-page/web.status.fix @req FR:inbox-page/web.empty.fix */
  const fix = src?.summary.attention && src.sources.some((x) => x.connect) ? <a class="in-manage" href="#/settings/accounts">Fix in Settings</a> : null;
  return (
    <section class={`inbox-view${wide && items.length > 0 ? ' split' : ''}`} aria-labelledby="inbox-h">
      <div class="in-head"><h1 class="h1" id="inbox-h">Inbox{unread > 0 && <span class="count">{unread}</span>}</h1><a class="in-manage in-accounts" href="#/settings/accounts">Manage accounts</a></div>
      {phase === 'loading' && <p class="in-empty" role="status">Loading</p>}
      {phase === 'error' && <p class="in-empty" role="alert">Could not load the inbox.</p>}
      {phase === 'ready' && line && items.length > 0 && <p class="in-status" role="status" data-testid="inbox-status">{line}{fix && <> · {fix}</>}</p>}
      {phase === 'ready' && items.length === 0 && <EmptyState what={empty.what} next={empty.zero ? <a href="#/now">Back to Now</a> : fix ?? undefined} />}
      {items.length > 0 && (
        <SplitView
          reader wide={wide} open={!!open} label="Message" empty="Select a message to read it." onBack={() => setSel(null)}
          list={(
            <>
              {main.length === 0 && <p class="in-status" role="status">No mail needs you.</p>}
              <ul class="in-list">{main.map((r) => row(r, false))}</ul>
              {junk.length > 0 && (
                <Fold id="inbox-junk" title="Junk" count={junk.length} aside={(
                  <>
                    <button type="button" class="btn" disabled={clearing} onClick={() => void clear('archive')}>Archive all</button>
                    <button type="button" class="btn" disabled={clearing} onClick={() => void clear('unsubscribe-archive')}>Unsubscribe and archive all</button>
                  </>
                )}>
                  <p class="in-junk-note">Spam, cold outreach and newsletters. Stack never deletes mail.</p>
                  <ul class="in-list">{junk.map((r) => row(r, true))}</ul>
                </Fold>
              )}
            </>
          )}
          detail={open ? <Detail key={open.id} row={open} api={api} /> : null}
        />
      )}
    </section>
  );
}
