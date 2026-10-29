/**
 * What each agent is doing, from artifacts only: agent rows, the result log, the owner's inbox, and pull request state and checks.
 * @req FR:agent-inbox/activity.rows @req FR:agent-inbox/activity.state @req FR:agent-inbox/activity.order
 */
import { EFFORT, IMPACT, PRIORITY, SPECIAL, STATUS, type LifecycleContext } from './lifecycle';
import { listInbox, taskTitle, type ListedEntry } from './inbox';
import { parseProject, type Task } from './parser';
import { NotFoundError } from './storage';
import { logName, md, redact } from './triage';

export interface PrRef { url: string; repo: string; number: number }
export interface PrStatus { state: 'open' | 'draft' | 'merged' | 'closed'; checks: 'passing' | 'failing' | 'pending' | 'none'; title: string; updatedAt: string }
export type PrStatusProvider = (prs: PrRef[]) => Promise<Map<string, PrStatus>>;
export type AgentState = 'failing' | 'waiting' | 'review' | 'merged' | 'ci' | 'working' | 'queued';
export interface LogEntry { at: string; action: string; outcome?: string; summary?: string }
export interface AgentItem {
  ref: string; project: string; title: string; text: string; state: AgentState;
  prs: (PrRef & Partial<PrStatus>)[]; last?: LogEntry; waitingOn?: string; replies: number; since?: string;
}
export interface ActivityContext extends LifecycleContext { prs?: PrStatusProvider }

const ORDER: AgentState[] = ['failing', 'waiting', 'review', 'merged', 'ci', 'working', 'queued'];
const PR = /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})(?!\d)/g;
const MAX_PRS = 5;
const DAY = 864e5;
const VS = /\uFE0F/g;
const has = (text: string, e: string) => text.replace(VS, '').includes(e.replace(VS, ''));
const PARKED = ['💤', '🅿️'];
const MARKS = [...STATUS, ...PRIORITY, ...EFFORT, ...IMPACT, ...SPECIAL].map((e) => e.replace(VS, ''));
const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');

/** GitHub pull request links in order, deduplicated, at most 5. @req FR:agent-inbox/activity.prs */
export function prLinks(texts: string[]): PrRef[] {
  const out: PrRef[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(PR)) {
      const url = `https://github.com/${m[1]}/${m[2]}/pull/${Number(m[3])}`;
      if (!out.some((p) => p.url === url) && out.length < MAX_PRS) out.push({ url, repo: `${m[1]}/${m[2]}`, number: Number(m[3]) });
    }
  }
  return out;
}

/** 🤖 as an agent mark (not the `🤖:level` autonomy marker), or 🪄. */
const isAgent = (text: string) => has(text, '🪄') || /🤖(?!:)/u.test(text);
const isHuman = (text: string) => has(text, '🙋');
const isActive = (section: string) => /active/i.test(section) || section.includes('🔄');
const titleOf = (text: string) => {
  let t = taskTitle(text).replace(VS, '');
  for (const e of MARKS) t = t.split(e).join(' ');
  return t.replace(/\s+/g, ' ').trim();
};

/** Newest result log entry per ref (`path:line`, 1-based) across the project's log files. @req FR:agent-inbox/activity.log */
async function logEntries(ctx: LifecycleContext, path: string): Promise<Map<string, LogEntry>> {
  const out = new Map<string, LogEntry>();
  const slug = logName({ path, line: 0 });
  for (let n = 0; n < 5; n++) {
    let content: string;
    try { content = (await ctx.storage.read(`tasks/logs/${slug}${n === 0 ? '' : `.${n + 1}`}.md`)).content; } catch (e) { if (e instanceof NotFoundError) continue; throw e; }
    for (const chunk of content.split(/^## /m).slice(1)) {
      const at = chunk.split('\n')[0].trim();
      const kv = new Map([...chunk.matchAll(/^- ([a-z]+): (.*)$/gm)].map((m) => [m[1], m[2].trim()]));
      const ref = kv.get('ref');
      if (!ref || !/^\d{4}-\d\d-\d\dT/.test(at)) continue;
      const prev = out.get(ref);
      if (prev && prev.at >= at) continue;
      out.set(ref, { at, action: kv.get('action') ?? 'result', ...(kv.get('outcome') ? { outcome: kv.get('outcome') } : {}), ...(kv.get('summary') ? { summary: kv.get('summary') } : {}) });
    }
  }
  return out;
}

interface Found { t: Task; chain: Task[]; section: string; siblings: Task[] }
function walk(ts: Task[], section: string, chain: Task[], out: Found[]): void {
  for (const t of ts) {
    out.push({ t, chain, section, siblings: ts });
    walk(t.children, section, [...chain, t], out);
  }
}

function stateOf(i: Omit<AgentItem, 'state'>, doing: boolean, now: number): AgentState {
  const known = i.prs.filter((p) => p.state);
  const open = known.filter((p) => p.state === 'open');
  if (known.length > 0 && known.length === i.prs.length && known.every((p) => p.state === 'merged')) return 'merged';
  if (known.some((p) => (p.state === 'open' || p.state === 'draft') && p.checks === 'failing')) return 'failing';
  if (i.waitingOn || i.last?.outcome === 'blocked' || i.last?.outcome === 'needs-human') return 'waiting';
  if (open.some((p) => p.checks === 'passing' || p.checks === 'none')) return 'review';
  if (open.some((p) => p.checks === 'pending')) return 'ci';
  if (doing || known.some((p) => p.state === 'draft') || (i.last && now - Date.parse(i.last.at) < DAY)) return 'working';
  return 'queued';
}

/**
 * Agent work across every project, newest artifacts first within each state.
 * @req FR:agent-inbox/activity.rows @req FR:agent-inbox/activity.status @req FR:agent-inbox/activity.waiting @req FR:agent-inbox/activity.replies @req FR:agent-inbox/activity.state @req FR:agent-inbox/activity.order
 */
export async function agentActivity(ctx: ActivityContext): Promise<AgentItem[]> {
  const now = (ctx.now ?? (() => new Date()))().getTime();
  const inbox: ListedEntry[] = await listInbox(ctx).catch(() => []);
  const rows: { item: Omit<AgentItem, 'state'>; doing: boolean; order: number }[] = [];
  for (const path of await ctx.storage.list()) {
    const name = baseName(path);
    if (/^readme$/i.test(name)) continue;
    const project = parseProject((await ctx.storage.read(path)).content);
    const found: Found[] = [];
    for (const s of project.sections) walk(s.tasks, s.heading, [], found);
    const logs = await logEntries(ctx, path);
    for (const { t, chain, section, siblings } of found) {
      if (t.checked || chain.some((c) => c.checked) || !isAgent(t.text) || isHuman(t.text) || PARKED.some((e) => has(t.text, e))) continue;
      const doing = has(t.text, '🚧');
      if (!isActive(section) && !doing) continue;
      const human = [...t.children, ...siblings.filter((x) => x !== t)].find((x) => !x.checked && isHuman(x.text));
      const fileRef = `${path}:${t.line + 1}`;
      const title = titleOf(t.text);
      const safeTitle = md(redact(taskTitle(t.text)));
      const replies = inbox.filter((e) => e.state === 'open' && e.project === name && (e.ref === fileRef || e.task === safeTitle)).length;
      const last = logs.get(fileRef);
      rows.push({
        item: {
          ref: `${name}:${t.line}`, project: name, title, text: t.text, prs: prLinks([t.text, ...t.notes]),
          ...(last ? { last } : {}), ...(human ? { waitingOn: `${name}:${human.line}` } : {}), replies,
        },
        doing, order: rows.length,
      });
    }
  }
  const all = rows.flatMap((r) => r.item.prs);
  let status = new Map<string, PrStatus>();
  if (ctx.prs && all.length > 0) {
    try { status = await ctx.prs(all.filter((p, i) => all.findIndex((q) => q.url === p.url) === i)); } catch { status = new Map(); }
  }
  const items = rows.map((r) => {
    const prs = r.item.prs.map((p) => ({ ...p, ...(status.get(p.url) ?? {}) }));
    const base = { ...r.item, prs };
    const stamps = [...prs.map((p) => p.updatedAt), base.last?.at].filter((x): x is string => !!x).sort();
    return { ...base, state: stateOf(base, r.doing, now), ...(stamps.length ? { since: stamps[stamps.length - 1] } : {}), order: r.order };
  });
  items.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || (b.since ?? '').localeCompare(a.since ?? '') || a.order - b.order);
  return items.map((i) => { const { order, ...rest } = i; void order; return rest; });
}
