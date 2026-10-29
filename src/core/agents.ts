/**
 * Agent definitions at the project folder level: one file per agent (`tasks/agents/<slug>.md`) with a scope of project or project/section prefixes,
 * plus the agents a project names in its `Agents` metadata. Resolves which agent is active for a task and reads the newest review of a row.
 * @req FR:agent-team/agent.path @req FR:agent-team/agent.format @req FR:agent-team/agent.team @req FR:agent-team/agent.resolve @req FR:agent-team/review.read
 */
import { LifecycleError, type LifecycleContext, type TaskRef } from './lifecycle';
import { parseProject } from './parser';
import { NotFoundError } from './storage';
import { logName, redact } from './triage';

export const AGENT_MODES = ['long-running', 'ad-hoc'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export interface AgentDef {
  slug: string; name: string; role?: string; scope: string[]; model?: string; tools?: string[]; mode: AgentMode;
  /** System prompt addition (`## Prompt`). */
  prompt: string;
  /** Lines this version does not know; kept as is. */
  extra: string[];
}
export interface TeamAgent extends Omit<AgentDef, 'extra'> {
  /** True when a `tasks/agents/<slug>.md` file exists. */
  defined: boolean;
  /** Projects the scope resolves to (`*` lists every project). */
  projects: string[];
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const HEADER = '<!-- stack-agent v1. Scope is a list of project or project/section prefixes; `*` is everything. -->';
const FIELDS = ['name', 'role', 'scope', 'model', 'tools', 'mode'] as const;
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const MAX_NAME = 60;
const MAX_PROMPT = 20_000;

export function agentsPath(slug: string): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new LifecycleError('Invalid agent slug (lower case letters, digits, . _ -; up to 40)');
  return `tasks/agents/${slug}.md`;
}

/** A slug from a display name: emoji and punctuation dropped, words joined by `-`. */
export function slugOf(name: string): string {
  const s = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'agent';
}

const oneLine = (v: string): string => redact(v.replace(CONTROL, ' ')).replace(/\s+/g, ' ').trim();
const scopeOk = (s: string) => s === '*' || /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[^/\\\0]+)?$/.test(s);

/** The agent as markdown (v1). */
export function formatAgent(a: AgentDef): string {
  const f: [string, string | undefined][] = [
    ['name', a.name], ['role', a.role], ['scope', a.scope.join(', ')], ['model', a.model], ['tools', a.tools?.join(', ')], ['mode', a.mode],
  ];
  const lines = [`# Agent: ${a.slug}`, '', HEADER, '', ...f.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- ${k}: ${v}`), ...a.extra];
  if (a.prompt.trim()) lines.push('', '## Prompt', '', a.prompt.trim());
  return `${lines.join('\n')}\n`;
}

/** Tolerant parse: a missing field takes its default, a bad one is dropped, unknown lines are kept. */
export function parseAgent(slug: string, content: string): AgentDef {
  const a: AgentDef = { slug, name: slug, scope: [], mode: 'ad-hoc', prompt: '', extra: [] };
  let inPrompt = false;
  const prompt: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^## Prompt\s*$/.test(line)) { inPrompt = true; continue; }
    if (inPrompt) { prompt.push(line); continue; }
    if (line === '' || line.startsWith('#') || line.startsWith('<!--')) continue;
    const m = /^- ([a-z]+): (.*)$/.exec(line);
    if (!m || !(FIELDS as readonly string[]).includes(m[1])) { if (line.startsWith('- ')) a.extra.push(line); continue; }
    const v = oneLine(m[2]);
    switch (m[1]) {
      case 'name': if (v && v.length <= MAX_NAME) a.name = v; break;
      case 'role': if (v) a.role = v; break;
      case 'scope': a.scope = v.split(',').map((s) => s.trim()).filter((s) => s && scopeOk(s)); break;
      case 'model': if (/^[A-Za-z0-9._-]{1,80}$/.test(v)) a.model = v; break;
      case 'tools': a.tools = v.split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'mode': if ((AGENT_MODES as readonly string[]).includes(v)) a.mode = v as AgentMode; break;
    }
  }
  a.prompt = prompt.join('\n').trim().slice(0, MAX_PROMPT);
  return a;
}

export interface AgentPut { name?: string; role?: string; scope?: string[]; model?: string; tools?: string[]; mode?: AgentMode; prompt?: string }

/** Creates or updates an agent file; `name` is required on create. */
export async function putAgent(ctx: LifecycleContext, slug: string, input: AgentPut): Promise<{ slug: string; created: boolean }> {
  const path = agentsPath(slug);
  let cur: AgentDef | null = null;
  let version: string | null = null;
  try { const f = await ctx.storage.read(path); cur = parseAgent(slug, f.content); version = f.version; } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  const next: AgentDef = cur ?? { slug, name: '', scope: [], mode: 'ad-hoc', prompt: '', extra: [] };
  if (input.name !== undefined) { const n = oneLine(String(input.name)); if (!n || n.length > MAX_NAME) throw new LifecycleError(`name must be 1-${MAX_NAME} characters`); next.name = n; }
  if (!next.name) throw new LifecycleError('name is required');
  if (input.role !== undefined) next.role = oneLine(String(input.role)) || undefined;
  if (input.scope !== undefined) {
    if (!Array.isArray(input.scope)) throw new LifecycleError('scope must be a list');
    const bad = input.scope.find((s) => typeof s !== 'string' || !scopeOk(s.trim()));
    if (bad !== undefined) throw new LifecycleError(`Bad scope: ${JSON.stringify(bad)}`);
    next.scope = input.scope.map((s) => s.trim());
  }
  if (input.model !== undefined) { if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.model)) throw new LifecycleError('Bad model'); next.model = input.model; }
  if (input.tools !== undefined) { if (!Array.isArray(input.tools)) throw new LifecycleError('tools must be a list'); next.tools = input.tools.map((t) => oneLine(String(t))).filter(Boolean); }
  if (input.mode !== undefined) { if (!(AGENT_MODES as readonly string[]).includes(input.mode)) throw new LifecycleError(`mode must be one of ${AGENT_MODES.join(', ')}`); next.mode = input.mode; }
  if (input.prompt !== undefined) { if (typeof input.prompt !== 'string' || input.prompt.length > MAX_PROMPT) throw new LifecycleError(`prompt must be at most ${MAX_PROMPT} characters`); next.prompt = input.prompt; }
  await ctx.storage.write(path, formatAgent(next), { expectedVersion: version, message: `${cur ? 'Update' : 'Add'} agent ${slug}` });
  return { slug, created: cur === null };
}

/** `Agents` metadata: one agent per list item or comma-separated entry, `` `name` — role`` or `name — role`. */
export function parseAgentsMeta(value: string | undefined, items: string[]): { name: string; role?: string }[] {
  const out: { name: string; role?: string }[] = [];
  const add = (raw: string) => {
    const s = raw.replace(/^\s*-\s*/, '').trim();
    if (!s) return;
    // `name` — role: the role follows a spaced dash, so a hyphen inside a name is kept.
    const m = /^(.+?)\s+[—–-]+\s+(.*)$/.exec(s);
    const name = oneLine((m?.[1] ?? s).replace(/`/g, ''));
    if (!name) return;
    out.push({ name: name.slice(0, MAX_NAME), ...(m?.[2]?.trim() ? { role: oneLine(m[2]) } : {}) });
  };
  if (value && value.trim()) value.split(/,\s*(?=`|[^\s])/).forEach(add); // inline list on the metadata line
  items.forEach(add);
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');

/** Every agent: files first (file order), then agents named only in project metadata (project order). @req FR:agent-team/agent.team */
export async function listTeam(ctx: LifecycleContext): Promise<TeamAgent[]> {
  const projects: { name: string; agents: { name: string; role?: string }[] }[] = [];
  for (const path of await ctx.storage.list()) {
    const name = baseName(path);
    if (/^readme$/i.test(name)) continue;
    const content = (await ctx.storage.read(path)).content;
    const p = parseProject(content);
    const lines = p.lines;
    // List items right under the `- **Agents:**` line.
    const items: string[] = [];
    const at = lines.findIndex((l) => /^- \*\*Agents:\*\*/.test(l));
    if (at >= 0) for (let i = at + 1; i < lines.length && /^\s+- /.test(lines[i]); i++) items.push(lines[i]);
    projects.push({ name, agents: parseAgentsMeta(p.metadata['Agents'], items) });
  }
  const all = projects.map((p) => p.name);
  const team: TeamAgent[] = [];
  const files = ctx.storage.listAgents ? await ctx.storage.listAgents() : [];
  for (const path of files) {
    const slug = baseName(path);
    const a = parseAgent(slug, (await ctx.storage.read(path)).content);
    const named = projects.filter((p) => p.agents.some((x) => slugOf(x.name) === slug || x.name === a.name)).map((p) => p.name);
    const scope = a.scope.length ? a.scope : named;
    const { extra, ...rest } = a; void extra;
    team.push({ ...rest, scope, defined: true, projects: resolveProjects(scope, all) });
  }
  for (const p of projects) {
    for (const x of p.agents) {
      const slug = slugOf(x.name);
      const have = team.find((t) => t.slug === slug || t.name === x.name);
      if (have) { if (!have.defined && !have.scope.includes(p.name)) { have.scope.push(p.name); have.projects = resolveProjects(have.scope, all); } continue; }
      team.push({ slug, name: x.name, ...(x.role ? { role: x.role } : {}), scope: [p.name], mode: 'ad-hoc', prompt: '', defined: false, projects: [p.name] });
    }
  }
  return team;
}

const resolveProjects = (scope: string[], all: string[]): string[] =>
  scope.includes('*') ? [...all] : [...new Set(scope.map((s) => s.split('/')[0]).filter((p) => all.includes(p)))];

/** How specific a scope entry is for a task: 3 project/section, 2 project, 1 everything, 0 no match. */
function specificity(scope: string, project: string, section?: string): number {
  if (scope === '*') return 1;
  const [p, ...rest] = scope.split('/');
  if (p !== project) return 0;
  if (rest.length === 0) return 2;
  const want = rest.join('/').trim().toLowerCase();
  return section !== undefined && section.trim().toLowerCase().includes(want) ? 3 : 0;
}

/** Agents that cover a task, most specific first; the first is the active agent. @req FR:agent-team/agent.resolve */
export function agentFor(team: TeamAgent[], project: string, section?: string): TeamAgent[] {
  return team
    .map((a, i) => ({ a, i, s: Math.max(0, ...a.scope.map((x) => specificity(x, project, section))) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

export interface Review { at: string; verdict: 'can' | 'partial' | 'cannot'; plan: string; estimate?: string; agent: string; needs: string[] }
const VERDICT: Record<string, Review['verdict']> = { done: 'can', partial: 'partial', blocked: 'cannot' };

/** The newest review entry for a row, or null. Needs are the open ask keys the review created (`rev-<slug>-<line>-<n>`). @req FR:agent-team/review.read */
export async function reviewOf(ctx: LifecycleContext, ref: TaskRef, openAskKeys: string[] = []): Promise<Review | null> {
  const slug = logName({ path: ref.path, line: 0 });
  const want = `${ref.path}:${ref.line + 1}`;
  let best: Review | null = null;
  for (let n = 0; n < 5; n++) {
    let content: string;
    try { content = (await ctx.storage.read(`tasks/logs/${slug}${n === 0 ? '' : `.${n + 1}`}.md`)).content; } catch (e) { if (e instanceof NotFoundError) continue; throw e; }
    for (const chunk of content.split(/^## /m).slice(1)) {
      const at = chunk.split('\n')[0].trim();
      const kv = new Map([...chunk.matchAll(/^- ([a-z]+): (.*)$/gm)].map((m) => [m[1], m[2].trim()]));
      if (kv.get('ref') !== want || kv.get('action') !== 'review' || !/^\d{4}-\d\d-\d\dT/.test(at)) continue;
      if (best && best.at >= at) continue;
      const verdict = VERDICT[kv.get('outcome') ?? ''];
      if (!verdict) continue;
      const m = /^(?:can|partial|cannot): (.*?)(?: \(([^)]*)\))?$/.exec(kv.get('summary') ?? '');
      best = { at, verdict, plan: m?.[1] ?? kv.get('summary') ?? '', ...(m?.[2] ? { estimate: m[2] } : {}), agent: (kv.get('actor') ?? '').replace(/^agent:/, ''), needs: [] };
    }
  }
  if (best) { const prefix = `rev-${slug.toLowerCase()}-${ref.line + 1}-`; best.needs = openAskKeys.filter((k) => k.startsWith(prefix)); }
  return best;
}
