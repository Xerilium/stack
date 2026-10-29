import type { AskList, Send } from './asks';
import type { CostReport, SessionList, Turn } from './sessions';
import type { ActionName, Agent, CaptureResult, InboxItem, Mutation, NextTask, Position, Project, SetProps, Task } from './types';

/** @req FR:web-app/api.client */
export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const TASK_FIELDS = 'ref,text,project,section,done,depth,notes';

const await0 = async <T,>(p: Promise<{ items: T[] }>) => (await p).items;

export function createClient(fetchFn: typeof fetch = (...a) => fetch(...a), base = '/api') {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit = body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' };
    let res: Response;
    try { res = await fetchFn(`${base}${path}`, init); } catch { throw new ApiFailure(0, 'network', 'Network error'); }
    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiFailure(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`);
    }
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
    sessions: () => call<SessionList>('/sessions?limit=200'),
    sessionCost: (days = 7) => call<CostReport>(`/sessions/cost?days=${days}`),
    sessionMessages: (id: string) => (await0(call<{ items: Turn[] }>(`/sessions/${encodeURIComponent(id)}/messages?limit=60`))),
    promptSession: (id: string, text: string) => call<{ runId: string; sessionId: string | null }>(`/sessions/${encodeURIComponent(id)}/prompt`, { text }),
    newSession: (cwd: string, text: string) => call<{ runId: string; sessionId: string | null }>('/sessions', { cwd, text }),
    cancelSession: (id: string) => call<{ changed: boolean }>(`/sessions/${encodeURIComponent(id)}/cancel`, {}),
    capture: (text: string, o: { project?: string; section?: string; dryRun?: boolean } = {}) => call<CaptureResult>('/capture', { text, ...o }),
  };
}
export type Client = ReturnType<typeof createClient>;
