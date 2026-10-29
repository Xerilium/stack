/**
 * State for AI on every page: the team, each project's reviews, which task a session belongs to, the one open composer, starting and reviewing.
 * @req FR:agent-team/web.chip @req FR:agent-team/web.talk @req FR:agent-team/web.review @req FR:agent-team/web.norunner
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Client } from './api';
import type { Toast } from './parts';
import { agentsFor, chipFor, sessionFor, type ChipView, type ReviewItem, type Talk, type TeamAgent } from './team';
import type { Sessions } from './useSessions';
import type { Task } from './types';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;
const DONE_MS = 10 * 60_000;

/** `enabled`: true when the host runs agents, false when not, null while unknown. `ready`: the task list has loaded (the team is read then). */
export function useTeam(api: Client, toast: ToastFn, sessions: Sessions, enabled: boolean | null, ready: boolean, projects: string[]) {
  const [team, setTeam] = useState<TeamAgent[]>([]);
  const [reviews, setReviews] = useState<Map<string, ReviewItem>>(new Map());
  const [talk, setTalkState] = useState<Talk | null>(null);
  const [reviewing, setReviewing] = useState<Set<string>>(new Set());
  /** Sessions started from a row in the last 10 minutes, so a finished one still reads `Done · $0.12` on the row. */
  const [recent, setRecent] = useState<Map<string, { id: string; at: number }>>(new Map());
  const toastRef = useRef(toast); toastRef.current = toast;
  const loaded = useRef(false);

  const loadTeam = useCallback(async () => {
    try { setTeam(await api.team()); } catch { /* the chip then says No agent; nothing else breaks */ }
  }, [api]);
  const loadReviews = useCallback(async (names: string[]) => {
    const got = await Promise.allSettled(names.map((p) => api.reviews(p)));
    setReviews((cur) => {
      const next = new Map(cur);
      got.forEach((g, i) => { if (g.status !== 'fulfilled') return; for (const [k] of next) if (k.startsWith(`${names[i]}:`)) next.delete(k); for (const r of g.value) next.set(r.ref, r); });
      return next;
    });
  }, [api]);
  const projectsKey = projects.join('␟');
  useEffect(() => {
    if (!ready) return;
    if (!loaded.current) { loaded.current = true; void loadTeam(); }
    void loadReviews(projectsKey ? projectsKey.split('␟') : []);
  }, [ready, projectsKey, loadTeam, loadReviews]);

  const agentsOf = useCallback((t: Pick<Task, 'project' | 'section'>) => agentsFor(team, t.project, t.section), [team]);
  const sessionOf = useCallback((ref: string) => {
    const hit = sessionFor(sessions.items, ref);
    if (hit) return hit;
    const r = recent.get(ref);
    return r ? sessions.items.find((s) => s.id === r.id) : undefined;
  }, [sessions.items, recent]);
  /** @req FR:agent-team/web.chip */
  const chipOf = useCallback((t: Pick<Task, 'ref' | 'project' | 'section'>): ChipView => {
    const s = sessionOf(t.ref);
    const r = recent.get(t.ref);
    if (s && s.state !== 'running' && s.state !== 'needs-you' && r && Date.now() - r.at < DONE_MS) return { text: `Done · ${s.cost.usd < 0.01 ? '<0.01' : s.cost.usd.toFixed(2)}`, tone: 'ok', title: `${s.title}. Open the session`, state: true };
    return chipFor({ agent: agentsOf(t)[0], review: reviews.get(t.ref), session: s, reviewing: reviewing.has(t.ref) });
  }, [agentsOf, reviews, sessionOf, reviewing, recent]);

  const setTalk = useCallback((t: Talk | null) => setTalkState(t), []);
  const toggleTalk = useCallback((t: Talk) => setTalkState((cur) => (cur && (cur.ref ?? cur.askKey ?? cur.project) === (t.ref ?? t.askKey ?? t.project) ? null : t)), []);

  /** Starts a session for the talk target. @req FR:agent-team/web.talk */
  const start = useCallback(async (t: Talk, agent: string | undefined, text: string, keepOpen: boolean): Promise<boolean> => {
    if (enabled !== true) { toastRef.current('Runs in stack web on your machine', 'err'); return false; }
    try {
      const r = await api.newSession(undefined, text, { agent, ...(t.ref ? { ref: t.ref } : { project: t.project }) });
      const key = t.ref ?? t.askKey ?? t.project;
      if (r.sessionId) setRecent((m) => new Map(m).set(key, { id: r.sessionId!, at: Date.now() }));
      setTalkState(null);
      await sessions.reload();
      if (keepOpen) void sessions.openDrawer(r.sessionId ?? r.runId); else toastRef.current(`Sent to ${r.agent ?? 'the agent'}`);
      return true;
    } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Failed to start', 'err'); return false; }
  }, [api, enabled, sessions]);

  /** @req FR:agent-team/web.review */
  const review = useCallback(async (ref: string, agent?: string) => {
    if (enabled !== true) { toastRef.current('Runs in stack web on your machine', 'err'); return; }
    setReviewing((s) => new Set(s).add(ref));
    setTalkState(null);
    try {
      const r = await api.review(ref, agent);
      // Not `recent`: the verdict chip, not the Done line, is what a review leaves behind.
      void sessions.reload();
      // The verdict lands when the run ends: follow its stream and refresh the project's reviews on done.
      const es = typeof EventSource === 'undefined' ? null : new EventSource(`/sessions/${encodeURIComponent(r.sessionId ?? r.runId)}/events`);
      // `done` reaches the page before the server has written the log and the asks: read now and again shortly after.
      const project = ref.slice(0, ref.lastIndexOf(':'));
      const finish = () => { es?.close(); setReviewing((s) => { const n = new Set(s); n.delete(ref); return n; }); void loadReviews([project]); void sessions.reload(); for (const ms of [1500, 5000]) setTimeout(() => void loadReviews([project]), ms); };
      if (!es) { setTimeout(finish, 20_000); return; }
      es.addEventListener('update', (e) => { try { if ((JSON.parse((e as MessageEvent).data) as { type: string }).type === 'done') finish(); } catch { /* ignore */ } });
      es.onerror = () => { if (es.readyState === 2) finish(); };
    } catch (e) {
      setReviewing((s) => { const n = new Set(s); n.delete(ref); return n; });
      toastRef.current(e instanceof Error ? e.message : 'Review failed', 'err');
    }
  }, [api, enabled, sessions, loadReviews]);

  const openSession = useCallback((ref: string) => { const s = sessionOf(ref); if (s) void sessions.openDrawer(s.id); }, [sessionOf, sessions]);
  // `recent` only matters for 10 minutes (the Done chip); drop old entries so polling stops once every row-started session is old news.
  useEffect(() => {
    if (recent.size === 0) return;
    const t = setInterval(() => setRecent((m) => { const n = new Map([...m].filter(([, v]) => Date.now() - v.at < DONE_MS)); return n.size === m.size ? m : n; }), 30_000);
    return () => clearInterval(t);
  }, [recent.size]);
  const active = useMemo(() => reviewing.size > 0 || recent.size > 0, [reviewing, recent]);

  return { team, reviews, talk, setTalk, toggleTalk, agentsOf, chipOf, sessionOf, start, review, reviewing, openSession, enabled, active };
}
export type Team = ReturnType<typeof useTeam>;
