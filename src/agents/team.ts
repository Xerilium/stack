/**
 * Sessions that belong to tasks: start a run for the task's agent (persona, context, title) and review a task (read-only run with a JSON verdict,
 * recorded in the result log, needs written as asks).
 * @req FR:agent-team/talk.start @req FR:agent-team/review.run @req FR:agent-team/review.record @req FR:agent-team/review.needs @req FR:agent-team/review.read
 */
import { agentFor, listTeam, reviewPrefix, reviewsIn, type Review, type TeamAgent } from '../core/agents';
import { handleAsk, listAsks, putAsk, type AskKind, type ListedAsk } from '../core/asks';
import { listInbox, type ListedEntry } from '../core/inbox';
import { claimTask } from '../core/triage';
import { LifecycleError, type LifecycleContext, type TaskRef } from '../core/lifecycle';
import { parseProject, type Task } from '../core/parser';
import { NotFoundError } from '../core/storage';
import { recordResult, redact, TriageDenied } from '../core/triage';
import { formatRef, parseRef } from '../api/validate';
import { READ_ONLY_TOOLS, WRITE_TOOLS, type PromptOptions, type Update } from './driver';
import type { AgentRuns } from './runs';

export interface ReviewAnswer { verdict: 'can' | 'partial' | 'cannot'; plan: string; estimate?: string; needs: { what: string; kind: 'answer' | 'go-do' | 'approve'; why?: string }[]; risks?: string[] }
export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['can', 'partial', 'cannot'] },
    plan: { type: 'string', description: 'One line: how you would do it' },
    estimate: { type: 'string', description: 'Rough effort in a few characters, e.g. 20m, 2h, 1-2d' },
    needs: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, kind: { type: 'string', enum: ['answer', 'go-do', 'approve'] }, why: { type: 'string' } }, required: ['what', 'kind'] } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'plan', 'needs'],
};
const REVIEW_PROMPT = 'Review the task in your context: could you, as the agent in scope, do it yourself? Read what you need in the repository (read-only). Answer with the JSON schema: verdict "can" (all of it), "partial" (some of it, the rest needs the owner), or "cannot"; plan (one line); estimate; needs: every exact thing you need from the owner first (a fact to answer, a go-do only they can do, an approval), each one line; risks. Do not start the work.';
export const QUICK_PROMPTS = {
  assign: 'This task is yours now. First flesh out the subtasks under this row (`stack add <project> "🤖 <text>" --parent <ref>`; the 🤖 marks them as yours), then raise every question for the owner as an ask with `--ref`, reply on the task with `stack inbox reply`, and start the work. Never wait in chat.',
  do: 'Do this task. Bring me anything you need as an ask (`stack asks put`, see docs/asks.md); never wait in chat.',
  plan: 'Plan this task in steps with a rough estimate each; do not start it.',
} as const;

const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');
/** A 🙋 row is the owner's alone: no agent reviews or works it. */
const HUMAN = /🙋/u;
const oneLine = (s: string, max = 200) => { const t = redact(s).replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase();
/** The session store keeps 80 characters of a title: the ` · <ref>` suffix the page maps on must survive, so the head is cut first. */
export const TITLE_MAX = 80;
export function sessionTitle(head: string, tail: string): string {
  const suffix = tail ? ` · ${tail}` : '';
  const room = TITLE_MAX - suffix.length;
  const h = oneLine(head, 200);
  return `${h.length > room ? `${h.slice(0, Math.max(1, room - 1))}…` : h}${suffix}`;
}

const findChain = (tasks: Task[], line: number, chain: Task[] = []): Task[] | null => {
  for (const t of tasks) { if (t.line === line) return [...chain, t]; const hit = findChain(t.children, line, [...chain, t]); if (hit) return hit; }
  return null;
};
const bullets = (ts: Task[], depth = 0): string[] => ts.flatMap((t) => [`${'  '.repeat(depth)}- [${t.checked ? 'x' : ' '}] ${t.text}`, ...t.notes.map((n) => `${'  '.repeat(depth + 1)}${n.trim()}`), ...bullets(t.children, depth + 1)]);

/** The row, its notes, its subtasks, and where it sits: what the agent reads before anything else. */
export async function taskContext(ctx: LifecycleContext, ref: TaskRef): Promise<{ text: string; title: string; project: string; section: string; human: boolean }> {
  const f = await ctx.storage.read(ref.path);
  const p = parseProject(f.content);
  for (const s of p.sections) {
    const chain = findChain(s.tasks, ref.line);
    if (!chain) continue;
    const row = chain[chain.length - 1];
    const text = [`Project: ${p.title || baseName(ref.path)} (${ref.path})`, `Section: ${s.heading}`, chain.length > 1 ? `Parent: ${chain[chain.length - 2].text}` : '', `Task (line ${ref.line + 1}):`, ...bullets([row])].filter(Boolean).join('\n');
    return { text, title: row.text, project: baseName(ref.path), section: s.heading, human: HUMAN.test(row.text) };
  }
  throw new NotFoundError('Task not found');
}

/** The system prompt addition: who the agent is, its scope, the ask rule, its own prompt, then the context. */
export function personaOf(agent: TeamAgent, context?: string): string {
  const head = `You are ${agent.name}${agent.role ? `, ${agent.role}` : ''}, an agent in Stack (the owner's task system). Your scope: ${agent.scope.join(', ') || 'the task at hand'}. Work inside it. Bring the owner decisions only as asks (\`stack asks put --ref tasks/<file>.md:<line>\`, see docs/asks.md) and answer them on the task with \`stack inbox reply tasks/<file>.md:<line> --from <you> --text "..."\`; never rely on this chat alone, the owner reads the task thread.`;
  return [head, agent.prompt, context ? `## Context\n\n${context}` : ''].filter(Boolean).join('\n\n');
}

export interface AgentRunInput { agent?: string; ref?: string; project?: string; text: string }
async function resolve(ctx: LifecycleContext, i: { agent?: string; ref?: string; project?: string }) {
  const ref = i.ref ? parseRef(i.ref) : null;
  if (i.ref && !ref) throw new LifecycleError('Bad ref');
  const c = ref ? await taskContext(ctx, ref) : null;
  const project = c?.project ?? i.project;
  if (!c && project) { try { await ctx.storage.read(`tasks/${project}.md`); } catch (e) { if (e instanceof NotFoundError) throw new NotFoundError(`No project ${project}`); throw e; } }
  const team = await listTeam(ctx);
  const agent = i.agent ? team.find((a) => a.slug === i.agent) : project ? agentFor(team, project, c?.section)[0] : undefined;
  if (!agent) throw new NotFoundError(i.agent ? `No agent ${i.agent}` : `No agent for ${project ?? 'this'}`);
  return { ref, c, project, agent };
}

/** Starts a new session for an agent on a task (or a project). @req FR:agent-team/talk.start */
export async function startAgentRun(runs: AgentRuns, ctx: LifecycleContext, i: AgentRunInput): Promise<{ runId: string; sessionId: string | null; agent: string; title: string }> {
  const { c, project, agent } = await resolve(ctx, i);
  // The title is what the page maps back to the task (` · <ref>`); without a task it names the project, or just the agent.
  const title = c ? sessionTitle(`${agent.name} · ${c.title}`, i.ref!) : sessionTitle(project ? `${agent.name} · ${project}` : agent.name, '');
  const options: PromptOptions = { systemPrompt: personaOf(agent, c?.text), title, ...(agent.model ? { model: agent.model } : {}) };
  const r = await runs.prompt({ text: i.text, options });
  return { ...r, agent: agent.slug, title };
}

/** Starts a read-only review; the verdict and its needs land when the run ends. @req FR:agent-team/review.run */
export async function reviewTask(runs: AgentRuns, ctx: LifecycleContext, refText: string, agentSlug?: string, onError: (e: unknown) => void = (e) => console.error('review:', e)): Promise<{ runId: string; sessionId: string | null; agent: string }> {
  const { ref, c, agent } = await resolve(ctx, { ref: refText, agent: agentSlug });
  if (!ref || !c) throw new LifecycleError('Bad ref');
  if (c.human) throw new TriageDenied('Needs a human');
  const title = sessionTitle(`${agent.name} · review · ${c.title}`, refText);
  const options: PromptOptions = { systemPrompt: personaOf(agent, c.text), title, schema: REVIEW_SCHEMA, allowedTools: READ_ONLY_TOOLS, disallowedTools: WRITE_TOOLS, ...(agent.model ? { model: agent.model } : {}) };
  const r = await runs.prompt({ text: REVIEW_PROMPT, options });
  const now = () => (ctx.now ?? (() => new Date()))();
  const onDone = async (d: Extract<Update, { type: 'done' }>) => {
    const a = parseVerdict(d.structured ?? d.text);
    if (d.stopReason !== 'end_turn' || !a) return;
    const prefix = reviewPrefix(ref);
    const open = await listAsks(ctx, { state: 'open', limit: 200 });
    for (const k of open.items.filter((x) => x.key.startsWith(prefix)).map((x) => x.key)) await handleAsk(ctx, k, { outcome: 'resolved', note: 'reviewed again' }, agent.slug).catch(onError);
    const outcome = a.verdict === 'can' ? 'done' : a.verdict === 'partial' ? 'partial' : 'blocked';
    const est = a.estimate ? ` (${oneLine(a.estimate, 40)})` : '';
    await recordResult(ctx, ref, { outcome, summary: `${a.verdict}: ${oneLine(a.plan, 200)}${est}`, action: 'review' }, { actor: `agent:${agent.slug}`, owner: true });
    const base = `${prefix}${stamp(now())}-`;
    for (const [i, need] of a.needs.slice(0, 9).entries()) {
      const kind: AskKind = need.kind === 'go-do' || need.kind === 'approve' ? need.kind : 'answer';
      await putAsk(ctx, `${base}${i + 1}`, { ask: oneLine(need.what, 200), kind, from: agent.slug, project: c.project, ref: refText, why: oneLine(`${c.title}${need.why ? ` — ${need.why}` : ''}`, 500), priority: 'normal', blocks: 1, effort: '2m', reversible: false, ...(kind === 'approve' ? { recommend: 'Approve' } : {}) }, agent.slug);
    }
  };
  // The run manager buffers updates, so a subscription right after the prompt never misses `done`.
  // A failure here (a 🙋 row refuses a log entry, storage conflict) must not vanish: it is logged, and the chip then shows no verdict.
  const off = runs.subscribe(r.runId, (u) => { if (u.type === 'done') { off?.(); void onDone(u).catch(onError); } }, () => undefined);
  return { ...r, agent: agent.slug };
}

/** Assign: the row is claimed for the agent (log + in progress) and a session starts with the assign prompt. @req FR:agent-thread/thread.assign */
export async function assignTask(runs: AgentRuns, ctx: LifecycleContext, refText: string, agentSlug?: string): Promise<{ runId: string; sessionId: string | null; agent: string; title: string; claimed: boolean }> {
  const { ref, c, agent } = await resolve(ctx, { ref: refText, agent: agentSlug });
  if (!ref || !c) throw new LifecycleError('Bad ref');
  if (c.human) throw new TriageDenied('Needs a human');
  const claimed = (await claimTask(ctx, ref, { actor: `agent:${agent.slug}`, owner: true })).changed;
  const r = await startAgentRun(runs, ctx, { agent: agent.slug, ref: refText, text: QUICK_PROMPTS.assign });
  return { ...r, claimed };
}

export type ThreadItem =
  | { at: string; kind: 'owner'; id: string; text: string; state: 'open' | 'handled' }
  | { at: string; kind: 'agent'; id: string; agent: string; text: string }
  | { at: string; kind: 'ask'; ask: ListedAsk }
  | { at: string; kind: 'review'; verdict: Review['verdict']; plan: string; estimate?: string; agent: string }
  | { at: string; kind: 'subtask'; ref: string; text: string; done: boolean };
export interface Thread { items: ThreadItem[]; session?: { id: string; title: string; state: string }; review?: Review }

/** Everything about one task in time order: the owner's messages, the agent's replies, its asks, the verdict, the subtasks agents added. @req FR:agent-thread/thread.read */
export async function taskThread(ctx: LifecycleContext, runs: AgentRuns | undefined, refText: string): Promise<Thread> {
  const ref = parseRef(refText);
  if (!ref) throw new LifecycleError('Bad ref');
  const c = await taskContext(ctx, ref);
  const stored = `${ref.path}:${ref.line + 1}`;
  const items: ThreadItem[] = [];
  const inbox: ListedEntry[] = await listInbox(ctx, { project: c.project, state: 'all' }).catch(() => []);
  for (const e of inbox) {
    if (e.ref !== stored) continue;
    if (e.from === 'agent') items.push({ at: e.at, kind: 'agent', id: e.id, agent: e.agent ?? 'agent', text: e.text });
    else items.push({ at: e.at, kind: 'owner', id: e.id, text: e.text, state: e.state });
  }
  const asks = await listAsks(ctx, { state: 'all', limit: 200 }).catch(() => ({ items: [] as ListedAsk[] }));
  for (const a of asks.items) if (a.ref === refText || a.row === refText) items.push({ at: a.created, kind: 'ask', ask: a });
  const review = (await reviewsIn(ctx, ref.path)).get(ref.line);
  if (review) { review.needs = asks.items.filter((a) => a.state === 'open' && a.key.startsWith(reviewPrefix(ref))).map((a) => a.key); items.push({ at: review.at, kind: 'review', verdict: review.verdict, plan: review.plan, ...(review.estimate ? { estimate: review.estimate } : {}), agent: review.agent }); }
  // Subtasks an agent owns (🤖 or 🪄) under this row.
  const f = parseProject((await ctx.storage.read(ref.path)).content);
  const walk = (ts: Task[]): Task | null => { for (const t of ts) { if (t.line === ref.line) return t; const h = walk(t.children); if (h) return h; } return null; };
  let row: Task | null = null;
  for (const sec of f.sections) row = row ?? walk(sec.tasks);
  for (const ch of row?.children ?? []) if (/🤖|🪄/u.test(ch.text)) items.push({ at: '', kind: 'subtask', ref: formatRef({ path: ref.path, line: ch.line }), text: ch.text, done: ch.checked });
  items.sort((a, b) => (a.at || '9').localeCompare(b.at || '9'));
  const out: Thread = { items, ...(review ? { review } : {}) };
  if (runs) {
    const tail = ` · ${refText}`;
    const mine = (await runs.sessions({ limit: 200 }).catch(() => ({ items: [] }))).items.filter((x) => x.title.endsWith(tail)).sort((a, b) => b.lastActive.localeCompare(a.lastActive))[0];
    if (mine) out.session = { id: mine.id, title: mine.title, state: mine.state };
  }
  return out;
}

/** The verdict from a structured answer or from JSON in the final text; null when there is none. */
export function parseVerdict(v: unknown): ReviewAnswer | null {
  let a = v;
  if (typeof a === 'string') { const m = /\{[\s\S]*\}/.exec(a); if (!m) return null; try { a = JSON.parse(m[0]); } catch { return null; } }
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  if (!['can', 'partial', 'cannot'].includes(String(o.verdict)) || typeof o.plan !== 'string' || !o.plan.trim()) return null;
  const needs = Array.isArray(o.needs) ? o.needs.filter((n): n is ReviewAnswer['needs'][number] => !!n && typeof n === 'object' && typeof (n as { what?: unknown }).what === 'string' && !!(n as { what: string }).what.trim()) : [];
  return { verdict: o.verdict as ReviewAnswer['verdict'], plan: o.plan, ...(typeof o.estimate === 'string' && o.estimate.trim() ? { estimate: o.estimate } : {}), needs, ...(Array.isArray(o.risks) ? { risks: o.risks.map(String) } : {}) };
}

/** Every row's newest review in a project, from one pass over its log files. @req FR:agent-team/review.read */
export async function listReviews(ctx: LifecycleContext, project: string): Promise<(Review & { ref: string })[]> {
  const path = `tasks/${project}.md`;
  let content: string;
  try { content = (await ctx.storage.read(path)).content; } catch (e) { if (e instanceof NotFoundError) return []; throw e; }
  const open = (await listAsks(ctx, { state: 'open', limit: 200 })).items.map((a) => a.key);
  const lines = new Set<number>();
  const walk = (ts: Task[]) => { for (const t of ts) { lines.add(t.line); walk(t.children); } };
  for (const s of parseProject(content).sections) walk(s.tasks);
  const all = await reviewsIn(ctx, path);
  const out: (Review & { ref: string })[] = [];
  for (const line of lines) {
    const r = all.get(line);
    if (!r) continue;
    const prefix = reviewPrefix({ path, line });
    out.push({ ...r, needs: open.filter((k) => k.startsWith(prefix)), ref: formatRef({ path, line }) });
  }
  return out;
}
