/**
 * Runs: one prompt to a session, buffered so a drawer opened late still sees everything, fanned out to subscribers, and logged when it stops.
 * @req FR:agent-sessions/run.events @req FR:agent-sessions/run.cancel @req FR:agent-sessions/run.record @req FR:agent-sessions/sessions.list @req FR:agent-sessions/sessions.cost
 */
import { oneLine } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { NotFoundError } from '../core/storage';
import { createPermissionBroker, type PermissionBroker } from './broker';
import { projectOf, SessionBusy, sessionState, STATE_ORDER, type AgentDriver, type Session, type SessionState, type Turn, type Update } from './driver';

export interface RunManagerOptions { driver: AgentDriver; ctx: LifecycleContext; broker?: PermissionBroker; keepMs?: number; activeMs?: number }
export interface ListedSession extends Omit<Session, 'active' | 'cost'> { state: SessionState; cost: { usd: number; tokens: number; approx?: boolean } }
export interface CostReport {
  attribution: 'lastActive';
  /** Sessions whose cost is still being indexed; the figures grow until it is 0. */
  indexing: number;
  days: { date: string; usd: number; tokens: number; sessions: number }[];
  projects: { project: string; usd: number; tokens: number; sessions: number }[];
  models: { model: string; usd: number; tokens: number }[];
  total: { usd: number; tokens: number; sessions: number };
}
export interface AgentRuns {
  prompt(req: { sessionId?: string; cwd?: string; text: string }): Promise<{ runId: string; sessionId: string | null }>;
  cancel(sessionId: string): Promise<{ changed: boolean }>;
  /** Replays the run's updates for a session id or run id, then streams; `null` when there is no run to show. */
  subscribe(key: string, onUpdate: (u: Update) => void, onClose: () => void): (() => void) | null;
  running(sessionId: string): boolean;
  sessionOf(runId: string): string | null;
  needsYou: () => Promise<Set<string>>;
  sessions(o?: { limit?: number }): Promise<{ items: ListedSession[]; total: number; indexing: number }>;
  messages(id: string, o?: { limit?: number }): Promise<Turn[]>;
  cost(days: number): Promise<CostReport>;
}

interface RunState { id: string; sessionId: string | null; text: string; buffer: Update[]; done: boolean; subs: Set<{ u: (x: Update) => void; c: () => void }>; startedAt: Date }
const LOG = 'tasks/logs/sessions.md';
/** `YYYY-MM-DD` of an instant in a timezone (the owner's configured one, else UTC). */
export function dayIn(iso: string | Date, timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso); } catch { return (typeof iso === 'string' ? new Date(iso) : iso).toISOString().slice(0, 10); }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function createRunManager(o: RunManagerOptions): AgentRuns {
  const { driver, ctx } = o;
  const keepMs = o.keepMs ?? 10 * 60_000;
  const now = () => (ctx.now ?? (() => new Date()))();
  const broker = o.broker ?? createPermissionBroker(ctx);
  const runs = new Map<string, RunState>();
  const bySession = new Map<string, string>();

  const running = (sessionId: string) => { const id = bySession.get(sessionId); return !!id && !runs.get(id)?.done; };

  async function record(r: RunState, d: Extract<Update, { type: 'done' }>) {
    const line = `- ${r.startedAt.toISOString()} ${(r.sessionId ?? 'new').slice(0, 8)} ${d.stopReason} $${d.cost.usd.toFixed(2)} ${d.cost.tokens} tokens: ${oneLine(r.text).slice(0, 120)}\n`;
    for (let tries = 0; tries < 3; tries++) {
      try {
        let cur: { content: string; version: string } | null = null;
        try { cur = await ctx.storage.read(LOG); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
        const head = cur ? cur.content.replace(/\n*$/, '\n') : '# Session runs\n\n<!-- stack-session-runs v1: one line per prompt sent from the dashboard. -->\n\n';
        await ctx.storage.write(LOG, head + line, { expectedVersion: cur ? cur.version : null, message: 'Session run' });
        return;
      } catch { /* another writer got in first: reread */ }
    }
  }

  async function prompt(req: { sessionId?: string; cwd?: string; text: string }) {
    if (req.sessionId && running(req.sessionId)) throw new SessionBusy('Session is running; wait for it to finish');
    const session = req.sessionId ? (await driver.listSessions()).find((s) => s.id === req.sessionId) : undefined;
    const state: RunState = { id: '', sessionId: req.sessionId ?? null, text: req.text, buffer: [], done: false, subs: new Set(), startedAt: now() };
    const run = await driver.prompt({
      ...(req.sessionId ? { sessionId: req.sessionId } : {}), ...(req.cwd ? { cwd: req.cwd } : {}), text: req.text,
      onPermission: (pr) => broker.ask({ id: state.sessionId ?? state.id, title: session?.title || projectOf(req.cwd ?? '') || 'new session', cwd: session?.cwd ?? req.cwd ?? '' }, pr, state.id),
    });
    state.id = run.id;
    runs.set(run.id, state);
    if (state.sessionId) bySession.set(state.sessionId, run.id);
    void (async () => {
      try {
        for await (const u of run.updates) {
          if (u.type === 'session') { state.sessionId = u.sessionId; bySession.set(u.sessionId, run.id); }
          state.buffer.push(u);
          for (const s of state.subs) s.u(u);
          if (u.type === 'done') { state.done = true; await record(state, u); }
        }
      } catch { /* the driver's stream failed after done, or never produced one */ }
      if (!state.done) {
        const d: Update = { type: 'done', stopReason: 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, error: 'The run ended without a result' };
        state.buffer.push(d); state.done = true; for (const s of state.subs) s.u(d);
      }
      broker.release(run.id);
      for (const s of state.subs) s.c();
      state.subs.clear();
      setTimeout(() => { runs.delete(run.id); if (bySession.get(state.sessionId ?? '') === run.id) bySession.delete(state.sessionId ?? ''); }, keepMs).unref?.();
    })();
    return { runId: run.id, sessionId: state.sessionId };
  }

  async function cancel(sessionId: string) {
    const id = bySession.get(sessionId);
    const r = id ? runs.get(id) : undefined;
    if (!r || r.done) return { changed: false };
    await driver.cancel(r.id);
    return { changed: true };
  }

  function subscribe(key: string, onUpdate: (u: Update) => void, onClose: () => void) {
    const r = runs.get(key) ?? runs.get(bySession.get(key) ?? '');
    if (!r) return null;
    for (const u of r.buffer) onUpdate(u);
    if (r.done) { onClose(); return () => undefined; }
    const sub = { u: onUpdate, c: onClose };
    r.subs.add(sub);
    return () => { r.subs.delete(sub); };
  }

  const api: AgentRuns = {
    prompt, cancel, subscribe, running,
    sessionOf: (runId) => runs.get(runId)?.sessionId ?? null,
    needsYou: () => broker.open(),
    async sessions(q = {}) {
      const [all, open] = await Promise.all([driver.listSessions({ limit: 200 }), api.needsYou()]);
      const t = now();
      const items = all.map((s) => {
        const { active, cost, ...rest } = s;
        const needs = open.has(s.id) || open.has(s.id.slice(0, 8));
        return { ...rest, state: sessionState({ lastActive: s.lastActive, running: running(s.id), needsYou: needs, active }, t, o.activeMs), cost: { usd: cost.usd, tokens: cost.tokens, ...(cost.approx ? { approx: true } : {}) } };
      });
      items.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastActive.localeCompare(a.lastActive));
      return { items: items.slice(0, q.limit ?? 50), total: items.length, indexing: driver.indexing?.() ?? 0 };
    },
    async messages(id, q = {}) {
      try { return await driver.getMessages(id, q); } catch (e) { if (e instanceof Error && /not found/i.test(e.message)) throw new NotFoundError(`Session not found: ${id}`); throw e; }
    },
    async cost(days) {
      const t = now();
      const tz = ctx.config?.timezone ?? 'UTC';
      // Day keys in the owner's timezone; the window starts a safe day early and keeps only the keyed days.
      const dayRows = new Map<string, { usd: number; tokens: number; sessions: number }>();
      for (let i = days - 1; i >= 0; i--) dayRows.set(dayIn(new Date(t.getTime() - i * 864e5), tz), { usd: 0, tokens: 0, sessions: 0 });
      const start = t.getTime() - (days + 1) * 864e5;
      const all = await driver.listSessions({ sinceMs: start });
      const date = (iso: string) => dayIn(iso, tz);
      const projects = new Map<string, { usd: number; tokens: number; sessions: number }>();
      const models = new Map<string, { usd: number; tokens: number }>();
      const total = { usd: 0, tokens: 0, sessions: 0 };
      for (const s of all) {
        const d = dayRows.get(date(s.lastActive));
        if (!d) continue;
        d.usd += s.cost.usd; d.tokens += s.cost.tokens; d.sessions++;
        const p = projects.get(s.project) ?? { usd: 0, tokens: 0, sessions: 0 };
        p.usd += s.cost.usd; p.tokens += s.cost.tokens; p.sessions++; projects.set(s.project, p);
        for (const [model, m] of Object.entries(s.cost.byModel ?? {})) { const cur = models.get(model) ?? { usd: 0, tokens: 0 }; cur.usd += m.usd; cur.tokens += m.tokens; models.set(model, cur); }
        total.usd += s.cost.usd; total.tokens += s.cost.tokens; total.sessions++;
      }
      return {
        attribution: 'lastActive',
        indexing: driver.indexing?.() ?? 0,
        days: [...dayRows].map(([dateKey, v]) => ({ date: dateKey, usd: r2(v.usd), tokens: v.tokens, sessions: v.sessions })),
        projects: [...projects].map(([project, v]) => ({ project, usd: r2(v.usd), tokens: v.tokens, sessions: v.sessions })).sort((a, b) => b.usd - a.usd || a.project.localeCompare(b.project)),
        models: [...models].map(([model, v]) => ({ model, usd: r2(v.usd), tokens: v.tokens })).sort((a, b) => b.usd - a.usd),
        total: { usd: r2(total.usd), tokens: total.tokens, sessions: total.sessions },
      };
    },
  };
  return api;
}
