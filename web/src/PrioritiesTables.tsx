/**
 * Now's priorities report as tabs: QM (when set), Now, PRs, Today, Next 3 days, each with its count of real rows. One card
 * list of muted cards at a time; each field is one line, and the toggle shows the full card. The tab is kept in the hash.
 * Read on load, on each live change and every 60 s while visible; absent when the host has no priority store.
 * @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.tabs.count @req FR:priorities-tables/web.tabs.default
 * @req FR:priorities-tables/web.tabs.hash @req FR:priorities-tables/web.tabs.keys @req FR:priorities-tables/web.tabs.head @req FR:priorities-tables/web.table
 * @req FR:priorities-tables/web.table.line @req FR:priorities-tables/web.table.detail @req FR:priorities-tables/web.table.gap @req FR:priorities-tables/web.table.empty
 * @req FR:priorities-tables/web.links @req FR:priorities-tables/web.live @req FR:priorities-tables/web.live.absent
 * @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.keys @req NFR:priorities-tables/a11y.target @req NFR:priorities-tables/a11y.mobile
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionText, agentHref, defaultTab, hashWithTab, linkParts, NO_LINK, projectHref, safeHref, sectionsOf, stampText, statusText, tabFromHash, tabLabel, type Agent, type PrioritiesView, type PriRow, type PrRow, type TabKey } from './priorities';
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
/** One field of a card; `label` is read by screen readers only. */
const Cell = ({ c, children, muted, title, label }: { c: string; children: preact.ComponentChildren; muted?: boolean; title?: string; label?: string }) => <span title={title} class={`pri-c-${c}${muted ? ' pri-muted' : ''}`}>{label && <span class="pri-sr">{label}: </span>}{children}</span>;
/** A link, else the text and the gap marker. @req FR:priorities-tables/web.links.gap */
const LinkOr = ({ href, text }: { href: string | null; text: string }) => (safeHref(href) ? <Link href={href} text={text} /> : <>{text} <span class="pri-nolink">{NO_LINK}</span></>);
/** Action text with every PR, issue and URL as a link. @req FR:priorities-tables/web.links.refs */
const Rich = ({ text }: { text: string }) => <>{linkParts(text).map((p, i) => (p.href && safeHref(p.href) ? <Link key={i} href={p.href} text={p.text} /> : p.gap ? <span key={i} class="pri-nolink">{p.text}</span> : p.text))}</>;
/** @req FR:priorities-tables/web.links.agent */
const AgentCell = ({ a }: { a: Agent | null }) => (a
  ? <Cell c="agent" title={a.name} label="Agent"><LinkOr href={agentHref(a)} text={a.name} /></Cell>
  : <Cell c="agent" muted label="Agent">--</Cell>);
/** The next action: one line, then a toggle that shows the full row. Links stay outside the toggle. @req FR:priorities-tables/web.table.detail */
const More = ({ open, toggle, children }: { open: boolean; toggle: () => void; children: preact.ComponentChildren }) => (
  <div class="pri-act"><span class="pri-text">{children}</span><button type="button" class="pri-more" aria-expanded={open} aria-label={open ? 'Show less' : 'Show the full row'} title={open ? 'Show less' : 'Show the full row'} onClick={toggle}><span aria-hidden="true">{open ? '▴' : '▾'}</span></button></div>
);

function PriLine({ r }: { r: PriRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li class={`pri-card${r.gap ? ' pri-gap' : ''}${open ? ' pri-open' : ''}`}>
      <Cell c="project" title={r.project}><LinkOr href={projectHref(r.file)} text={r.project} />{r.stale && <span class="pri-stale"> stale</span>}</Cell>
      <AgentCell a={r.agent} />
      <Cell c="status" muted={!r.status} label="Status">{statusText(r.status)}</Cell>
      <Cell c="action" muted={r.gap} label="Next action"><More open={open} toggle={() => setOpen(!open)}>{r.gap ? actionText(r) : <Rich text={r.action} />}</More></Cell>
    </li>
  );
}
function PrLine({ r }: { r: PrRow }) {
  const [open, setOpen] = useState(false);
  const live = r.server || r.details;
  return (
    <li class={`pri-card${open ? ' pri-open' : ''}`}>
      <Cell c="pr" label="PR">{r.emoji && <span aria-hidden="true">{r.emoji} </span>}{safeHref(r.url) ? <Link href={r.url} text={String(r.number)} /> : r.number}</Cell>
      <AgentCell a={r.agent} />
      <Cell c="action" label="Next action">{live
        // Live rows: the server and what to validate. @req FR:priorities-tables/pr.cols.live
        ? <>Live: {[r.server && safeHref(r.server) ? <Link key="s" href={r.server} text="server" /> : null, r.details && safeHref(r.details) ? <Link key="d" href={r.details} text="details" /> : null].filter(Boolean).flatMap((x, i) => (i ? [', ', x] : [x]))}</>
        : <More open={open} toggle={() => setOpen(!open)}>{r.action}</More>}</Cell>
      <Cell c="time" label="Time">{r.minutes}m</Cell>
    </li>
  );
}
const Only = ({ text }: { text: string }) => <li class="pri-card pri-only pri-muted">{text}</li>;

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
        <ul class={`pri-cards ${s.key === 'prs' ? 'pri-prs' : 'pri-pri'}`} aria-labelledby={`pri-tab-${cur}`}>
          {s.key === 'prs'
            ? (!s.t.verified ? <Only text="Not verified live" /> : !s.t.rows.length ? <Only text="Nothing here" /> : s.t.rows.map((r) => <PrLine key={r.url} r={r} />))
            : (!s.t.rows.length ? <Only text="Nothing here" /> : s.t.rows.map((r) => <PriLine key={`${r.id}:${r.ref ?? r.project}`} r={r} />))}
        </ul>
      </div>
    </section>
  );
}
