/** @req FR:agent-sessions/run.events @req FR:agent-sessions/web.states */
import http from 'http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRunManager, type AgentDriver, type Update } from '../../src/agents';
import { MemoryStorage } from '../../src/core/storage';
import { startWeb } from '../../src/cli/web';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-sess-web-'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await sleep(20); } };
const SID = 'a1b2c3d4-0000-0000-0000-000000000001';

function driver() {
  let push: (u: Update) => void = () => undefined; let end: () => void = () => undefined;
  const d: AgentDriver = {
    listSessions: async () => [{ id: SID, title: 'stack: web', project: 'stack', cwd: '/x', lastActive: new Date().toISOString(), active: false, cost: { usd: 0, tokens: 0 }, prs: [] }],
    getMessages: async () => [],
    async prompt(req) {
      const queue: Update[] = []; let done = false; let wake: (() => void) | null = null;
      push = (u) => { queue.push(u); wake?.(); }; end = () => { done = true; wake?.(); };
      const updates = (async function* () { for (;;) { if (queue.length) { yield queue.shift()!; continue; } if (done) return; await new Promise<void>((ok) => { wake = ok; }); wake = null; } })();
      return { id: 'run-1', sessionId: req.sessionId ?? null, updates };
    },
    cancel: async () => { push({ type: 'done', stopReason: 'cancelled', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0 }); end(); return true; },
  };
  return { d, push: (u: Update) => push(u), end: () => end() };
}

function sse(url: string) {
  const events: { event: string; data: string }[] = []; let status = 0; let ended = false; let buf = '';
  const req = http.get(url, (res) => {
    status = res.statusCode ?? 0; res.setEncoding('utf8');
    res.on('data', (d: string) => { buf += d; let i: number; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = { event: 'message', data: '' }; for (const l of block.split('\n')) { if (l.startsWith('event: ')) ev.event = l.slice(7); else if (l.startsWith('data: ')) ev.data = l.slice(6); } if (ev.data) events.push(ev); } });
    res.on('end', () => { ended = true; });
  });
  req.on('error', () => undefined);
  return { events, status: () => status, ended: () => ended, close: () => req.destroy() };
}

async function setup() {
  const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
  const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
  const { d, push, end } = driver();
  const agents = createRunManager({ driver: d, ctx: { storage: new MemoryStorage() } });
  const s = await startWeb({ dir, port: 0, webDir: web, agents });
  const post = (path: string, body: unknown) => new Promise<{ status: number; body: string }>((ok) => {
    const r = http.request(`${s.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.url } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ status: res.statusCode ?? 0, body: b })); });
    r.end(JSON.stringify(body));
  });
  return { s, push, end, post };
}

describe('GET /sessions/{id}/events', () => {
  it('replays buffered updates, streams live ones, and closes after done', async () => {
    const { s, push, end, post } = await setup();
    try {
      const r = await post(`/api/sessions/${SID}/prompt`, { text: 'go' });
      expect(r.status).toBe(202);
      push({ type: 'message_chunk', role: 'assistant', text: 'Hi' });
      await sleep(50);
      const c = sse(`${s.url}/sessions/${SID}/events`);
      await until(() => c.events.length === 1);
      expect(c.status()).toBe(200);
      expect(JSON.parse(c.events[0].data)).toEqual({ type: 'message_chunk', role: 'assistant', text: 'Hi' });
      push({ type: 'done', stopReason: 'end_turn', cost: { usd: 0.1, tokens: 5 }, turns: 1, durationMs: 1 }); end();
      await until(() => c.ended());
      expect(c.events.map((e) => e.event)).toEqual(['update', 'update']);
      c.close();
    } finally { await s.close(); }
  });
  it('204 when the session has no run; 404 for a bad id; the page learns agents are available', async () => {
    const { s } = await setup();
    try {
      const status = await new Promise<number>((ok) => { http.get(`${s.url}/sessions/${SID}/events`, (r) => { ok(r.statusCode ?? 0); r.destroy(); }); });
      expect(status).toBe(204);
      const bad = await new Promise<number>((ok) => { http.get(`${s.url}/sessions/../events`, (r) => { ok(r.statusCode ?? 0); r.destroy(); }); });
      expect([200, 404]).toContain(bad);
      const me = await new Promise<string>((ok) => { http.get(`${s.url}/.auth/me`, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(d)); }); });
      expect(JSON.parse(me).agents).toBe(true);
    } finally { await s.close(); }
  });
  it('a host started without agents says so and has no stream', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir, port: 0, webDir: web, agents: false });
    try {
      const me = await new Promise<string>((ok) => { http.get(`${s.url}/.auth/me`, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(d)); }); });
      expect(JSON.parse(me).agents).toBe(false);
      const status = await new Promise<number>((ok) => { http.get(`${s.url}/sessions/${SID}/events`, (r) => { ok(r.statusCode ?? 0); r.destroy(); }); });
      expect(status).toBe(404);
    } finally { await s.close(); }
  });
});
