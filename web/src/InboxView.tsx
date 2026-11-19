/**
 * The Inbox page: all mail, unread Teams and Slack. Each row has a summary, one suggested action, and a menu of the rest.
 * A reply opens an editable draft first; the page can only create a draft, never send.
 * Mail only: no setup UI. Never says Inbox zero unless every source synced recently; a problem is one quiet line linked to Settings > Accounts.
 * @req FR:inbox-page/web.view @req FR:inbox-page/web.view.unread @req FR:inbox-page/web.view.border @req FR:inbox-page/web.view.button @req FR:inbox-page/web.draft @req FR:inbox-page/web.phone @req FR:inbox-page/web.empty @req FR:inbox-page/web.status @req FR:inbox-page/web.status.setup @req FR:inbox-page/web.nocmd @req FR:inbox-page/web.accounts
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionsFor, emptyText, SOURCE, statusLine, tomorrow, type ActionInfo, type InboxRow, type SourcesReply } from './inbox';
import { EmptyState, type Toast } from './parts';
import './inbox.css';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;

/** One item. Keeps its own markup until `AskCard` ships (product-reset Stage 4). @req FR:inbox-page/web.components */
function Row({ row, catalog, api, toast, done }: { row: InboxRow; catalog: ActionInfo[]; api: Client; toast: ToastFn; done: (id: string) => void }) {
  const { primary, more } = actionsFor(row, catalog);
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
      toast(`${a.label}: done`);
      done(row.id);
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
    <li class={`in-row${row.unread ? ' unread' : ''}`} data-id={row.id} data-source={row.source}>
      <div class="in-top">
        <span class={`in-src ${row.source}`}>{SOURCE[row.source]}</span>
        <span class="in-from">{row.from}</span>
        <span class="in-when">{new Date(row.receivedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      </div>
      <div class="in-subject">{row.unread && <span class="in-dot" role="img" aria-label="Unread" />}{row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer">{row.subject}</a> : row.subject}</div>
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
 * `refresh` changes on the page's minute timer, when the tab comes back, and on live changes: the items and the summary
 * are read again together, so an open tab never keeps an old `Inbox zero`. @req FR:inbox-page/web.empty.refresh
 */
export function InboxView({ api, toast, onStatus, refresh }: { api: Client; toast: ToastFn; onStatus?: (r: SourcesReply) => void; refresh?: string | number }) {
  const [items, setItems] = useState<InboxRow[]>([]);
  const [catalog, setCatalog] = useState<ActionInfo[]>([]);
  const [src, setSrc] = useState<SourcesReply | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const seq = useRef(0);
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
  const unread = items.filter((i) => i.unread).length;
  const empty = emptyText(src?.summary);
  const line = statusLine(src?.summary);
  /** Only a problem the owner can fix in Settings gets a link; a sync that is behind has nothing to fix there. @req FR:inbox-page/web.status.fix @req FR:inbox-page/web.empty.fix */
  const fix = src?.summary.attention ? <a class="in-manage" href="#/settings/accounts">Fix in Settings</a> : null;
  return (
    <section class="inbox-view" aria-labelledby="inbox-h">
      <div class="in-head"><h1 class="h1" id="inbox-h">Inbox{unread > 0 && <span class="count">{unread}</span>}</h1><a class="in-manage in-accounts" href="#/settings/accounts">Manage accounts</a></div>
      {phase === 'loading' && <p class="in-empty" role="status">Loading</p>}
      {phase === 'error' && <p class="in-empty" role="alert">Could not load the inbox.</p>}
      {phase === 'ready' && line && items.length > 0 && <p class="in-status" role="status" data-testid="inbox-status">{line}{fix && <> · {fix}</>}</p>}
      {phase === 'ready' && items.length === 0 && <EmptyState what={empty.what} next={empty.zero ? <a href="#/now">Back to Now</a> : fix ?? undefined} />}
      <ul class="in-list">{items.map((r) => <Row key={r.id} row={r} catalog={catalog} api={api} toast={toast} done={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />)}</ul>
    </section>
  );
}
