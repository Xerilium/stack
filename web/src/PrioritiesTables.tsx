/**
 * Now's priorities report: QM (when set), Now, PRs, Today, Next 3 days. Each section is a rule, an h2 with its stamp, and
 * one plain table. Below 600 px each row is a block. Read on load, on each live change and every 60 s while visible;
 * absent when the host has no priority store.
 * @req FR:priorities-tables/web.place @req FR:priorities-tables/web.sections @req FR:priorities-tables/web.sections.cols @req FR:priorities-tables/web.sections.head
 * @req FR:priorities-tables/web.sections.gap @req FR:priorities-tables/web.sections.empty @req FR:priorities-tables/web.links @req FR:priorities-tables/web.live @req FR:priorities-tables/web.live.absent
 * @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.keys @req NFR:priorities-tables/a11y.mobile
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { actionText, PR_COLS, PRI_COLS, safeHref, sectionsOf, stampText, statusText, type Agent, type PrioritiesView, type PriRow, type PrRow } from './priorities';
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

const PriLine = ({ r }: { r: PriRow }) => (
  <tr role="row" class={r.gap ? 'pri-gap' : undefined}>
    <Cell c="project">{r.project}{r.stale && <span class="pri-stale"> stale</span>}</Cell>
    <AgentCell a={r.agent} />
    <Cell c="status" muted={!r.status}>{statusText(r.status)}</Cell>
    <Cell c="action" muted={r.gap}>{actionText(r)}</Cell>
  </tr>
);
const PrLine = ({ r }: { r: PrRow }) => (
  <tr role="row">
    <Cell c="pr">{r.emoji && <span aria-hidden="true">{r.emoji} </span>}{safeHref(r.url) ? <Link href={r.url} text={String(r.number)} /> : r.number}</Cell>
    <AgentCell a={r.agent} />
    <Cell c="action">{r.server || r.details
      // Live rows: the server and what to validate. @req FR:priorities-tables/pr.cols.live
      ? <>Live: {[r.server && safeHref(r.server) ? <Link key="s" href={r.server} text="server" /> : null, r.details && safeHref(r.details) ? <Link key="d" href={r.details} text="details" /> : null].filter(Boolean).flatMap((x, i) => (i ? [', ', x] : [x]))}</>
      : r.action}</Cell>
    <Cell c="time">{r.minutes}m</Cell>
  </tr>
);
const Only = ({ n, text }: { n: number; text: string }) => <tr role="row" class="pri-only"><td role="cell" colSpan={n} class="pri-muted">{text}</td></tr>;

export function PrioritiesTables({ v }: { v: PrioritiesView }) {
  return (
    <section class="pri-tables fl" aria-label="Priorities" data-testid="pri-tables">
      {sectionsOf(v).map((s) => {
        const id = `pri-h-${s.key}`;
        const cols = s.key === 'prs' ? PR_COLS : PRI_COLS;
        return (
          <div class={`pri-section pri-${s.key === 'prs' ? 'prs' : 'pri'}`} data-testid={`pri-${s.key}`} key={s.key}>
            <hr class="pri-rule" />
            <h2 class="pri-h2" id={id}>{s.title} <span class={`pri-stamp${s.t.stale ? ' stale' : ''}`}>{stampText(s.t)}</span></h2>
            {s.key === 'prs' && s.t.manager && safeHref(s.t.manager.link) && <p class="pri-manager"><span aria-hidden="true">👩‍💻 </span><Link href={s.t.manager.link} text={s.t.manager.name} /></p>}
            <table class="pri-table" role="table" aria-labelledby={id}>
              <thead role="rowgroup"><tr role="row">{cols.map((c) => <th role="columnheader" scope="col" key={c}>{c}</th>)}</tr></thead>
              <tbody role="rowgroup">
                {s.key === 'prs'
                  ? (!s.t.verified ? <Only n={cols.length} text="Not verified live" /> : !s.t.rows.length ? <Only n={cols.length} text="Nothing here" /> : s.t.rows.map((r) => <PrLine key={r.url} r={r} />))
                  : (!s.t.rows.length ? <Only n={cols.length} text="Nothing here" /> : s.t.rows.map((r) => <PriLine key={`${r.id}:${r.ref ?? r.project}`} r={r} />))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
