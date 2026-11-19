/**
 * Now's priorities report as tabs: QM (when set), Now, PRs, Today, Next 3 days, each with its count of real rows. One card
 * table at a time; each cell is one line, and a tap on the next action shows the full row. The tab is kept in the hash.
 * Read on load, on each live change and every 60 s while visible; absent when the host has no priority store.
 * @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.tabs.count @req FR:priorities-tables/web.tabs.default
 * @req FR:priorities-tables/web.tabs.hash @req FR:priorities-tables/web.tabs.keys @req FR:priorities-tables/web.tabs.head @req FR:priorities-tables/web.table
 * @req FR:priorities-tables/web.table.line @req FR:priorities-tables/web.table.detail @req FR:priorities-tables/web.table.gap @req FR:priorities-tables/web.table.empty
 * @req FR:priorities-tables/web.links @req FR:priorities-tables/web.live @req FR:priorities-tables/web.live.absent
 * @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.keys @req NFR:priorities-tables/a11y.target @req NFR:priorities-tables/a11y.mobile
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionText, defaultTab, hashWithTab, PR_COLS, PRI_COLS, safeHref, sectionsOf, stampText, statusText, tabFromHash, tabLabel, type Agent, type PrioritiesView, type PriRow, type PrRow, type TabKey } from './priorities';
import './priorities.css';

const TICK_MS = 60_000;

/** The view, or null while loading, on error, or when the host has none (404, then never asked again). */
export function usePriorities(api: Pick<Client, 'priorities'>, liveTick: number, active: boolean): PrioritiesView | null {
  const [view, setView] = useState<PrioritiesView | null>(null);
  const absent = useRef(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (absent.current) return;
    const mine = ++seq.current;
    try { const v = await api.priorities(); if (mine === seq.current) setView(v); } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) { absent.current = true; setView(null); }
    }
  }, [api]);
  useEffect(() => { if (active) void load(); }, [liveTick, load, active]);
  useEffect(() => {
    if (!active) return;
    const visible = () => document.visibilityState === 'visible';
    const t = setInterval(() => { if (visible()) void load(); }, TICK_MS);
    const onVis = () => { if (visible()) void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load, active]);
  return view;
}

const Link = ({ href, text }: { href: string; text: string }) => (/^https?:/i.test(href)
  ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>
  : <a href={href}>{text}</a>);
// Explicit roles keep the table semantics when the phone layout turns rows into blocks.
const Cell = ({ c, children, muted, title }: { c: string; children: preact.ComponentChildren; muted?: boolean; title?: string }) => <td role="cell" title={title} class={`pri-c-${c}${muted ? ' pri-muted' : ''}`}>{children}</td>;
const AgentCell = ({ a }: { a: Agent | null }) => (a
  ? <Cell c="agent" title={a.name}>{safeHref(a.link) ? <Link href={a.link} text={a.name} /> : a.name}</Cell>
  : <Cell c="agent" muted>--</Cell>);
/** The next action: one line; a tap shows the full row. @req FR:priorities-tables/web.table.detail */
const More = ({ open, toggle, children }: { open: boolean; toggle: () => void; children: preact.ComponentChildren }) => (
  <button type="button" class="pri-more" aria-expanded={open} onClick={toggle}>{children}</button>
);

function PriLine({ r }: { r: PriRow }) {
  const [open, setOpen] = useState(false);
  return (
    <tr role="row" class={`${r.gap ? 'pri-gap' : ''}${open ? ' pri-open' : ''}`.trim() || undefined}>
      <Cell c="project" title={r.project}>{r.project}{r.stale && <span class="pri-stale"> stale</span>}</Cell>
      <AgentCell a={r.agent} />
      <Cell c="status" muted={!r.status}>{statusText(r.status)}</Cell>
      <Cell c="action" muted={r.gap}><More open={open} toggle={() => setOpen(!open)}>{actionText(r)}</More></Cell>
    </tr>
  );
}
function PrLine({ r }: { r: PrRow }) {
  const [open, setOpen] = useState(false);
  const live = r.server || r.details;
  return (
    <tr role="row" class={open ? 'pri-open' : undefined}>
      <Cell c="pr">{r.emoji && <span aria-hidden="true">{r.emoji} </span>}{safeHref(r.url) ? <Link href={r.url} text={String(r.number)} /> : r.number}</Cell>
      <AgentCell a={r.agent} />
      <Cell c="action">{live
        // Live rows: the server and what to validate. @req FR:priorities-tables/pr.cols.live
        ? <>Live: {[r.server && safeHref(r.server) ? <Link key="s" href={r.server} text="server" /> : null, r.details && safeHref(r.details) ? <Link key="d" href={r.details} text="details" /> : null].filter(Boolean).flatMap((x, i) => (i ? [', ', x] : [x]))}</>
        : <More open={open} toggle={() => setOpen(!open)}>{r.action}</More>}</Cell>
      <Cell c="time">{r.minutes}m</Cell>
    </tr>
  );
}
const Only = ({ n, text }: { n: number; text: string }) => <tr role="row" class="pri-only"><td role="cell" colSpan={n} class="pri-muted">{text}</td></tr>;

export function PrioritiesTables({ v }: { v: PrioritiesView }) {
  const sections = sectionsOf(v);
  const keys = sections.map((s) => s.key);
  const [tab, setTab] = useState<TabKey>(() => { const h = typeof location === 'undefined' ? undefined : tabFromHash(location.hash); return h && keys.includes(h) ? h : defaultTab(v); });
  const cur = keys.includes(tab) ? tab : defaultTab(v);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  /** @req FR:priorities-tables/web.tabs.hash */
  const pick = (k: TabKey, focus = false) => {
    setTab(k);
    const h = hashWithTab(location.hash, k);
    if (location.hash !== h) history.replaceState(null, '', h);
    if (focus) tabs.current[k]?.focus();
  };
  /** Arrow keys, Home and End. @req FR:priorities-tables/web.tabs.keys */
  const onKey = (e: KeyboardEvent) => {
    const i = keys.indexOf(cur);
    const to = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : undefined;
    if (to) { e.preventDefault(); pick(to, true); }
  };
  const s = sections.find((x) => x.key === cur)!;
  const cols = s.key === 'prs' ? PR_COLS : PRI_COLS;
  return (
    <section class="pri-tables fl" aria-label="Priorities" data-testid="pri-tables">
      <div class="pri-tabs" role="tablist" aria-label="Priorities" onKeyDown={onKey}>
        {sections.map((x) => (
          <button key={x.key} type="button" role="tab" id={`pri-tab-${x.key}`} aria-controls="pri-tabpanel" aria-selected={x.key === cur} tabIndex={x.key === cur ? 0 : -1}
            class="pri-tab" ref={(el) => { tabs.current[x.key] = el; }} onClick={() => pick(x.key)} data-testid={`pri-tab-${x.key}`}>{tabLabel(x)}</button>
        ))}
      </div>
      <div class="pri-tabpanel" id="pri-tabpanel" role="tabpanel" aria-labelledby={`pri-tab-${cur}`} data-testid={`pri-${cur}`}>
        <p class={`pri-stamp${s.t.stale ? ' stale' : ''}`}>{stampText(s.t, v.timeZone)}</p>
        {s.key === 'prs' && s.t.manager && safeHref(s.t.manager.link) && <p class="pri-manager"><span aria-hidden="true">👩‍💻 </span><Link href={s.t.manager.link} text={s.t.manager.name} /></p>}
        <table class={`pri-table ${s.key === 'prs' ? 'pri-prs' : 'pri-pri'}`} role="table" aria-labelledby={`pri-tab-${cur}`}>
          <thead role="rowgroup"><tr role="row">{cols.map((c) => <th role="columnheader" scope="col" key={c}>{c}</th>)}</tr></thead>
          <tbody role="rowgroup">
            {s.key === 'prs'
              ? (!s.t.verified ? <Only n={cols.length} text="Not verified live" /> : !s.t.rows.length ? <Only n={cols.length} text="Nothing here" /> : s.t.rows.map((r) => <PrLine key={r.url} r={r} />))
              : (!s.t.rows.length ? <Only n={cols.length} text="Nothing here" /> : s.t.rows.map((r) => <PriLine key={`${r.id}:${r.ref ?? r.project}`} r={r} />))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
