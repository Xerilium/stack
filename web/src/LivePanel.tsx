/**
 * `#/live`: the live validation checklist for the one PR in the lane. Mobile first: tap to check, long press or Comment
 * to comment, Needs fix to hand an item back to the agent, and an add box at the end.
 * @req FR:pr-review-lane/panel.view @req FR:pr-review-lane/panel.chip @req FR:pr-review-lane/panel.check @req FR:pr-review-lane/panel.comment
 * @req FR:pr-review-lane/panel.fix @req FR:pr-review-lane/panel.add @req FR:pr-review-lane/panel.refresh @req FR:pr-review-lane/panel.a11y
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { byWord, CHIP, ITEM_WORD, liveClient, newerLane, toggleOp, type Lane, type LiveItem } from './live-lane';
import './live-lane.css';

type Client = ReturnType<typeof liveClient>;

function Item({ item, busy, run }: { item: LiveItem; busy: boolean; run: (op: Parameters<Client['item']>[1], o?: { id?: string; text?: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(item.comment ?? '');
  const timer = useRef<number | undefined>(undefined);
  // A closed editor follows the stored comment, so a save never overwrites a newer one; an open draft is kept.
  useEffect(() => { if (!open) setText(item.comment ?? ''); }, [item.comment, open]);
  // Long press (500 ms) opens the comment box. @req FR:pr-review-lane/panel.comment
  const down = (e: PointerEvent) => { if ((e.target as Element).closest('button, a, textarea, input')) return; timer.current = window.setTimeout(() => setOpen(true), 500); };
  const up = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = undefined; };
  const passed = item.state === 'passed';
  const boxId = `lv-c-${item.id}`;
  return (
    <li class={`lv-item s-${item.state}`} data-id={item.id} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}>
      <div class="lv-row">
        <button type="button" class={`lv-check${passed ? ' on' : ''}`} role="checkbox" aria-checked={passed} aria-label={`Passed: ${item.text}`} disabled={busy} onClick={() => void run(toggleOp(item), { id: item.id })}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <div class="lv-body">
          <div class="lv-text">{item.text}</div>
          <div class="lv-meta"><span class="lv-state">{ITEM_WORD[item.state]}</span> · <span>by {byWord(item.by)}</span>{item.updatedBy && item.updatedBy !== item.by && <span> · last change by {byWord(item.updatedBy)}</span>}</div>
          {item.comment && !open && <div class="lv-comment">{item.comment}</div>}
          {item.state === 'blocked' && item.reason && <div class="lv-comment lv-reason">Blocked: {item.reason}</div>}
        </div>
      </div>
      {open ? (
        <div class="lv-edit">
          <label class="lv-label" for={boxId}>Comment</label>
          <textarea id={boxId} class="lv-input" rows={2} maxLength={300} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' '))} />
          <div class="lv-actions">
            <button type="button" class="btn" disabled={busy || !text.trim()} onClick={async () => { if (await run('comment', { id: item.id, text: text.trim() })) setOpen(false); }}>Save comment</button>
            <button type="button" class="btn warn" disabled={busy} onClick={async () => { if (await run('needs-fix', { id: item.id, ...(text.trim() ? { text: text.trim() } : {}) })) setOpen(false); }}>Needs fix</button>
            <button type="button" class="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div class="lv-actions">
          <button type="button" class="btn ghost" onClick={() => setOpen(true)}>Comment</button>
          <button type="button" class="btn warn" disabled={busy || item.state === 'needs-fix'} onClick={() => void run('needs-fix', { id: item.id })}>Needs fix</button>
        </div>
      )}
    </li>
  );
}

export function LivePanel({ fetchFn }: { fetchFn?: typeof fetch } = {}) {
  const [api] = useState(() => liveClient(fetchFn));
  const [lane, setLane] = useState<Lane | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState('');

  const load = useCallback(async () => {
    try { const next = await api.lane(); setLane((prev) => newerLane(prev, next)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the live lane'); }
  }, [api]);
  // Reload every 15 s while visible. @req FR:pr-review-lane/panel.refresh
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  const run = async (op: Parameters<Client['item']>[1], o: { id?: string; text?: string } = {}): Promise<boolean> => {
    if (!lane?.active) return false;
    setBusy(true);
    try { await api.item(lane.active, op, o); await load(); return true; } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); return false; } finally { setBusy(false); }
  };

  const a = lane?.active;
  return (
    <main class="lv" aria-labelledby="lv-h">
      <header class="lv-head">
        <h1 id="lv-h" class="lv-title">Live validation</h1>
        {lane && <span class={`lv-chip c-${lane.state}`} data-testid="lane-chip" role="status" aria-live="polite">{CHIP[lane.state]}</span>}
      </header>
      {error && <p class="lv-error" role="alert">{error}</p>}
      {!lane && !error && <p class="lv-empty" role="status">Loading…</p>}
      {lane && !a && <p class="lv-empty">No PR in live validation.</p>}
      {a && (
        <>
          <section class="lv-pr" aria-label="Live PR">
            <a class="lv-link" href={a.url} target="_blank" rel="noopener noreferrer">{a.title ? `${a.title} ` : ''}<span class="lv-ref">{a.repo}#{a.number}</span></a>
            {a.serverUrl ? <a class="btn primary lv-open" href={a.serverUrl} target="_blank" rel="noopener noreferrer">Open app</a> : <span class="lv-muted">No server yet</span>}
            {a.waitingOnLock && <span class="lv-muted">Waiting on server lock: {a.waitingOnLock}</span>}
          </section>
          <ul class="lv-list" aria-label="Checklist">
            {lane.items.map((i) => <Item key={i.id} item={i} busy={busy} run={run} />)}
          </ul>
          {lane.items.length === 0 && <p class="lv-empty">No checks yet. The agent adds them from the PR spec.</p>}
          <form class="lv-add" onSubmit={async (e) => { e.preventDefault(); const t = add.trim(); if (t && await run('add', { text: t })) setAdd(''); }}>
            <label class="lv-label" for="lv-add">Add a check</label>
            <div class="lv-add-row">
              <input id="lv-add" class="lv-input" type="text" maxLength={300} value={add} placeholder="What to check" onInput={(e) => setAdd((e.target as HTMLInputElement).value)} />
              <button type="submit" class="btn primary" disabled={busy || !add.trim()}>Add</button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
