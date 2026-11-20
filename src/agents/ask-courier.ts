/**
 * The ask courier: carries each turn of an ask thread to the agent's session and wakes it, so the owner never relays and the agent never polls.
 * It resumes the session through the agent runs (the path the dashboard uses) and writes only through the ask core.
 * @req FR:ask-routing/deliver.pick @req FR:ask-routing/deliver.find @req FR:ask-routing/deliver.busy @req FR:ask-routing/deliver.wake
 * @req FR:ask-routing/deliver.prompt @req FR:ask-routing/deliver.fallback @req FR:ask-routing/deliver.loop @req FR:ask-routing/deliver.once
 */
import { listAsks, markDelivery, OWNER, readAsk, replyAsk, askTurn, oneLine, type Ask, type ListedAsk } from '../core/asks';
import { parseAgentLink } from '../core/goal-model';
import type { LifecycleContext } from '../core/lifecycle';
import type { AgentRuns } from './runs';
import { PERMISSION_MODES, SessionBusy, type RunPermissionMode } from './driver';

/** A session the courier can find: the inventory id (`local_…`), its Claude Code id, and its state. */
export interface CourierSession { id: string; cli?: string; state?: string; reason?: string; /** The app's permission mode. */ mode?: string }
export interface CourierDeps {
  ctx: LifecycleContext;
  runs: Pick<AgentRuns, 'prompt' | 'subscribe' | 'running'> & Partial<Pick<AgentRuns, 'sessions'>>;
  /** The local session list (the session inventory). */
  inventory: () => { sessions: CourierSession[] };
  /** Called when a delivered owner question's run ends: `posted` says whether its final text became the reply. */
  onFallback?: (key: string, posted: boolean) => void;
}
export type CourierResult = 'delivered' | 'busy' | 'gone' | 'failed';

/** Inventory reasons that mean a dialog is open in the app (`FR:session-inventory/state.waiting`). */
const OPEN_DIALOG = new Set(['question', 'permission']);
/** The session's own mode, never a raised one: an unknown mode runs as `default`. @req FR:ask-routing/deliver.mode */
const modeOf = (s: CourierSession): RunPermissionMode => ((PERMISSION_MODES as readonly string[]).includes(s.mode ?? '') ? s.mode as RunPermissionMode : 'default');
/** The commands that close the loop run without a permission ask; every other tool asks as on the dashboard. @req FR:ask-routing/deliver.wake */
const CLOSE_TOOLS = ['Bash(stack asks handle:*)', 'Bash(stack asks reply:*)'];
const WORD: Record<string, string> = { go: 'Approved', no: 'Rejected', option: 'Chose', reply: 'Replied', ask: 'Asked', done: 'Done' };
const threadTail = (a: Pick<Ask, 'thread'>) => a.thread.slice(-5).map((l) => l.replace(/^- \S+ /, '')).join(' | ');

/** The fixed text that wakes the agent. @req FR:ask-routing/deliver.prompt */
export function deliveryPrompt(a: Pick<Ask, 'key' | 'ask' | 'from' | 'state' | 'thread' | 'answer' | 'text'>): string {
  if (a.from === OWNER) {
    const tail = threadTail(a);
    return `Stack: the owner asks you (${a.key}): "${a.ask}"${tail ? ` Thread: "${tail}"` : ''}. Answer in one reply: stack asks reply ${a.key} --text "…". Never answer in chat.`;
  }
  const word = WORD[a.answer ?? ''] ?? 'Answered';
  return `Stack: the owner answered your ask ${a.key} ("${a.ask}"): ${word}${a.text ? `: "${a.text}"` : ''}. Act on it now, then run: stack asks handle ${a.key} --outcome handled --note "<what you did>". To ask back: stack asks reply ${a.key} --text "…". Never ask in chat.`;
}

/** The Claude Code id that resumes the linked session, or null when it is not on this machine. @req FR:ask-routing/deliver.find */
function findSession(linkId: string, sessions: CourierSession[]): CourierSession | null {
  const bare = linkId.replace(/^local_/, '');
  return sessions.find((s) => s.id === linkId) ?? sessions.find((s) => s.cli === bare) ?? null;
}

/** One delivery of one ask; the claim is taken first, so two couriers never both prompt. */
async function deliver(d: CourierDeps, a: ListedAsk, sessions: CourierSession[]): Promise<CourierResult | null> {
  const link = parseAgentLink(a.agent);
  if (!link) return null;
  const s = findSession(link.id, sessions);
  const cli = s?.cli ?? '';
  // @req FR:ask-routing/deliver.busy: never write to a session another client is writing or that shows an open dialog; a busy check writes nothing.
  if (s && (s.state === 'running' || OPEN_DIALOG.has(s.reason ?? '') || (cli && d.runs.running(cli)))) return 'busy';
  if (!(await markDelivery(d.ctx, a.key, { claim: true }))) return null;
  if (!s) { await markDelivery(d.ctx, a.key, { failed: 'Session gone' }); return 'gone'; }
  // A desktop id is not a Claude Code id: without the inventory's `cli` there is nothing to resume.
  if (!cli) { await markDelivery(d.ctx, a.key, { failed: 'Session has no Claude Code id' }); return 'failed'; }
  const full = (await readAsk(d.ctx, a.key))?.ask;
  if (!full) return null;
  let runId: string;
  try { ({ runId } = await d.runs.prompt({ sessionId: cli, text: deliveryPrompt(full), options: { allowedTools: CLOSE_TOOLS, permissionMode: modeOf(s) } })); }
  catch (e) {
    if (e instanceof SessionBusy) { await markDelivery(d.ctx, a.key, { release: true }); return 'busy'; }
    await markDelivery(d.ctx, a.key, { failed: e instanceof Error && e.message ? e.message : 'failed' });
    return 'failed';
  }
  await markDelivery(d.ctx, a.key, { sent: link.name });
  if (full.from === OWNER && full.delivered) fallback(d, a.key, runId, link.name, full.delivered);
  return 'delivered';
}

/** An owner question the agent did not answer with `stack asks reply` gets the run's final text as the reply. @req FR:ask-routing/deliver.fallback */
function fallback(d: CourierDeps, key: string, runId: string, name: string, claim: string): void {
  let stop: (() => void) | null = null;
  stop = d.runs.subscribe(runId, (u) => {
    if (u.type !== 'done') return;
    stop?.();
    const text = oneLine(u.text ?? '').slice(0, 1000);
    void (async () => {
      const cur = text ? (await readAsk(d.ctx, key))?.ask : undefined;
      // the same turn only: a follow-up during the run is a new turn, delivered on its own
      if (!cur || askTurn(cur) !== 'agent' || cur.delivered !== claim) return false;
      await replyAsk(d.ctx, key, { text }, name);
      return true;
    })().then((posted) => d.onFallback?.(key, posted), () => d.onFallback?.(key, false));
  }, () => undefined);
}

/** One pass over every ask whose turn is the agent's. */
export async function courierPass(d: CourierDeps): Promise<{ key: string; result: CourierResult }[]> {
  const due = (await listAsks(d.ctx, { state: 'all', turn: 'agent', limit: 200 })).items.filter((a) => a.agent && !a.delivered && !a.undelivered);
  if (!due.length) return [];
  let sessions: CourierSession[];
  try { sessions = d.inventory().sessions; } catch { return []; } // no session list: try again next pass, never mark gone
  // A terminal session is not in the app store; the agent runs list every transcript (as the lead restart does). Read only when needed.
  const missing = due.some((a) => { const l = parseAgentLink(a.agent); return l && !findSession(l.id, sessions); });
  if (missing && d.runs.sessions) {
    try {
      const more = (await d.runs.sessions({ limit: 1000 })).items;
      sessions = [...sessions, ...more.map((s) => ({ id: s.id, cli: s.id, state: s.state === 'running' || s.state === 'active' ? 'running' : 'idle' }))];
    } catch { return []; }
  }
  const out: { key: string; result: CourierResult }[] = [];
  for (const a of due) {
    const r = await deliver(d, a, sessions);
    if (r) out.push({ key: a.key, result: r });
  }
  return out;
}

/** The host loop: a pass at start, then every `intervalMs` (default 15 s); passes never overlap. @req FR:ask-routing/deliver.loop */
export function startAskCourier(d: CourierDeps, o: { intervalMs?: number; onError?: (e: unknown) => void } = {}): { kick(): void; close(): Promise<void> } {
  let running: Promise<void> | null = null;
  let closed = false;
  const pass = (): void => {
    if (closed || running) return;
    running = courierPass(d).then(() => undefined, (e) => { o.onError?.(e); }).finally(() => { running = null; });
  };
  const timer = setInterval(pass, o.intervalMs ?? 15_000);
  timer.unref?.();
  pass();
  return { kick: pass, async close() { closed = true; clearInterval(timer); while (running) await running; } };
}
