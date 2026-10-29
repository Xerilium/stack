import type { Page, Route } from '@playwright/test';

export interface MockTask { ref: string; text: string; project: string; section: string; done: boolean; depth: number; notes: string[] }
export interface MockAgent { ref: string; project: string; title: string; text: string; state: string; prs: { url: string; repo: string; number: number; state?: string; checks?: string; title?: string; updatedAt?: string }[]; last?: { at: string; action: string; outcome?: string; summary?: string }; waitingOn?: string; replies: number; since?: string }
export interface MockInbox { id: string; at: string; project: string; ref: string; task: string; kind: string; to: string; text: string; state: string; row?: string; from?: 'owner' | 'agent'; agent?: string }
export interface MockAsk { key: string; state: string; ask: string; kind: string; from: string; ref?: string; row?: string; task?: string; project?: string; why?: string; recommend?: string; options?: string[]; default?: string; by?: string; reversible: boolean; link?: string; priority: string; blocks: number; created: string; updated: string; answer?: string; text?: string; answered?: string; snoozedUntil?: string; detail?: string; score: number; rank?: number; overdue: boolean; agentReply?: string }
export interface MockSession { id: string; title: string; project: string; cwd: string; branch?: string; lastActive: string; state: string; cost: { usd: number; tokens: number }; prs: string[] }
export interface MockEvent { id: string; subject: string; start: string; end: string; allDay: boolean; showAs: string; cancelled: boolean; online: boolean; webLink?: string; joinUrl?: string; organizer?: string }
export interface MockTeamAgent { slug: string; name: string; role?: string; scope: string[]; model?: string; mode: string; prompt: string; defined: boolean; projects: string[] }
export interface MockReview { ref: string; at: string; verdict: string; plan: string; estimate?: string; agent: string; needs: string[] }
export interface Mock { team: MockTeamAgent[]; reviews: MockReview[]; schedule: unknown | null; events: MockEvent[] | null; calendarFail: boolean; sessions: MockSession[] | null; sessionCost: unknown; sessionTurns: Record<string, { at: string; role: string; text: string }[]>; asks: MockAsk[]; agents: MockAgent[] | null; agentsFail: boolean; inbox: MockInbox[]; tasks: MockTask[]; calls: { path: string; body: any }[]; fail: Map<string, { status: number; code: string; message: string }>; anonymous: boolean; forbidden: boolean; /** `/api/sync` revision; null reloads on every probe. */ rev?: string | null; insertAbove: (project: string, text: string) => void }

const EMOJI = { status: ['🚧', '⏸️', '👀', '⏳', '⛔️'], priority: ['🚨', '‼️', '🔺', '🔻'], effort: ['🟢', '🟡', '🟠', '🔴', '⚫️'], impact: ['⬆️', '↔️', '⬇️'] } as Record<string, string[]>;
/** Short date for row text, relative to today (the plan depends on the clock). */
export const dateTag = (days = 0) => { const d = new Date(Date.now() + days * 864e5); return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`; };
const vs = (s: string) => s.replace(/️/g, '');

export const seed = (): MockTask[] => [
  { ref: 'alpha:6', text: `‼️ 📅 ${dateTag()}: Ship the **web app** 🟡`, project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: ['see [spec](https://example.test/spec)'] },
  { ref: 'alpha:7', text: 'Write docs 🟢', project: 'alpha', section: '🔄 Active', done: false, depth: 1, notes: [] },
  { ref: 'alpha:9', text: 'Review pull requests 🟠', project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: [] },
  { ref: 'alpha:13', text: '🔻 Tidy the backlog 🔴', project: 'alpha', section: '📋 Backlog', done: false, depth: 0, notes: [] },
  { ref: 'beta:4', text: 'Plan the trip 🟢', project: 'beta', section: '🔄 Active', done: false, depth: 0, notes: [] },
  { ref: 'beta:5', text: 'Book flights', project: 'beta', section: '🔄 Active', done: true, depth: 0, notes: [] },
];

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** In-memory fake of the Stack api plus SWA's `/.auth/me`. */
/** `context: true` routes at the browser context, so requests a service worker makes are mocked too. */
export async function mockApi(page: Page, opts: { tasks?: MockTask[]; agents?: MockAgent[]; context?: boolean; projects?: { name: string; title: string; metadata?: Record<string, string> }[] } = {}): Promise<Mock> {
  const router = opts.context ? page.context() : page;
  const m: Mock = { team: [], reviews: [], schedule: null, events: null, calendarFail: false, sessions: null, sessionCost: null, sessionTurns: {}, asks: [], agents: opts.agents ?? null, agentsFail: false, inbox: [], tasks: opts.tasks ?? seed(), calls: [], fail: new Map(), anonymous: false, forbidden: false, insertAbove: () => undefined };
  const proj = opts.projects?.map((p) => ({ metadata: {}, ...p })) ?? [
    { name: 'alpha', title: 'Alpha', metadata: { 'Work capacity': '2h' } },
    { name: 'beta', title: 'Beta', metadata: {} },
    // any other project the seeded tasks mention
    ...[...new Set(m.tasks.map((t) => t.project))].filter((n) => n !== 'alpha' && n !== 'beta').map((n) => ({ name: n, title: n[0].toUpperCase() + n.slice(1), metadata: {} })),
  ];
  const find = (ref: string) => m.tasks.find((t) => t.ref === ref);
  const strip = (t: MockTask, group: string) => { for (const e of EMOJI[group]) t.text = t.text.split(e).join('').split(vs(e)).join(''); t.text = t.text.replace(/\s+/g, ' ').trim(); };

  /** Another writer adds a row at the top of a project: every later line number in that file moves down by one. */
  m.insertAbove = (project, text) => {
    const mine = m.tasks.filter((t) => t.project === project);
    const first = Number(mine[0].ref.split(':').pop());
    for (const t of mine) t.ref = `${project}:${Number(t.ref.split(':').pop()) + 1}`;
    m.tasks.splice(m.tasks.indexOf(mine[0]), 0, { ref: `${project}:${first}`, text, project, section: mine[0].section, done: false, depth: 0, notes: [] });
  };

  await router.route('**/.auth/me', (r) => json(r, 200, { clientPrincipal: m.anonymous ? null : { identityProvider: 'github', userId: 'd2f0c0ffee', userDetails: 'octocat', userRoles: ['authenticated'] }, agents: !!m.sessions }));
  await router.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    if (req.method() === 'POST') m.calls.push({ path: decodeURIComponent(path), body });
    if (m.anonymous) return json(route, 401, { error: { code: 'unauthorized', message: 'Authentication required' } });
    if (m.forbidden) return json(route, 403, { error: { code: 'forbidden', message: 'Forbidden' } });
    const f = m.fail.get(path);
    if (f) { m.fail.delete(path); return json(route, f.status, { error: { code: f.code, message: f.message } }); }
    const open = m.tasks.filter((t) => !t.done);
    if (path === '/next') {
      const t = open[0];
      return json(route, 200, { task: t ? { ref: t.ref, text: t.text, project: t.project, score: 1 } : null });
    }
    if (path === '/tasks' && req.method() === 'POST') {
      const parent = body.parent ? find(body.parent) : undefined;
      if (parent && body.expect !== undefined && body.expect !== parent.text) return json(route, 409, { error: { code: 'conflict', message: 'Conflict' } });
      const ref = `${body.project}:${60 + m.tasks.length}`;
      return json(route, 201, { changed: true, ref, message: 'Added' });
    }
    if (path === '/tasks') {
      const off = Number(url.searchParams.get('offset') ?? 0), lim = Number(url.searchParams.get('limit') ?? 50);
      return json(route, 200, { items: m.tasks.slice(off, off + lim), total: m.tasks.length, offset: off, limit: lim });
    }
    if (path === '/sessions' && req.method() === 'GET') {
      if (!m.sessions) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      return json(route, 200, { items: m.sessions, total: m.sessions.length });
    }
    if (path === '/sessions/cost') return json(route, 200, m.sessionCost ?? { attribution: 'lastActive', days: [], projects: [], models: [], total: { usd: 0, tokens: 0, sessions: 0 } });
    const sm = /^\/sessions\/([^/]+)\/(messages|prompt|cancel)$/.exec(path);
    if (sm) {
      const s = m.sessions?.find((x) => x.id === sm[1]);
      if (!s) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      if (sm[2] === 'messages') return json(route, 200, { items: m.sessionTurns[s.id] ?? [] });
      if (sm[2] === 'prompt') { if (s.state === 'active') return json(route, 409, { error: { code: 'conflict', message: 'Session is active elsewhere' } }); s.state = 'running'; return json(route, 202, { runId: `run-${s.id.slice(-1)}`, sessionId: s.id }); }
      s.state = 'idle'; return json(route, 200, { changed: true });
    }
    // @req FR:agent-team/review.api @req FR:agent-team/talk.api
    // @req FR:agent-thread/thread.read @req FR:agent-thread/thread.assign
    const thm = /^\/tasks\/([^/]+)\/(thread|assign)$/.exec(path);
    if (thm) {
      const t = find(decodeURIComponent(thm[1]));
      if (!t) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      if (thm[2] === 'assign') {
        if (!m.sessions) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
        const ag = m.team.find((a) => a.slug === body?.agent) ?? m.team[0];
        const id = `a1b2c3d4-0000-0000-0000-0000000asg${m.calls.length}`.slice(0, 36);
        const title = `${ag?.name ?? 'Agent'} · ${t.text} · ${t.ref}`; // the server titles the session before the claim
        if (!/🚧/u.test(t.text)) t.text = `🚧 ${t.text}`;
        m.sessions.unshift({ id, title, project: 'stack', cwd: '/x', lastActive: new Date().toISOString(), state: 'running', cost: { usd: 0, tokens: 0 }, prs: [] });
        return json(route, 202, { runId: 'run-assign', sessionId: id, agent: ag?.slug ?? 'cos', title, claimed: true });
      }
      const items: unknown[] = [];
      for (const e of m.inbox) if (e.row === t.ref || e.ref === t.ref) items.push(e.from === 'agent' ? { at: e.at, kind: 'agent', id: e.id, agent: e.agent, text: e.text } : { at: e.at, kind: 'owner', id: e.id, text: e.text, state: e.state });
      for (const a of m.asks) if ((a.row ?? a.ref) === t.ref) items.push({ at: a.created, kind: 'ask', ask: a });
      const review = m.reviews.find((r) => r.ref === t.ref);
      if (review) items.push({ at: review.at, kind: 'review', verdict: review.verdict, plan: review.plan, estimate: review.estimate, agent: review.agent });
      for (const c of m.tasks) if (c.project === t.project && c.depth === t.depth + 1 && Number(c.ref.split(':')[1]) > Number(t.ref.split(':')[1]) && /🤖|🪄/u.test(c.text) && m.tasks.indexOf(c) === m.tasks.indexOf(t) + 1) items.push({ at: '', kind: 'subtask', ref: c.ref, text: c.text, done: c.done });
      items.sort((a, b) => String((a as { at: string }).at || '9').localeCompare(String((b as { at: string }).at || '9')));
      const session = m.sessions?.filter((x) => x.title.endsWith(` · ${t.ref}`)).sort((a, b) => b.lastActive.localeCompare(a.lastActive))[0];
      return json(route, 200, { items, ...(session ? { session: { id: session.id, title: session.title, state: session.state } } : {}), ...(review ? { review } : {}) });
    }
    if (path === '/team') { const pr = url.searchParams.get('project'); return json(route, 200, { items: pr ? m.team.filter((a) => a.scope.includes('*') || a.scope.some((x) => x.split('/')[0] === pr)).sort((a, b) => Number(b.scope.some((x) => x.startsWith(pr))) - Number(a.scope.some((x) => x.startsWith(pr)))) : m.team }); }
    if (path === '/reviews') { const pr = url.searchParams.get('project') ?? ''; return json(route, 200, { items: m.reviews.filter((r) => r.ref.startsWith(`${pr}:`)) }); }
    if (path === '/tasks/review') {
      if (!m.sessions) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      const t = find(body.ref);
      if (!t) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      const id = `a1b2c3d4-0000-0000-0000-0000000rev${m.calls.length}`.slice(0, 36);
      m.sessions.unshift({ id, title: `CoS · review · ${t.text} · ${t.ref}`, project: 'stack', cwd: '/x/stack', lastActive: new Date().toISOString(), state: 'running', cost: { usd: 0, tokens: 0 }, prs: [] });
      return json(route, 202, { runId: 'run-review', sessionId: id, agent: body.agent ?? 'cos' });
    }
    if (path === '/sessions' && req.method() === 'POST') {
      if (!m.sessions) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      const id = `a1b2c3d4-0000-0000-0000-0000000new${m.calls.length}`.slice(0, 36);
      const t = body.ref ? find(body.ref) : undefined;
      if (body.ref && !t) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      const ag = m.team.find((a) => a.slug === body.agent) ?? m.team[0];
      const title = t ? `${ag?.name ?? 'Agent'} · ${t.text} · ${t.ref}` : body.project ? `${ag?.name ?? 'Agent'} · ${body.project}` : body.text;
      m.sessions.unshift({ id, title, project: 'stack', cwd: body.cwd ?? '/x/stack', lastActive: new Date().toISOString(), state: 'running', cost: { usd: 0, tokens: 0 }, prs: [] });
      return json(route, 202, { runId: 'run-new', sessionId: id, ...(ag ? { agent: ag.slug, title } : {}) });
    }
    if (path === '/schedule/day') { // echo the schedule with the new bed (tests check the call)
      const s = m.schedule as { date: string; bed: string } | null;
      if (!s) return json(route, 400, { error: { code: 'bad_request', message: 'No schedule' } });
      if (body.bed && !body.every) { const [h, mi] = String(body.bed).split(':').map(Number); const d = new Date(`${s.date}T00:00:00`); d.setDate(d.getDate() + (h < 8 ? 1 : 0)); d.setHours(h, mi, 0, 0); m.schedule = { ...s, bed: d.toISOString() }; }
      return json(route, 200, m.schedule);
    }
    if (path === '/schedule') return json(route, 200, m.schedule); // null: no schedule, the 9-6 fallback
    if (path === '/calendar') {
      if (m.calendarFail) return json(route, 200, { configured: true, items: [], error: 'Calendar unavailable' });
      if (!m.events) return json(route, 200, { configured: false, items: [] });
      const from = Date.parse(url.searchParams.get('from') ?? ''), to = Date.parse(url.searchParams.get('to') ?? '');
      return json(route, 200, { configured: true, items: m.events.filter((e) => Date.parse(e.end) > from && Date.parse(e.start) < to) });
    }
    if (path === '/asks') {
      const st = url.searchParams.get('state') ?? 'open';
      const items = m.asks.filter((a) => (st === 'snoozed' ? a.state === 'open' && !!a.snoozedUntil : st === 'open' ? a.state === 'open' && !a.snoozedUntil : a.state === st)).sort((a, b) => b.score - a.score).map((a, i) => (st === 'open' ? { ...a, rank: i + 1 } : a));
      return json(route, 200, { items, total: items.length, latest: m.asks.map((a) => a.updated).sort().pop(), snoozed: m.asks.filter((a) => a.state === 'open' && a.snoozedUntil).length });
    }
    const ans = /^\/asks\/([^/]+)\/answer$/.exec(path);
    if (ans && req.method() === 'POST') {
      const a = m.asks.find((x) => x.key === ans[1]);
      if (!a) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      if (body.answer === 'retract') { a.state = 'open'; delete a.answer; delete a.text; return json(route, 200, { changed: true }); }
      if (a.state !== 'open') return json(route, 409, { error: { code: 'conflict', message: 'Conflict' } });
      if (body.answer === 'defer') a.snoozedUntil = body.until; else { a.state = 'answered'; a.answer = body.answer; a.text = body.text; }
      return json(route, 200, { changed: true });
    }
    if (path === '/agents') {
      if (m.agentsFail) return json(route, 500, { error: { code: 'internal', message: 'Internal error' } });
      // Default: agent rows from the tasks (🚧 working, else queued), like the server without PR status.
      const items = m.agents ?? open.filter((t) => /🤖|🪄/u.test(t.text) && !/🙋/u.test(t.text)).map((t) => ({ ref: t.ref, project: t.project, title: t.text.replace(/[🤖🪄🚧]/gu, '').trim(), text: t.text, state: /🚧/u.test(t.text) ? 'working' : 'queued', prs: [], replies: 0 }));
      return json(route, 200, { items });
    }
    if (path === '/inbox' && req.method() === 'POST') {
      const t = find(body.ref);
      if (!t) return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
      if (body.expect !== undefined && body.expect !== t.text) return json(route, 409, { error: { code: 'conflict', message: 'Conflict' } });
      const id = `in-20261028T100000Z-${String(m.inbox.length).padStart(4, '0')}`;
      m.inbox.push({ id, at: new Date().toISOString(), project: t.project, ref: t.ref, task: t.text.replace(/[🤖🪄🙋]/gu, '').trim(), kind: body.kind ?? 'reply', to: /🙋/u.test(t.text) ? 'human' : /🤖|🪄/u.test(t.text) ? 'agent' : 'none', text: body.text, state: 'open', row: t.ref });
      return json(route, 201, { id, path: `tasks/inbox/${t.project}.md` });
    }
    if (path === '/sync') return json(route, 200, { rev: m.rev ?? null });
    if (path === '/inbox') return json(route, 200, { items: m.inbox.filter((e) => e.state === 'open') });
    if (path === '/projects') return json(route, 200, { items: proj.map((p) => ({ ...p, open: 0, done: 0 })) });
    if (path === '/capture') {
      const text: string = body.text;
      if (/^\s*x\s*$/.test(text)) return json(route, 422, { error: { code: 'invalid', message: 'No title left after parsing' } });
      const project = /#(\w+)/.exec(text)?.[1] ?? body.project;
      const title = text.replace(/#\w+/g, '').replace(/\b\d+m\b/, '').replace(/\btomorrow\b/, '').trim();
      const spec = { title: title.charAt(0).toUpperCase() + title.slice(1), due: /tomorrow/.test(text) ? '2026-10-23' : undefined, effort: /30m/.test(text) ? { minutes: 30, emoji: '🟢' } : undefined, project };
      if (body.dryRun) return json(route, 200, { changed: false, spec });
      const ref = `${project}:${40 + m.tasks.length}`;
      m.tasks.push({ ref, text: `${spec.title}${spec.effort ? ' 🟢' : ''}`, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
      return json(route, 201, { changed: true, ref, after: spec.title, spec });
    }
    const t = body?.ref ? find(body.ref) : open[0];
    if (!t && path.startsWith('/tasks/')) return json(route, 404, { error: { code: 'not_found', message: 'Task not found' } });
    const stale = (r: string | undefined, x: MockTask) => r !== undefined && r !== x.text;
    if (path === '/tasks/edit' && stale(body.expect, t!)) return json(route, 409, { error: { code: 'conflict', message: 'Conflict' } });
    if (path === '/tasks/move' && (stale(body.expect, t!) || stale(body.expectTarget, find(body.target) ?? t!))) return json(route, 409, { error: { code: 'conflict', message: 'Conflict' } });
    switch (path) {
      case '/tasks/start': strip(t!, 'status'); t!.text = `🚧 ${t!.text}`; return json(route, 200, { changed: true, ref: t!.ref, message: 'Started' });
      case '/tasks/skip': strip(t!, 'status'); t!.text = `⏸️ ${t!.text}`; m.tasks.push(m.tasks.splice(m.tasks.indexOf(t!), 1)[0]); return json(route, 200, { changed: true, ref: t!.ref, message: 'Skipped' });
      case '/tasks/suspend': t!.text = `💤 Oct 23: ${t!.text}`; m.tasks.splice(m.tasks.indexOf(t!), 1); return json(route, 200, { changed: true, ref: t!.ref, message: `Suspended ${body.hours ? `${body.hours} hour(s)` : `${body.days} day(s)`}` });
      case '/tasks/complete': t!.done = true; return json(route, 200, { changed: true, ref: t!.ref, message: 'Completed' });
      case '/tasks/set': {
        if (body.checkbox) t!.done = body.checkbox === 'Complete';
        for (const g of Object.keys(EMOJI)) if (g in body) { strip(t!, g); if (body[g] !== 'None') t!.text = g === 'effort' ? `${t!.text} ${body[g]}` : `${body[g]} ${t!.text}`; }
        return json(route, 200, { changed: true, ref: t!.ref, message: 'Updated' });
      }
      case '/tasks/edit': t!.text = body.text; return json(route, 200, { changed: true, ref: t!.ref, message: 'Saved' });
      case '/tasks/move': {
        const to = find(body.target)!;
        if (to.project !== t!.project) return json(route, 422, { error: { code: 'invalid', message: 'Target must be in the same project' } });
        m.tasks.splice(m.tasks.indexOf(t!), 1);
        m.tasks.splice(m.tasks.indexOf(to) + (body.position === 'after' ? 1 : 0), 0, t!);
        return json(route, 200, { changed: true, ref: t!.ref, message: 'Moved' });
      }
    }
    return json(route, 404, { error: { code: 'not_found', message: 'Not found' } });
  });
  return m;
}
