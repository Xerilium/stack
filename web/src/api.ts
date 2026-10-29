import type { AskList, Send } from './asks';
import type { ActionName, Agent, CaptureResult, InboxItem, Mutation, NextTask, Position, Project, SetProps, Task } from './types';

/** @req FR:web-app/api.client */
export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const TASK_FIELDS = 'ref,text,project,section,done,depth,notes';

/** Where the page expected Stack: the api origin, else this page's host. @req FR:web-shell/state.unreachable */
export function unreachable(base = '/api'): string {
  let host = '';
  try { host = new URL(base, typeof location === 'undefined' ? 'http://localhost' : location.href).host; } catch { /* keep the fallback */ }
  return `Can't reach Stack${host ? ` at ${host}` : ''}. Is stack web still running?`;
}

/** `onRead` hears each read: the time the service worker saved it when it came from the offline cache, else null. @req FR:pwa/offline.banner */
export function createClient(fetchFn: typeof fetch = (...a) => fetch(...a), base = '/api', onRead?: (savedAt: string | null) => void) {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    if (body !== undefined && typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiFailure(0, 'offline', 'Offline: changes need a connection');
    const init: RequestInit = body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' };
    let res: Response;
    try { res = await fetchFn(`${base}${path}`, init); } catch { throw new ApiFailure(0, 'network', unreachable(base)); }
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiFailure(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`);
    }
    if (body === undefined) onRead?.(res.headers?.get?.('x-stack-cache') === 'offline' ? res.headers.get('x-stack-saved-at') ?? '' : null);
    return data as T;
  }
  return {
    next: async () => (await call<{ task: NextTask | null }>('/next')).task,
    async tasks(): Promise<Task[]> {
      const all: Task[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await call<{ items: Task[]; total: number }>(`/tasks?state=all&limit=200&offset=${offset}&fields=${TASK_FIELDS}`);
        all.push(...page.items);
        if (page.items.length === 0 || all.length >= page.total) return all;
      }
    },
    projects: async () => (await call<{ items: Project[] }>('/projects?fields=name,title,open,done,metadata')).items,
    action: (name: ActionName, ref?: string, extra: Record<string, unknown> = {}) => call<Mutation>(`/tasks/${name}`, { ...(ref ? { ref } : {}), ...extra }),
    set: (ref: string, props: SetProps) => call<Mutation>('/tasks/set', { ref, ...props }),
    edit: (ref: string, text: string, expect?: string) => call<Mutation>('/tasks/edit', { ref, text, ...(expect !== undefined ? { expect } : {}) }),
    move: (ref: string, target: string, position: Position, expect?: { ref?: string; target?: string }) =>
      call<Mutation>('/tasks/move', { ref, target, position, ...(expect?.ref !== undefined ? { expect: expect.ref } : {}), ...(expect?.target !== undefined ? { expectTarget: expect.target } : {}) }),
    add: (project: string, text: string, parent?: string) => call<Mutation>('/tasks', { project, text, ...(parent ? { parent } : {}) }),
    agents: async () => (await call<{ items: Agent[] }>('/agents')).items,
    inbox: async () => (await call<{ items: InboxItem[] }>('/inbox')).items,
    send: (ref: string, text: string, kind: 'reply' | 'decision', expect?: string) => call<{ id: string; path: string }>('/inbox', { ref, text, kind, ...(expect !== undefined ? { expect } : {}) }),
    asks: (state: 'open' | 'answered' | 'snoozed' = 'open') => call<AskList>(`/asks?state=${state}&limit=200`),
    answerAsk: (key: string, body: Send) => call<{ changed: boolean }>(`/asks/${encodeURIComponent(key)}/answer`, body),
    capture: (text: string, o: { project?: string; section?: string; dryRun?: boolean } = {}) => call<CaptureResult>('/capture', { text, ...o }),
  };
}
export type Client = ReturnType<typeof createClient>;
