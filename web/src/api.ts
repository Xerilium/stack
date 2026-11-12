import type { CalEvent } from './meetings';
import type { DaySched } from './schedule';
import type { Rule } from './weekly';
import type { AskList, Send } from './asks';
import type { CostReport, SessionList, Turn } from './sessions';
import type { RankItem } from './home';
import type { NeedItem } from './needs';
import type { Pri, PrisFile } from './pris';
import type { Inventory } from './inventory';
import type { PrBoard } from './prs';
import type { ReviewItem, TeamAgent } from './team';
import type { Thread } from './thread';
import type { ActionName, Agent, CaptureResult, InboxItem, Mutation, NextTask, Position, Project, SetProps, Task } from './types';

/** @req FR:web-app/api.client */
export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { field: string; message: string }[]) { super(message); }
}

const TASK_FIELDS = 'ref,text,project,section,done,depth,notes';

const await0 = async <T,>(p: Promise<{ items: T[] }>) => (await p).items;

/** @req FR:web-shell/state.unreachable — where the page expected Stack: the api origin, else this page's host. */
export function unreachable(base = '/api'): string {
  let host = '';
  try { host = new URL(base, typeof location === 'undefined' ? 'http://localhost' : location.href).host; } catch { /* keep the fallback */ }
  return `Can't reach Stack${host ? ` at ${host}` : ''}. Is stack web still running?`;
}

/** `onRead` hears each read: the time the service worker saved it when it came from the offline cache, else null. @req FR:pwa/offline.banner */
export function createClient(fetchFn: typeof fetch = (...a) => fetch(...a), base = '/api', onRead?: (savedAt: string | null) => void) {
  async function call<T>(path: string, body?: unknown, extra: RequestInit = {}): Promise<T> {
    if (body !== undefined && typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiFailure(0, 'offline', 'Offline: changes need a connection');
    const init: RequestInit = body === undefined
      ? { credentials: 'same-origin', ...extra }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', ...extra };
    let res: Response;
    try { res = await fetchFn(`${base}${path}`, init); } catch { throw new ApiFailure(0, 'network', unreachable(base)); }
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } } | undefined)?.error;
      throw new ApiFailure(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`, Array.isArray(e?.details) ? e.details : undefined);
    }
    if (body === undefined) onRead?.(res.headers?.get?.('x-stack-cache') === 'offline' ? res.headers.get('x-stack-saved-at') ?? '' : null);
    return data as T;
  }
  return {
    next: async () => (await call<{ task: NextTask | null }>('/next')).task,
    /** The one ranking (engine order plus the owner's overrides); Home draws only this. @req FR:api/routes.rank */
    rank: async (limit = 100, blocks: 'now' | 'any' = 'now') => (await call<{ items: RankItem[] }>(`/rank?limit=${limit}${blocks === 'any' ? '&blocks=any' : ''}`)).items,
    /** Owner feedback to ~/.stack/feedback.jsonl. @req FR:feedback-button/api.route */
    feedback: (b: FeedbackBody) => call<{ id: string; at: string; screenshot: boolean }>('/feedback', b),
    /** The owner's priorities. @req FR:pris-sessions-ui/pris.block */
    pris: () => call<PrisFile>('/pris'),
    /** Replaces the priorities when `rev` is current; 409 when not. @req FR:pris-sessions-ui/pris.save */
    putPris: (rev: number, pris: Pri[]) => call<PrisFile>('/pris', { rev, pris }),
    /** The Claude app session inventory. @req FR:pris-sessions-ui/sessions.list */
    inventory: () => call<Inventory>('/session-inventory'),
    /** The PR board; 404 where the host has no GitHub token. @req FR:pr-page/api.get */
    prs: () => call<PrBoard>('/prs'),
    /** @req FR:pr-page/api.queue */
    prQueue: (repo: string, number: number, op: 'top' | 'up' | 'down' | 'move' | 'add' | 'pin' | 'unpin' | 'remove' | 'undo', rank?: number) => call<{ rank: number | null; was: number | null; pinned: boolean }>('/prs/queue', { repo, number, op, ...(rank ? { rank } : {}) }),
    /** @req FR:pr-page/api.label */
    prLabel: (repo: string, number: number, op: 'add' | 'remove') => call<{ ok: true }>('/prs/label', { repo, number, op }),
    /** @req FR:pr-page/api.ack */
    prAck: (b: { repo: string; number: number; thread: string; note: string; post?: boolean; text?: string; replyTo?: number }) => call<{ ok: true; posted: boolean; recorded: boolean; message?: string }>('/prs/ack', b),
    /** @req FR:pr-page/api.rec */
    prRec: (id: string, b: { decision: 'accept' | 'edit' | 'reject'; rank?: number; note?: string; reason?: string }) => call<{ ok: true }>(`/prs/recs/${encodeURIComponent(id)}`, b),
    /** The Chief of Staff's escalations. @req FR:ask-queue/needs.api */
    needs: async () => (await call<{ items: NeedItem[] }>('/needs-you')).items,
    answerNeed: (id: string, body: { choice: 'go' | 'defer' | 'reply' | 'undo'; text?: string; until?: string }) => call<{ changed: boolean }>(`/needs-you/${encodeURIComponent(id)}/answer`, body),
    /** Accept or reject a PR priority recommendation on its `decide` path (`/api/...`). @req FR:pr-priority/needs.actions */
    decideRec: (decide: string, body: { decision: 'accept' } | { decision: 'reject'; reason: string }) => call<unknown>(decide.replace(/^\/api(?=\/)/, ''), body),
    async tasks(): Promise<Task[]> {
      // @req FR:perf/client.pages — the first page gives the total; the rest go out together.
      const page = (offset: number) => call<{ items: Task[]; total: number }>(`/tasks?state=all&limit=200&offset=${offset}&fields=${TASK_FIELDS}`);
      const first = await page(0);
      if (first.items.length === 0 || first.items.length >= first.total) return first.items;
      const rest = await Promise.all(Array.from({ length: Math.ceil((first.total - 200) / 200) }, (_, i) => page(200 * (i + 1))));
      return [...first.items, ...rest.flatMap((r) => r.items)];
    },
    projects: async () => (await call<{ items: Project[] }>('/projects?fields=name,title,open,done,metadata')).items,
    action: (name: ActionName, ref?: string, extra: Record<string, unknown> = {}) => call<Mutation>(`/tasks/${name}`, { ...(ref ? { ref } : {}), ...extra }),
    set: (ref: string, props: SetProps) => call<Mutation>('/tasks/set', { ref, ...props }),
    edit: (ref: string, text: string, expect?: string) => call<Mutation>('/tasks/edit', { ref, text, ...(expect !== undefined ? { expect } : {}) }),
    move: (ref: string, target: string, position: Position, expect?: { ref?: string; target?: string }) =>
      call<Mutation>('/tasks/move', { ref, target, position, ...(expect?.ref !== undefined ? { expect: expect.ref } : {}), ...(expect?.target !== undefined ? { expectTarget: expect.target } : {}) }),
    add: (project: string, text: string, parent?: string) => call<Mutation>('/tasks', { project, text, ...(parent ? { parent } : {}) }),
    schedule: (at: string) => call<DaySched | null>(`/schedule?at=${encodeURIComponent(at)}`),
    scheduleDay: (body: { date: string; wake?: string; bed?: string; every?: boolean; reset?: boolean }) => call<DaySched>('/schedule/day', body),
    meetings: async () => (await call<{ items: Rule[] }>('/meetings')).items,
    calendar: (from: string, to: string) => call<{ configured: boolean; items: CalEvent[]; error?: string; source?: unknown }>(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    agents: async () => (await call<{ items: Agent[] }>('/agents')).items,
    inbox: async () => (await call<{ items: InboxItem[] }>('/inbox')).items,
    send: (ref: string, text: string, kind: 'reply' | 'decision' | 'instruction', expect?: string) => call<{ id: string; path: string }>('/inbox', { ref, text, kind, ...(expect !== undefined ? { expect } : {}) }),
    /** @req FR:agent-inbox/api.handle */
    handled: (id: string, note?: string, withdrawn?: boolean) => call<{ changed: boolean }>('/inbox/handled', { id, ...(note ? { note } : {}), ...(withdrawn ? { withdrawn } : {}) }),
    asks: (state: 'open' | 'answered' | 'snoozed' = 'open') => call<AskList>(`/asks?state=${state}&limit=200`),
    answerAsk: (key: string, body: Send) => call<{ changed: boolean }>(`/asks/${encodeURIComponent(key)}/answer`, body),
    /** The Inbox page: all mail, unread Teams and Slack. @req FR:inbox-page/api.read */
    inboxItems: () => call<{ items: import('./inbox').InboxRow[]; actions: import('./inbox').ActionInfo[] } & Partial<import('./inbox').SourcesReply>>('/inbox-items'),
    /** Each inbox source and the summary; `fresh` asks a local host to probe again. @req FR:inbox-page/api.sources */
    inboxSources: (fresh = false) => call<import('./inbox').SourcesReply>(`/inbox-sources${fresh ? '?fresh=1' : ''}`),
    /** Runs one action; never sends. @req FR:inbox-page/api.act */
    inboxAct: (id: string, body: { action: string; text?: string; until?: string; request?: boolean }) => call<import('./inbox').ActResult>(`/inbox-items/${encodeURIComponent(id)}/action`, body),
    sessions: () => call<SessionList>('/sessions?limit=200'),
    sessionCost: (days = 7) => call<CostReport>(`/sessions/cost?days=${days}`),
    sessionMessages: (id: string) => (await0(call<{ items: Turn[] }>(`/sessions/${encodeURIComponent(id)}/messages?limit=60`))),
    promptSession: (id: string, text: string, extra: { ref?: string; agent?: string } = {}) => call<{ runId: string; sessionId: string | null }>(`/sessions/${encodeURIComponent(id)}/prompt`, { text, ...extra }),
    newSession: (cwd: string | undefined, text: string, extra: { agent?: string; ref?: string; project?: string } = {}) => call<{ runId: string; sessionId: string | null; agent?: string; title?: string }>('/sessions', { ...(cwd ? { cwd } : {}), text, ...extra }),
    /** @req FR:agent-team/review.api */
    team: async () => (await call<{ items: TeamAgent[] }>('/team')).items,
    reviews: async (project: string) => (await call<{ items: ReviewItem[] }>(`/reviews?project=${encodeURIComponent(project)}`)).items,
    /** @req FR:agent-thread/thread.read @req FR:agent-thread/thread.assign */
    thread: (ref: string) => call<Thread>(`/tasks/${encodeURIComponent(ref)}/thread`),
    assign: (ref: string, agent?: string) => call<{ runId: string; sessionId: string | null; agent: string; title: string; claimed: boolean }>(`/tasks/${encodeURIComponent(ref)}/assign`, { ...(agent ? { agent } : {}) }),
    review: (ref: string, agent?: string) => call<{ runId: string; sessionId: string | null; agent: string }>('/tasks/review', { ref, ...(agent ? { agent } : {}) }),
    cancelSession: (id: string) => call<{ changed: boolean }>(`/sessions/${encodeURIComponent(id)}/cancel`, {}),
    /** Repo revision for change-driven polling (null: the host has none). @req FR:live-deploy/web.poll */
    /** The change token: the revision plus `live` (state outside the repo) when the host sends it; null stays null (reload every probe). @req FR:pr-priority/needs.poll */
    sync: async () => { const s = await call<SyncState>('/sync'); return s.rev !== null && s.live ? `${s.rev}~${s.live}` : s.rev; },
    /** Revision plus what a batching server has not committed yet. @req FR:live-deploy/web.unsaved @req FR:live-deploy/$sync-state */
    syncState: () => call<SyncState>('/sync'),
    /** Commit and push pending edits now; `keepalive` when the page is going away. @req FR:live-deploy/web.unsaved.hide @req FR:live-deploy/$flush-result */
    flush: (keepalive = false) => call<FlushResult>('/sync', {}, keepalive ? { keepalive: true } : {}),
    capture: (text: string, o: { project?: string; section?: string; dryRun?: boolean } = {}) => call<CaptureResult>('/capture', { text, ...o }),
  };
}
export type Client = ReturnType<typeof createClient>;

/** `GET /api/sync`: `pending`/`since` only when the server batches commits. */
export interface SyncState { rev: string | null; pending?: number; since?: string | null; live?: string }
/** `POST /api/sync`. */
export interface FlushResult { flushed: number; rev: string | null }

/** The body of `POST /feedback`. @req FR:feedback-button/api.route */
export interface FeedbackBody { text: string; route?: string; viewport?: string; theme?: 'light' | 'dark'; capture?: boolean; png?: string }
