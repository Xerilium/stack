/**
 * Now's priorities: four plain sections (Now, Promote to Autopilot, Today, Next 3 days), each an h2 with its stamp and a
 * table, a rule between sections. Read on load, on each live change and every 60 s while visible; absent when the host has
 * no priority store.
 * @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tables @req FR:priorities-tables/web.tables.cols @req FR:priorities-tables/web.tables.head
 * @req FR:priorities-tables/web.tables.row @req FR:priorities-tables/web.tables.empty @req FR:priorities-tables/web.links @req FR:priorities-tables/web.live @req FR:priorities-tables/web.live.absent
 * @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.keys @req NFR:priorities-tables/a11y.mobile
 */
import { Fragment } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { safeHref, stampText, TABLES, type PrioritiesView, type PriRow, type PrRow } from './priorities';
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
const Project = ({ name, stale }: { name: string; stale: boolean }) => <td class="pri-project">{name}{stale && <span class="pri-stale"> stale</span>}</td>;

const PriLine = ({ r }: { r: PriRow }) => (
  <tr>
    <Project name={r.project} stale={r.stale} />
    <td>{r.agent && safeHref(r.agent.link) ? <Link href={r.agent.link} text={r.agent.name} /> : '--'}</td>
    <td>{r.action}</td>
  </tr>
);
const PrLine = ({ r }: { r: PrRow }) => (
  <tr>
    <Project name={r.project} stale={r.stale} />
    <td>{safeHref(r.url) ? <Link href={r.url} text={String(r.number)} /> : r.number}</td>
    <td>{r.title}</td>
  </tr>
);

export function PrioritiesTables({ v }: { v: PrioritiesView }) {
  return (
    <section class="pri-tables fl" aria-label="Priorities" data-testid="pri-tables">
      {TABLES.map(({ key, title, cols }, i) => {
        const t = v[key];
        const id = `pri-h-${key}`;
        return (
          <Fragment key={key}>
            {i > 0 && <hr class="pri-rule" />}
            <div class="pri-section" data-testid={`pri-${key}`}>
              <h2 class="pri-h2" id={id}>{title} <span class={`pri-stamp${t.stale ? ' stale' : ''}`}>{stampText(t)}</span></h2>
              <div class="pri-scroll" role="region" aria-labelledby={id} tabIndex={0}>
                <table class="pri-table" aria-labelledby={id}>
                  <thead><tr>{cols.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
                  <tbody>{!t.rows.length ? <tr><td colSpan={cols.length} class="pri-none">Nothing here</td></tr>
                    : key === 'autopilot' ? v.autopilot.rows.map((r) => <PrLine key={r.url} r={r} />)
                    : v[key].rows.map((r) => <PriLine key={r.id} r={r} />)}</tbody>
                </table>
              </div>
            </div>
          </Fragment>
        );
      })}
    </section>
  );
}
