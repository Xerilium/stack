/**
 * The thread of the open task: loaded when a row opens, refreshed on live changes, with Ask, Assign, and inline answers.
 * @req FR:agent-thread/web.expand @req FR:agent-thread/web.live @req FR:agent-thread/thread.ask @req FR:agent-thread/thread.assign
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Client } from './api';
import type { Toast } from './parts';
import { canFollowUp, emptyThread, type Thread } from './thread';
import type { Sessions } from './useSessions';
import type { Team } from './useTeam';
import type { Send } from './asks';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;
const POLL_MS = 10_000;

/** `ref`: the open task (null closes); `tick`: bump it when tasks, asks, or sessions changed so the thread re-reads. */
export function useThread(api: Client, toast: ToastFn, team: Team, sessions: Sessions, ref: string | null, tick: string) {
  const [thread, setThread] = useState<Thread>(emptyThread());
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const toastRef = useRef(toast); toastRef.current = toast;

  const load = useCallback(async (r: string, quiet = false) => {
    const mine = ++seq.current;
    if (!quiet) setPhase('loading');
    try {
      const t = await api.thread(r);
      if (mine !== seq.current) return;
      setThread(t); setPhase('ready');
    } catch (e) {
      if (mine !== seq.current) return;
      setPhase('error'); if (!quiet) toastRef.current(e instanceof Error ? e.message : 'Cannot load the thread', 'err');
    }
  }, [api]);

  useEffect(() => {
    if (!ref) { seq.current++; setThread(emptyThread()); setPhase('idle'); return; }
    void load(ref);
  }, [ref, load]);
  // A live change re-reads the open thread quietly; the current ref and phase are read at that moment.
  const live = useRef({ ref, phase }); live.current = { ref, phase };
  useEffect(() => { const { ref: r, phase: ph } = live.current; if (r && ph !== 'idle') void load(r, true); }, [tick, load]);
  useEffect(() => {
    if (!ref) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(ref, true); }, POLL_MS);
    return () => clearInterval(t);
  }, [ref, load]);

  /** Ask: the text lands in the inbox at once, then goes to the task's idle session, else starts one. @req FR:agent-thread/thread.ask */
  const ask = useCallback(async (text: string, agent?: string, keepOpen = false): Promise<boolean> => {
    if (!ref || busy) return false;
    setBusy(true);
    try {
      try { await api.send(ref, text, 'reply'); } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Failed to send', 'err'); return false; }
      // From here the message is on the task: the box clears even if the session step fails (a retry would write it twice).
      setThread((t) => ({ ...t, items: [...t.items, { at: new Date().toISOString(), kind: 'owner', id: `local-${Date.now()}`, text, state: 'open' }] }));
      if (team.enabled !== true) { toastRef.current('Saved on the task; it runs in stack web on your machine'); return true; }
      try {
        if (canFollowUp(thread) && thread.session) {
          await api.promptSession(thread.session.id, text);
          if (keepOpen) void sessions.openDrawer(thread.session.id);
        } else {
          const r = await api.newSession(undefined, text, { agent, ref });
          if (r.sessionId) team.noteStarted(ref, r.sessionId);
          if (keepOpen) void sessions.openDrawer(r.sessionId ?? r.runId);
        }
      } catch (e) { toastRef.current(`Saved on the task, but the agent did not start: ${e instanceof Error ? e.message : 'failed'}`, 'err'); }
      void sessions.reload();
      void load(ref, true);
      return true;
    } finally { setBusy(false); }
  }, [api, ref, busy, thread, team, sessions, load]);

  /** @req FR:agent-thread/thread.assign */
  const assign = useCallback(async (agent?: string, keepOpen = false): Promise<boolean> => {
    if (!ref || busy) return false;
    setBusy(true);
    try { const ok = await team.assign(ref, agent, keepOpen); if (ok) void load(ref, true); return ok; } finally { setBusy(false); }
  }, [ref, busy, team, load]);

  /** Answer one of the task's asks from the thread. */
  const answer = useCallback(async (key: string, send: Send, label: string) => {
    try { await api.answerAsk(key, send); toastRef.current(label); if (ref) void load(ref, true); } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Failed', 'err'); }
  }, [api, ref, load]);

  return { thread, phase, busy, ask, assign, answer, reload: () => (ref ? load(ref, true) : Promise.resolve()) };
}
export type ThreadCtl = ReturnType<typeof useThread>;
