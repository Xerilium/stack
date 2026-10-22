/**
 * Client over the API handler, in process. No real network is used.
 * @req FR:chat-bots/cmd.client
 */
import type { Client, ClientResult } from './commands';

export class BotApiError extends Error {
  constructor(readonly status: number) { super(`api ${status}`); }
}

export function apiClient(handler: (req: Request) => Promise<Response>, headers: Record<string, string> = {}, basePath = '/api'): Client {
  const call = async (method: 'GET' | 'POST', path: string, body?: object): Promise<Record<string, unknown>> => {
    const res = await handler(new Request(`https://bots.invalid${basePath}${path}`, {
      method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }));
    if (!res.ok) { await res.text(); throw new BotApiError(res.status); }
    return (await res.json()) as Record<string, unknown>;
  };
  const act = async (path: string, body: object): Promise<ClientResult> => {
    const r = await call('POST', path, body);
    return { ref: typeof r.ref === 'string' ? r.ref : undefined, changed: typeof r.changed === 'boolean' ? r.changed : undefined };
  };
  return {
    async next() {
      const t = (await call('GET', '/next')).task as { ref: string; text: string; project: string } | null;
      return t ?? null;
    },
    add: (project, text) => act('/tasks', { project, text }),
    start: (ref) => act('/tasks/start', ref ? { ref } : {}),
    complete: (ref, summary) => act('/tasks/complete', { ...(ref ? { ref } : {}), ...(summary ? { summary } : {}) }),
    skip: (ref) => act('/tasks/skip', ref ? { ref } : {}),
  };
}
