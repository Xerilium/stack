/**
 * `#/qm`: the weekly QM plan as one plain, sortable table. Read only; agents write it with `stack qm put`.
 * @req FR:qm-plan/ui.route @req FR:qm-plan/ui.table @req FR:qm-plan/ui.sort @req FR:qm-plan/ui.stamp @req FR:qm-plan/ui.style @req FR:qm-plan/live.reload
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { connectLive } from './live';
import { COLS, loadQm, numText, sortRows, type Dir, type QmCol, type QmPlan } from './qm';
import './qm.css';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Subscribes to host changes; returns a stop function. */
export type QmLive = (onChange: (kinds: string[]) => void) => () => void;
const hostLive: QmLive = (onChange) => connectLive({ onChange, onStatus: () => undefined });
/** A plan write (`qm`), a poll with no event stream, or a full refresh after a reconnect (`state`) may change the plan. @req FR:qm-plan/live.reload */
const RELOAD = new Set(['qm', 'poll', 'state']);

export function QmView({ fetchFn, live = hostLive }: { fetchFn?: typeof fetch; live?: QmLive } = {}) {
  const [plan, setPlan] = useState<QmPlan | null | undefined>(undefined);
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ col: QmCol; dir: Dir }>({ col: 'project', dir: 'asc' });
  const load = useCallback(() => { loadQm(fetchFn).then((r) => { setPlan(r.plan); setBroken(!!r.broken); setError(''); }, (e: unknown) => setError(e instanceof Error ? e.message : 'Cannot load the plan')); }, [fetchFn]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => live((kinds) => { if (kinds.some((k) => RELOAD.has(k))) load(); }), [live, load]);
  const by = (col: QmCol) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));
  return (
    <main class="fl qm">
      <header class="qm-head">
        <a class="qm-back" href="#/now">‹ Back</a>
        <h1 class="qm-title">QM plan</h1>
        {plan && <p class="qm-stamp">As of {when(plan.asOf)}</p>}
      </header>
      <p class="qm-hint">Spare weekly agent quota, spent on autonomous work. Agents write it with <code>stack qm put</code>.</p>
      {error && <p class="qm-empty qm-error" role="alert">{error}</p>}
      {!error && plan === undefined && <p class="qm-empty">Loading…</p>}
      {!error && plan === null && <p class="qm-empty">{broken ? 'The plan file is broken. An agent must write it again.' : 'No plan yet.'}</p>}
      {plan && (
        <div class="qm-scroll" role="region" aria-label="QM plan table" tabIndex={0}>
          <table class="qm-table">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.id} scope="col" class={c.num ? 'num' : undefined} aria-sort={sort.col === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" class="qm-sort" title={`Sort by ${c.label}`} onClick={() => by(c.id)}>
                      {c.label}<span class="qm-arrow" aria-hidden="true">{sort.col === c.id ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortRows(plan.projects, sort.col, sort.dir).map((r) => (
                <tr key={r.project}>
                  <th scope="row">{r.project}</th>
                  <td>
                    {r.agent.url ? <a href={r.agent.url} target="_blank" rel="noopener noreferrer">{r.agent.name}</a> : r.agent.name}
                    {r.agent.sessionId && <div class="qm-sub">{r.agent.sessionId}</div>}
                  </td>
                  <td class="num qm-tasks">
                    {r.tasks.length ? (
                      <details>
                        <summary>{r.tasks.length}</summary>
                        <ol>{r.tasks.map((t, i) => <li key={i}>{t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer">{t.title}</a> : t.title}</li>)}</ol>
                      </details>
                    ) : '0'}
                  </td>
                  <td class={`num${r.weeklyTokens === null ? ' pending' : ''}`}>{numText(r.weeklyTokens)}</td>
                  <td class={`num${r.preAckMin === null ? ' pending' : ''}`}>{numText(r.preAckMin)}</td>
                  <td class={`num${r.postReviewMin === null ? ' pending' : ''}`}>{numText(r.postReviewMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
