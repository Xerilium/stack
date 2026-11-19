/**
 * Now's priorities report: tabs (QM, Now, PRs, Today, Next 3 days, each with its count of real rows) over a list of muted
 * cards and a detail pane, built from the shared components (`web/src/ui/`). The whole card opens its detail; the project and agent links live in
 * the detail only. The stamp sits at the right end of the tab bar. The tab is kept in the hash.
 * @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.tabs.count @req FR:priorities-tables/web.tabs.default
 * @req FR:priorities-tables/web.card.project @req FR:priorities-tables/web.tabs.hash @req FR:priorities-tables/web.tabs.head @req FR:priorities-tables/web.table @req FR:priorities-tables/web.table.line
 * @req FR:priorities-tables/web.table.gap @req FR:priorities-tables/web.table.empty @req FR:priorities-tables/web.links @req FR:priorities-tables/web.live @req FR:priorities-tables/web.live.absent
 * @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.keys @req NFR:priorities-tables/a11y.target @req NFR:priorities-tables/a11y.mobile
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { MessageBox } from './ui/MessageBox';
import { SelectCard } from './ui/SelectCard';
import { SplitView } from './ui/SplitView';
import { StatusChip, type ChipTone } from './ui/StatusChip';
import { Tabs } from './ui/Tabs';
import { useWide } from './ui/useWide';
import { agentHref, defaultTab, hashWithTab, linkParts, NO_LINK, projectHref, safeHref, sectionsOf, stampText, STATUS, tabFromHash, tabLabel, type Agent, type PrioritiesView, type PriRow, type PrRow, type TabKey } from './priorities';
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
/** A link, else the text and the gap marker. @req FR:priorities-tables/web.links.gap */
const LinkOr = ({ href, text }: { href: string | null; text: string }) => (safeHref(href) ? <Link href={href} text={text} /> : <>{text} <span class="pri-nolink">{NO_LINK}</span></>);
/** Text with every PR, issue and URL as a link. @req FR:priorities-tables/web.links.refs */
const Rich = ({ text }: { text: string }) => <>{linkParts(text).map((p, i) => (p.href && safeHref(p.href) ? <Link key={i} href={p.href} text={p.text} /> : p.gap ? <span key={i} class="pri-nolink">{p.text}</span> : p.text))}</>;
const TONE: Record<NonNullable<PriRow['status']>, ChipTone> = { working: 'info', pairing: 'info', done: 'ok', idle: 'neutral', blocked: 'bad', queued: 'neutral', unknown: 'neutral' };
/** The status chip (`FR:ui-kit/chip`); none with no agent. @req FR:priorities-tables/web.status.chip */
const Status = ({ s }: { s: PriRow['status'] }) => (s ? <StatusChip label={STATUS[s].word} tone={TONE[s]} /> : null);
/** The agent name, plain (agents carry their own emoji); no link on the card. @req FR:priorities-tables/web.card.agent */
const AgentName = ({ a, more }: { a: Agent | null; more: number }) => (a ? <span class="pri-agent">{a.name}{more ? ` + ${more} more` : ''}</span> : null);
/** Live rows: the server and what to validate. @req FR:priorities-tables/pr.cols.live */
const LiveLinks = ({ r }: { r: PrRow }) => <>Live: {[r.server && safeHref(r.server) ? <Link key="s" href={r.server} text="server" /> : null, r.details && safeHref(r.details) ? <Link key="d" href={r.details} text="details" /> : null].filter(Boolean).flatMap((x, i) => (i ? [', ', x] : [x]))}</>;

/** The detail pane of a project row: everything, linked. @req FR:priorities-tables/web.detail @req FR:priorities-tables/web.links.agent */
/** Sends a text to a session; rejects with the reason. */
export type SendToSession = (session: string, text: string) => Promise<void>;
/** The Message agent box: on with a session id, else off with the reason. @req FR:priorities-tables/web.message @req FR:priorities-tables/web.message.off @req FR:priorities-tables/web.message.result */
const MessageAgent = ({ a, send }: { a: Agent; send: SendToSession }) => (
  <MessageBox heading="Message agent" to={a.name} off={a.session ? undefined : 'No live session for this agent'} onSend={(t) => send(a.session!, t)} />
);
/** The Ask CoS box of a gap row: the request goes to the CoS session; the owner can change the text first. @req FR:priorities-tables/web.askcos @req FR:priorities-tables/web.askcos.off */
const AskCos = ({ cos, request, send }: { cos: Agent; request: string; send: SendToSession }) => (
  <MessageBox heading="Ask CoS" send="Ask CoS" to={cos.name} text={request} off={cos.session ? undefined : `No live session for ${cos.name}`} onSend={(t) => send(cos.session!, t)} />
);

function PriDetail({ r, tz, send }: { r: PriRow; tz?: string; send: SendToSession }) {
  return (
    <div class="pri-d" data-testid="pri-detail">
      <h3 tabIndex={-1} class="pri-d-h"><LinkOr href={projectHref(r.file)} text={r.project} /></h3>
      {r.status && <p><Status s={r.status} /></p>}
      <p class={r.gap ? 'pri-muted' : undefined}>{r.gap ? r.action : <Rich text={r.action} />}</p>
      <dl class="pri-d-facts">
        <dt>Agent</dt><dd>{r.agent ? <LinkOr href={agentHref(r.agent)} text={r.agent.name} /> : '--'}{r.more ? <span class="pri-d-more"> + {r.more} more on this goal</span> : null}</dd>
        {r.cos && <><dt>CoS</dt><dd><LinkOr href={agentHref(r.cos)} text={r.cos.name} /></dd></>}
        {r.ref && <><dt>Source</dt><dd><code>{r.ref}</code></dd></>}
        <dt>Checked</dt><dd>{stampText(r, tz)}</dd>
      </dl>
      {r.agent && <MessageAgent a={r.agent} send={send} />}
      {r.gap && r.cos && r.request && <AskCos cos={r.cos} request={r.request} send={send} />}
    </div>
  );
}
/** The detail pane of a PR row. @req FR:priorities-tables/web.detail */
function PrDetail({ r, send }: { r: PrRow; send: SendToSession }) {
  return (
    <div class="pri-d" data-testid="pri-detail">
      <h3 tabIndex={-1} class="pri-d-h">{r.emoji && <span aria-hidden="true">{r.emoji} </span>}<LinkOr href={r.url} text={String(r.number)} /></h3>
      <p>{r.server || r.details ? <LiveLinks r={r} /> : r.action}</p>
      <dl class="pri-d-facts">
        <dt>Agent</dt><dd>{r.agent ? <LinkOr href={agentHref(r.agent)} text={r.agent.name} /> : '--'}</dd>
        <dt>Time</dt><dd>{r.minutes} min</dd>
      </dl>
      {r.agent && <MessageAgent a={r.agent} send={send} />}
    </div>
  );
}

const Only = ({ text }: { text: string }) => <li class="ui-card pri-only pri-muted">{text}</li>;

export function PrioritiesTables({ v, send }: { v: PrioritiesView; /** Sends a message to an agent session (`POST /sessions/{id}/prompt`). */ send: SendToSession }) {
  const sections = sectionsOf(v);
  const keys = sections.map((s) => s.key);
  const [tab, setTab] = useState<TabKey>(() => { const h = typeof location === 'undefined' ? undefined : tabFromHash(location.hash); return h && keys.includes(h) ? h : defaultTab(v); });
  const [sel, setSel] = useState<number | null>(null);
  const wide = useWide('(min-width: 900px)');
  const cur = keys.includes(tab) ? tab : defaultTab(v);
  /** @req FR:priorities-tables/web.tabs.hash */
  const pick = (k: TabKey) => {
    setTab(k); setSel(null);
    const h = hashWithTab(location.hash, k);
    if (location.hash !== h) history.replaceState(null, '', h);
  };
  const s = sections.find((x) => x.key === cur)!;
  const n = s.t.rows.length;
  const at = sel !== null && sel < n ? sel : null;
  const list = (
    <ul class="ui-cards pri-cards" aria-labelledby={`pri-tab-${cur}`}>
      {s.key === 'prs'
        ? (!s.t.verified ? <Only text="Not verified live" /> : !n ? <Only text="Nothing here" /> : s.t.rows.map((r, i) => (
          <SelectCard key={r.url} class="pri-card" label={`Details: PR ${r.number}`} selected={at === i} onSelect={() => setSel(i)}
            top={<>{r.emoji && <span aria-hidden="true">{r.emoji} </span>}<LinkOr href={r.url} text={String(r.number)} /></>}
            tools={<span class="pri-time">{r.minutes}m</span>}
            title={r.server || r.details ? <LiveLinks r={r} /> : r.action}
            sub={<AgentName a={r.agent} more={0} />} />
        )))
        : (!n ? <Only text="Nothing here" /> : s.t.rows.map((r, i) => (
          <SelectCard key={`${r.id}:${r.ref ?? r.project}`} class={`pri-card${r.gap ? ' pri-gap' : ''}`} label={`Details: ${r.project}`} selected={at === i} onSelect={() => setSel(i)}
            top={<>{r.project}{r.stale && <span class="pri-stale"> stale</span>}</>}
            tools={r.status ? <Status s={r.status} /> : undefined}
            title={r.gap ? <span class="pri-muted">{r.action}</span> : <Rich text={r.action} />}
            sub={<AgentName a={r.agent} more={0} />} />
        )))}
    </ul>
  );
  const detail = at === null ? null : s.key === 'prs' ? <PrDetail key={s.t.rows[at].url} r={s.t.rows[at]} send={send} /> : <PriDetail key={`${cur}:${s.t.rows[at].id}:${s.t.rows[at].ref ?? s.t.rows[at].project}`} r={s.t.rows[at]} tz={v.timeZone} send={send} />;
  return (
    <section class="pri-tables fl" aria-label="Priorities" data-testid="pri-tables">
      <div class="pri-head">
        <Tabs items={sections.map((x) => ({ key: x.key, label: tabLabel(x) }))} current={cur} onPick={pick} label="Priorities" idPrefix="pri"
          aside={<span class={`pri-stamp${s.t.stale ? ' stale' : ''}`} data-testid="pri-stamp">{stampText(s.t, v.timeZone)}</span>} />
      </div>
      <div class="pri-tabpanel" id="pri-panel" role="tabpanel" aria-labelledby={`pri-tab-${cur}`} data-testid={`pri-${cur}`}>
        {s.key === 'prs' && s.t.manager && safeHref(s.t.manager.link) && <p class="pri-manager"><span aria-hidden="true">👩‍💻 </span><Link href={s.t.manager.link} text={s.t.manager.name} /></p>}
        <SplitView wide={wide} open={at !== null} list={list} detail={detail} label="Priority details" empty="Select a card to see its details." onBack={() => setSel(null)} />
      </div>
    </section>
  );
}
