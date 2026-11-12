/**
 * The Inbox page: all mail, unread Teams and Slack. Each row has a summary, one suggested action, and a menu of the rest.
 * A reply opens an editable draft first; the page can only create a draft, never send.
 * Never says Inbox zero unless a source synced recently; the sources panel shows what is connected and how to connect the rest.
 * @req FR:inbox-page/web.view @req FR:inbox-page/web.draft @req FR:inbox-page/web.phone @req FR:inbox-page/web.empty @req FR:inbox-page/web.check
 */
import { useEffect, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionsFor, emptyText, SOURCE, tomorrow, type ActionInfo, type InboxRow, type SourcesReply } from './inbox';
import { InboxSources } from './InboxSources';
import { EmptyState, type Toast } from './parts';
import './inbox.css';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;

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
      <div class="in-subject">{row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer">{row.subject}</a> : row.subject}</div>
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
        {primary && <button type="button" class="btn primary" disabled={busy} onClick={() => void run(primary)}>{primary.ready ? primary.label : `Request: ${primary.label}`}</button>}
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

export function InboxView({ api, toast, onStatus }: { api: Client; toast: ToastFn; onStatus?: (r: SourcesReply) => void }) {
  const [items, setItems] = useState<InboxRow[]>([]);
  const [catalog, setCatalog] = useState<ActionInfo[]>([]);
  const [src, setSrc] = useState<SourcesReply | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let live = true;
    api.inboxItems().then((r) => {
      if (!live) return;
      setItems(r.items); setCatalog(r.actions); setPhase('ready');
      if (r.sources && r.summary) { const s = { sources: r.sources, summary: r.summary }; setSrc(s); onStatus?.(s); }
    }).catch(() => { if (live) setPhase('error'); });
    return () => { live = false; };
  }, [api]);
  /** Re-reads every source, asking a local host to probe again. @req FR:inbox-page/web.check */
  async function check() {
    setChecking(true);
    try { const r = await api.inboxSources(true); setSrc(r); onStatus?.(r); } catch (e) { toast(e instanceof ApiFailure ? e.message : 'Could not check the connection', 'err'); }
    setChecking(false);
  }
  const unread = items.filter((i) => i.unread).length;
  const empty = emptyText(src?.summary);
  return (
    <section class="inbox-view" aria-labelledby="inbox-h">
      <div class="in-head"><h1 class="h1" id="inbox-h">Inbox{unread > 0 && <span class="count">{unread}</span>}</h1></div>
      {phase === 'loading' && <p class="in-empty" role="status">Loading</p>}
      {phase === 'error' && <p class="in-empty" role="alert">Could not load the inbox.</p>}
      {phase === 'ready' && src?.summary.headline && items.length > 0 && <p class="in-banner" role="status" data-testid="inbox-headline">{src.summary.headline}</p>}
      {phase === 'ready' && items.length === 0 && (empty.zero
        ? <EmptyState what={empty.what} next={src?.summary.headline ? <>{src.summary.headline}. See Inbox sources below.</> : <a href="#/now">Back to Now</a>} />
        : <EmptyState what={empty.what} next="Connect an inbox below. Stack never sends." />)}
      {phase === 'ready' && src && <InboxSources sources={src.sources} summary={src.summary} checking={checking} onCheck={() => void check()} />}
      <ul class="in-list">{items.map((r) => <Row key={r.id} row={r} catalog={catalog} api={api} toast={toast} done={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />)}</ul>
    </section>
  );
}
