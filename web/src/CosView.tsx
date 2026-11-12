/**
 * The Chief of Staff view: the CoS's own brief and a message box, then compact summaries drawn by the components of the full views.
 * It keeps no state of its own: every section reads the shared hook or store of its full view.
 * @req FR:cos-base-of-ops/state.none @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale @req FR:cos-base-of-ops/state.line @req FR:cos-base-of-ops/state.off
 * @req FR:cos-base-of-ops/brief.top @req FR:cos-base-of-ops/brief.blockers @req FR:cos-base-of-ops/brief.progress @req FR:cos-base-of-ops/compose.decisions
 * @req FR:cos-base-of-ops/compose.pris @req FR:cos-base-of-ops/compose.prs @req FR:cos-base-of-ops/compose.team @req FR:cos-base-of-ops/compose.today
 * @req FR:cos-base-of-ops/msg.box @req FR:cos-base-of-ops/msg.send @req FR:cos-base-of-ops/msg.ask @req FR:cos-base-of-ops/layout.grid @req FR:cos-base-of-ops/layout.look
 */
import { useEffect, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { Avatar } from './AgentAvatar';
import { anchorFor, ASK_REPORT, cosName, cosReport, prSummary, reportState, stateLine, type CosItem, type CosReport } from './cos';
import { NowAsks, type AskCtl } from './NowAsks';
import { NowNext, type CalCtl, type Layer } from './NowNext';
import { PrisBlock, SessionsBlock } from './PrisSessions';
import { usePrBoard } from './PrsPanel';
import { clip, refOf } from './prs';
import { rollupOf, type TeamAgent } from './team';
import type { InventoryCtl, PrisCtl } from './usePrisSessions';
import type { BriefMeeting } from './brief';
import type { AskItem } from './asks';
import type { Task, View } from './types';
import './cos.css';

export interface CosProps {
  api: Client; team: TeamAgent[]; tasks: Task[]; now: Date; busy: boolean; liveTick: number;
  /** Open asks in Needs you; the top 3 as Now draws them. */ open: number; waiting: { rows: AskItem[]; more: number }; asks: Omit<AskCtl, 'busy' | 'now'>;
  pris: PrisCtl; sessions: InventoryCtl; meetings: BriefMeeting[]; layer: Layer; cal: CalCtl;
  toast: (t: string, kind?: 'ok' | 'err') => void; go: (v: View) => void;
}

const FOLD = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' / ');

function Items({ list, id, label, warn = false }: { list: CosItem[]; id: string; label: string; warn?: boolean }) {
  if (!list.length) return null;
  return (
    <div class="cos-block" data-testid={id}>
      <h3 class="cos-eyebrow">{label}</h3>
      <ul class={`cos-items${warn ? ' warn' : ''}`}>
        {list.map((x, i) => <li key={i}>{x.link ? <a class="cos-link" href={x.link} target="_blank" rel="noopener noreferrer">{x.text}</a> : x.text}</li>)}
      </ul>
    </div>
  );
}

export function CosView(p: CosProps) {
  const { api, team, now } = p;
  const [reports, setReports] = useState<CosReport[] | null | 'off'>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const board = usePrBoard(api);
  useEffect(() => {
    let live = true;
    api.reports().then((r) => { if (live) setReports(r); }, (e) => { if (live) setReports(e instanceof ApiFailure && e.status === 404 ? 'off' : []); });
    return () => { live = false; };
  }, [api, p.liveTick]);

  const cos = rollupOf(team);
  const name = cosName(team);
  const report = Array.isArray(reports) ? cosReport(reports, cos?.slug ?? 'cos') : undefined;
  const st = reportState(report, now);
  const anchor = anchorFor(p.tasks, team, cos?.slug ?? 'cos');
  const inv = p.sessions.inv;
  const line = stateLine({ open: p.open, ...(st.kind === 'fresh' && report ? { blockers: report.blockers.length } : {}), ...(inv ? { running: inv.counts.running ?? 0 } : {}) });
  const prs = prSummary(board.board);

  const send = async (msg: string) => {
    const t = FOLD(msg).slice(0, 1000);
    if (!t || !anchor || sending) return false;
    setSending(true);
    try { await api.send(anchor.ref, t, 'instruction'); p.toast(`Sent to ${name}`); return true; } catch (e) { p.toast(e instanceof Error ? e.message : 'Failed to send', 'err'); return false; } finally { setSending(false); }
  };
  const submit = async () => { if (await send(text)) setText(''); };

  return (
    <section class="cos fl" aria-label={name} data-testid="cos">
      <header class="cos-head" data-testid="cos-head">
        <div class="cos-who">
          {cos ? <Avatar who={cos} size={40} /> : <span class="cos-mono" aria-hidden="true">CoS</span>}
          <div class="cos-id">
            <h1 class="cos-name">{name}</h1>
            <p class={`cos-age${st.kind === 'fresh' ? '' : ' warn'}`} data-testid="cos-age" title={st.title}>{reports === 'off' ? 'No report store on this host' : reports === null ? 'Loading…' : st.text}</p>
            {line && <p class="cos-line" data-testid="cos-line">{line}</p>}
          </div>
          {reports !== 'off' && reports !== null && st.kind !== 'fresh' && <button type="button" class="fl-btn cos-ask" disabled={!anchor || sending} onClick={() => void send(ASK_REPORT)}>Ask for a report</button>}
        </div>
        <form class="cos-msg" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label class="cos-eyebrow" for="cos-msg">Message the CoS</label>
          <div class="cos-msg-row">
            <textarea id="cos-msg" rows={1} maxLength={1000} value={text} disabled={!anchor} placeholder={anchor ? `Tell ${name} what to do` : 'Add a task first: messages attach to a task'}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void submit(); } }} />
            <button type="submit" class="fl-btn primary" disabled={!anchor || sending || !text.trim()}>Send</button>
          </div>
        </form>
      </header>

      <div class="cos-main">
        {report && (
          <section class="cos-brief" aria-label="Brief">
            {st.kind === 'stale' && <p class="cos-from">From {st.age}</p>}
            <Items list={report.top} id="cos-top" label="Top 3" />
            <Items list={report.blockers} id="cos-blockers" label="Blockers" warn />
            <Items list={report.progress} id="cos-progress" label="Progress" />
          </section>
        )}
        <section class="cos-sec" aria-label="Decisions">
          <NowAsks rows={p.waiting.rows} more={p.waiting.more} ctl={{ ...p.asks, busy: p.busy, now }} onOpenAsks={() => p.go('asks')} />
          {p.waiting.more === 0 && <a class="cos-see" href="#/asks">Open Needs you <span aria-hidden="true">→</span></a>}
        </section>
      </div>

      <div class="cos-side">
        <div class="cos-sec">
          {p.pris.phase === 'absent' ? <><h2 class="cos-eyebrow">Priorities</h2><p class="cos-off" data-testid="cos-pris-off">No priorities store on this host</p></> : <PrisBlock ctl={p.pris} />}
        </div>

        <section class="cos-sec" aria-labelledby="cos-prs-h" data-testid="cos-prs">
          <h2 class="cos-eyebrow" id="cos-prs-h">Pull requests</h2>
          {board.phase === 'off' ? <p class="cos-off">PR board is off on this host</p> : board.phase === 'loading' ? <p class="cos-off">Loading…</p> : (
            <>
              <ul class="cos-counts">
                {prs.counts.map((c) => <li key={c.tab}><a class="cos-count" href={`#/prs?tab=${c.tab}`} aria-label={`${c.label}: ${c.n}`}><span class="cos-count-n">{c.n}</span><span>{c.label}</span></a></li>)}
              </ul>
              {prs.esc.length > 0 && (
                <ul class="cos-esc">
                  {prs.esc.map((e) => (
                    <li key={e.url}>
                      <a class="cos-link" href="#/prs?tab=escalations">{clip(e.title ?? refOf(e), 70)}</a>
                      <span class="cos-meta"><a class="cos-link quiet" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={`${refOf(e)} on GitHub`}>{refOf(e)}</a>{e.blocker && <> · {clip(e.blocker, 60)}</>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section class="cos-sec" aria-labelledby="cos-team-h">
          <h2 class="cos-eyebrow" id="cos-team-h">Agents</h2>
          {p.sessions.phase === 'absent' ? <p class="cos-off">No session inventory on this host</p> : inv && <p class="cos-off">{inv.counts.running ?? 0} running, {inv.needsYou.length} waiting on you</p>}
          <SessionsBlock ctl={p.sessions} toast={p.toast} />
          <a class="cos-see" href="#/agents">Open Agents <span aria-hidden="true">→</span></a>
        </section>

        <section class="cos-sec now-side" aria-label="Today">
          <NowNext meetings={p.meetings} layer={p.layer} cal={p.cal} now={now} />
          <a class="cos-see" href="#/today">Open My day <span aria-hidden="true">→</span></a>
        </section>
      </div>
    </section>
  );
}
