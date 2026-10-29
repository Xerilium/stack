import type { Page, Route } from '@playwright/test';

export interface MockTask { ref: string; text: string; project: string; section: string; done: boolean; depth: number; notes: string[] }
export interface Mock { tasks: MockTask[]; calls: { path: string; body: any }[]; fail: Map<string, { status: number; code: string; message: string }>; anonymous: boolean; forbidden: boolean; insertAbove: (project: string, text: string) => void }

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
export async function mockApi(page: Page, opts: { tasks?: MockTask[] } = {}): Promise<Mock> {
  const m: Mock = { tasks: opts.tasks ?? seed(), calls: [], fail: new Map(), anonymous: false, forbidden: false, insertAbove: () => undefined };
  const proj = [
    { name: 'alpha', title: 'Alpha', metadata: { 'Work capacity': '2h' } },
    { name: 'beta', title: 'Beta', metadata: {} },
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

  await page.route('**/.auth/me', (r) => json(r, 200, { clientPrincipal: m.anonymous ? null : { userDetails: 'octocat', userRoles: ['authenticated'] } }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    if (req.method() === 'POST') m.calls.push({ path, body });
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
