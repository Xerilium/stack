/**
 * Permission prompts as asks: a request becomes `tasks/asks/perm-<session8>-<request>.md`, the owner answers it on the home view,
 * and the answer resolves the agent's request. Unanswered requests are denied at the deadline so an agent never waits forever.
 * @req FR:agent-sessions/perm.ask @req FR:agent-sessions/perm.answer @req FR:agent-sessions/perm.timeout
 */
import { asksPath, handleAsk, listAsks, oneLine, parseAsk, putAsk, type Ask } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { NotFoundError } from '../core/storage';
import { redact } from '../core/triage';
import { projectOf, type PermissionAnswer, type PermissionRequest } from './driver';

export interface BrokerOptions { pollMs?: number; timeoutMs?: number }
export interface BrokerSession { id: string; title: string; cwd: string }
export interface PermissionBroker {
  ask(session: BrokerSession, req: PermissionRequest, runId: string): Promise<PermissionAnswer>;
  /** The run ended: every pending request of it is denied and its ask resolved. */
  release(runId: string): void;
  /** Sessions with an open permission ask: full ids known to this process, plus the 8-character prefixes of asks found on disk. */
  open(): Promise<Set<string>>;
}

const KEY_PREFIX = 'perm-';
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40) || 'x';
export const permKey = (sessionId: string, requestId: string): string => `${KEY_PREFIX}${safe(sessionId.slice(0, 8))}-${safe(requestId)}`;
const DENIED = 'Denied by the owner';

export function createPermissionBroker(ctx: LifecycleContext, o: BrokerOptions = {}): PermissionBroker {
  const pollMs = o.pollMs ?? 1000;
  const timeoutMs = o.timeoutMs ?? 10 * 60_000;
  const now = () => (ctx.now ?? (() => new Date()))();
  const allowed = new Map<string, Set<string>>();
  const pending = new Map<string, { runId: string; sessionId: string; resolve: (a: PermissionAnswer) => void; settled: boolean }>();

  const read = async (key: string): Promise<Ask | null> => {
    try { return parseAsk(key, (await ctx.storage.read(asksPath(key))).content); } catch (e) { if (e instanceof NotFoundError) return null; throw e; }
  };
  const close = async (key: string, outcome: 'handled' | 'resolved' | 'defaulted', note?: string) => { try { await handleAsk(ctx, key, { outcome, note }, 'stack'); } catch { /* the ask may be gone; the answer still stands */ } };
  const settle = (key: string, a: PermissionAnswer) => { const p = pending.get(key); if (!p || p.settled) return; p.settled = true; pending.delete(key); p.resolve(a); };

  async function ask(session: BrokerSession, req: PermissionRequest, runId: string): Promise<PermissionAnswer> {
    if (allowed.get(runId)?.has(req.tool)) return { optionId: 'allow' };
    const key = permKey(session.id, req.requestId);
    const by = new Date(now().getTime() + timeoutMs);
    const why = oneLine(redact(JSON.stringify(req.input))).slice(0, 200);
    const detail = redact(JSON.stringify(req.input, null, 2)).slice(0, 4000);
    await putAsk(ctx, key, {
      ask: req.title.slice(0, 200), kind: 'decide', from: `session:${session.title}`.slice(0, 80), project: projectOf(session.cwd) || undefined,
      why, options: req.options.map((x) => x.name), recommend: req.risky ? 'Deny' : req.options[0]?.name ?? 'Allow once',
      default: 'Denied; the agent continues without it', reversible: true, by: by.toISOString(), priority: 'high', effort: '1m', detail,
    }, 'stack');
    const byOption = (name: string) => req.options.find((x) => x.name === name);
    return new Promise<PermissionAnswer>((resolve) => {
      pending.set(key, { runId, sessionId: session.id, resolve, settled: false });
      const tick = async () => {
        const p = pending.get(key);
        if (!p || p.settled) return;
        try {
          const a = await read(key);
          if (a?.state === 'answered') {
            let out: PermissionAnswer = { optionId: 'deny', message: DENIED };
            let note = 'Deny';
            if (a.answer === 'option' && a.text) {
              const opt = byOption(a.text);
              if (opt) { out = { optionId: opt.optionId }; if (opt.kind === 'allow_always') (allowed.get(runId) ?? allowed.set(runId, new Set()).get(runId)!).add(req.tool); }
              note = a.text;
            } else if ((a.answer === 'reply' || a.answer === 'ask') && a.text) { out = { optionId: 'deny', message: a.text }; note = `Deny: ${a.text}`.slice(0, 500); }
            else if (a.answer === 'go') { out = { optionId: req.options[0]?.optionId ?? 'allow' }; note = req.options[0]?.name ?? 'Allow once'; }
            await close(key, 'handled', note);
            settle(key, out);
            return;
          }
          if (a && a.state === 'done') { settle(key, { optionId: 'deny', message: DENIED }); return; }
          if (now().getTime() >= by.getTime()) {
            await close(key, 'defaulted', 'No answer');
            settle(key, { optionId: 'deny', message: `No answer in ${Math.round(timeoutMs / 60_000)} minutes` });
            return;
          }
        } catch { /* a transient read error: try again next tick */ }
        setTimeout(() => void tick(), pollMs).unref?.();
      };
      setTimeout(() => void tick(), pollMs).unref?.();
    });
  }

  function release(runId: string): void {
    allowed.delete(runId);
    for (const [key, p] of [...pending]) {
      if (p.runId !== runId) continue;
      settle(key, { optionId: 'deny', message: 'Run cancelled' });
      void close(key, 'resolved', 'Run cancelled');
    }
  }

  async function open(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const p of pending.values()) if (!p.settled) out.add(p.sessionId);
    try {
      const t = now().getTime();
      for (const a of (await listAsks(ctx)).items) {
        const m = /^perm-([a-z0-9]{1,8})-/.exec(a.key);
        if (!m) continue;
        // An ask from a run this process does not know (a previous process) is defaulted at its deadline, like any other.
        if (!pending.has(a.key) && a.by && Date.parse(a.by) <= t) { await close(a.key, 'defaulted', 'No answer; the run that asked is gone'); continue; }
        if (![...out].some((id) => id.startsWith(m[1]))) out.add(m[1]);
      }
    } catch { /* storage hiccup: in-memory pending is still right */ }
    return out;
  }

  return { ask, release, open };
}
