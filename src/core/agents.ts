/**
 * Agent definitions at the project folder level: one file per agent (`tasks/agents/<slug>.md`) with a scope of project or project/section prefixes,
 * plus the agents a project names in its `Agents` metadata. Resolves which agent is active for a task and reads the newest review of a row.
 * Claude's own definitions (`.claude/agents/<slug>.md`) join the team read-only; every agent reports to someone (`reports-to`, else the narrowest agent
 * whose projects strictly contain its own, else the roll-up), and the roll-up (scope `*`; `cos` by convention) is first on every task.
 * @req FR:agent-team/agent.path @req FR:agent-team/agent.path.claude @req FR:agent-team/agent.format @req FR:agent-team/agent.format.claude @req FR:agent-team/agent.team @req FR:agent-team/agent.resolve @req FR:agent-team/review.read
 */
import { LifecycleError, type LifecycleContext, type TaskRef } from './lifecycle';
import { parseProject } from './parser';
import { NotFoundError } from './storage';
import { logName, redact } from './triage';

export const AGENT_MODES = ['long-running', 'ad-hoc'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export type AgentSource = 'stack' | 'claude' | 'metadata';
export interface AgentDef {
  slug: string; name: string; role?: string; scope: string[]; model?: string; tools?: string[]; mode: AgentMode;
  /** Slug of the agent this one reports to (`reports-to`). @req FR:agent-team/agent.team.reports */
  reportsTo?: string;
  /** Avatar: an emoji, `fluent:<name>`, or an image path on the Stack web origin (`/agents/cid.png`). Absent: a monogram. @req FR:agent-team/agent.icon */
  icon?: string;
  /** System prompt addition (`## Prompt`). */
  prompt: string;
  /** Lines this version does not know; kept as is. */
  extra: string[];
}
/** @req FR:agent-team/$team-agent */
export interface TeamAgent extends Omit<AgentDef, 'extra'> {
  /** True when a definition file exists (Stack or Claude). */
  defined: boolean;
  /** Where the agent is defined. @req FR:agent-team/agent.team */
  source: AgentSource;
  /** Projects the scope resolves to (`*` lists every project). */
  projects: string[];
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const HEADER = '<!-- stack-agent v1. Scope is a list of project or project/section prefixes; `*` is everything. -->';
const FIELDS = ['name', 'role', 'scope', 'reports-to', 'model', 'tools', 'mode', 'icon'] as const;
/** An emoji (at most 16 code units, no letters, digits, spaces, or slashes), a Fluent Emoji name (`fluent:headphone`), or a same-origin image path; anything else is dropped. @req FR:agent-team/agent.icon */
export const iconOk = (v: string): boolean =>
  /^fluent:[a-z0-9_]{1,60}$/.test(v) || (v.length > 0 && v.length <= 16 && !/[\s\p{L}\p{N}/\\<>"'`]/u.test(v) && /[^\x20-\x7e]/.test(v)) || (/^\/(?!\/)[A-Za-z0-9._/-]{1,200}\.(?:png|jpe?g|gif|webp|svg)$/i.test(v) && !v.includes('..'));
/** Every agent named `cos` is the roll-up unless it says otherwise. @req FR:agent-team/agent.team.rollup */
const ROLLUP_SLUG = 'cos';
const MAX_ROLE = 80;
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const MAX_NAME = 60;
const MAX_PROMPT = 20_000;

export function agentsPath(slug: string): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new LifecycleError('Invalid agent slug (lower case letters, digits, . _ -; up to 40)');
  return `tasks/agents/${slug}.md`;
}
/** @req FR:agent-team/agent.path.claude */
export function claudeAgentsPath(slug: string): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new LifecycleError('Invalid agent slug (lower case letters, digits, . _ -; up to 40)');
  return `.claude/agents/${slug}.md`;
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
    ['name', a.name], ['role', a.role], ['scope', a.scope.join(', ')], ['reports-to', a.reportsTo], ['model', a.model], ['tools', a.tools?.join(', ')], ['mode', a.mode], ['icon', a.icon],
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
    const m = /^- ([a-z-]+): (.*)$/.exec(line);
    if (!m || !(FIELDS as readonly string[]).includes(m[1])) { if (line.startsWith('- ')) a.extra.push(line); continue; }
    const v = oneLine(m[2]);
    switch (m[1]) {
      case 'name': if (v && v.length <= MAX_NAME) a.name = v; break;
      case 'role': if (v) a.role = v; break;
      case 'scope': a.scope = v.split(',').map((s) => s.trim()).filter((s) => s && scopeOk(s)); break;
      case 'reports-to': if (SLUG.test(v)) a.reportsTo = v; break;
      case 'model': if (/^[A-Za-z0-9._-]{1,80}$/.test(v)) a.model = v; break;
      case 'tools': a.tools = v.split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'mode': if ((AGENT_MODES as readonly string[]).includes(v)) a.mode = v as AgentMode; break;
      case 'icon': if (iconOk(v)) a.icon = v; break;
    }
  }
  a.prompt = prompt.join('\n').trim().slice(0, MAX_PROMPT);
  return a;
}

/**
 * Claude's format: YAML frontmatter (`name`, `description`, `tools`, `model`, and Stack's `scope`, `reports-to`, `mode`) over a markdown body that is the prompt.
 * The display name is the first H1 (before a `:`), else the frontmatter name; the role is the description's first sentence.
 * @req FR:agent-team/agent.format.claude
 */
export function parseClaudeAgent(slug: string, content: string): AgentDef {
  const a: AgentDef = { slug, name: slug, scope: [], mode: 'ad-hoc', prompt: '', extra: [] };
  let body = content;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (fm) {
    body = content.slice(fm[0].length);
    // Fold YAML continuation lines onto their key, so `description: >` (a block scalar), a wrapped quoted string, or a `- item` list (indented or not) never reads as `>`, its first line, or nothing.
    let inList = false;
    const folded = fm[1].replace(/\r/g, '').split('\n').reduce<string[]>((out, raw) => {
      const prev = out[out.length - 1];
      // An unindented `- item` continues a list too: most YAML emitters write `tools:\n- Read\n- Grep` at the key's own indent.
      const item = /^\s*- /.test(raw) && prev !== undefined && (inList || /:\s*$/.test(prev));
      if (prev !== undefined && (item || /^\s+\S/.test(raw))) { const t = raw.trim(); out[out.length - 1] = t.startsWith('- ') ? `${prev}${/:\s*$/.test(prev) ? ' ' : ', '}${t.slice(2)}` : `${prev} ${t}`; inList = t.startsWith('- '); }
      else { inList = false; out.push(raw.replace(/^([A-Za-z][A-Za-z0-9_-]*):\s*[>|][+-]?\s*$/, '$1:')); }
      return out;
    }, []);
    for (const raw of folded) {
      const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
      if (!m) continue;
      const v = oneLine(m[2].replace(/^(["'])(.*)\1$/, '$2'));
      switch (m[1]) {
        case 'name': if (v && v.length <= MAX_NAME) a.name = v; break;
        case 'description': { const first = (/^(.*?[.!?])(\s|$)/.exec(v)?.[1] ?? v).replace(/[.]$/, ''); if (first) a.role = first.length > MAX_ROLE ? `${first.slice(0, MAX_ROLE - 1)}…` : first; break; }
        case 'tools': a.tools = v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean); break;
        case 'model': if (/^[A-Za-z0-9._-]{1,80}$/.test(v)) a.model = v; break;
        case 'scope': a.scope = v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter((s) => s && scopeOk(s)); break;
        case 'reports-to': case 'reportsTo': if (SLUG.test(v)) a.reportsTo = v; break;
        case 'mode': if ((AGENT_MODES as readonly string[]).includes(v)) a.mode = v as AgentMode; break;
        case 'icon': if (iconOk(v)) a.icon = v; break;
      }
    }
  }
  const h1 = /^#[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(body.trimStart())?.[1]; // only a title that opens the body, never a `#` inside a code block
  if (h1) { const n = oneLine(h1.split(':')[0]); if (n && n.length <= MAX_NAME) a.name = n; }
  a.prompt = body.trim().slice(0, MAX_PROMPT);
  return a;
}

export interface AgentPut { name?: string; role?: string; scope?: string[]; reportsTo?: string; model?: string; tools?: string[]; mode?: AgentMode; prompt?: string }

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
  if (input.reportsTo !== undefined) { if (!SLUG.test(input.reportsTo)) throw new LifecycleError('reports-to must be an agent slug'); next.reportsTo = input.reportsTo; }
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
    // A backticked token is the name (`Subagent \`allyte-cos\`` names allyte-cos); otherwise the whole head is.
    const head = m?.[1] ?? s;
    const name = oneLine(/`([^`]+)`/.exec(head)?.[1] ?? head.replace(/`/g, ''));
    if (!name) return;
    out.push({ name: name.slice(0, MAX_NAME), ...(m?.[2]?.trim() ? { role: oneLine(m[2]) } : {}) });
  };
  if (value && value.trim()) value.split(/,\s*(?=`|[^\s])/).forEach(add); // inline list on the metadata line
  items.forEach(add);
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');

/**
 * Every agent: Stack files (file order), then Claude files (file order; a slug both define keeps the Stack file), then agents named only in
 * project metadata (project order). `cos` with no scope is `*`. Then the reporting line.
 * @req FR:agent-team/agent.team @req FR:agent-team/agent.team.order @req FR:agent-team/agent.team.rollup @req FR:agent-team/agent.team.reports
 */
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
  const addFile = (a: AgentDef, source: AgentSource) => {
    if (team.some((t) => t.slug === a.slug)) return;
    const named = projects.filter((p) => p.agents.some((x) => slugOf(x.name) === a.slug || x.name === a.name)).map((p) => p.name);
    // `cos` with no scope line is the roll-up even when a project line names a `CoS` of its own (that line then merges into the roll-up).
    const scope = a.scope.length ? a.scope : a.slug === ROLLUP_SLUG ? ['*'] : named;
    const { extra, ...rest } = a; void extra;
    team.push({ ...rest, scope, defined: true, source, projects: resolveProjects(scope, all) });
  };
  for (const path of ctx.storage.listAgents ? await ctx.storage.listAgents() : []) addFile(parseAgent(baseName(path), (await ctx.storage.read(path)).content), 'stack');
  for (const path of ctx.storage.listClaudeAgents ? await ctx.storage.listClaudeAgents() : []) addFile(parseClaudeAgent(baseName(path), (await ctx.storage.read(path)).content), 'claude');
  for (const p of projects) {
    for (const x of p.agents) {
      const slug = slugOf(x.name);
      const have = team.find((t) => t.slug === slug || t.name === x.name);
      if (have) { if (!have.defined && !have.scope.includes(p.name)) { have.scope.push(p.name); have.projects = resolveProjects(have.scope, all); } continue; }
      team.push({ slug, name: x.name, ...(x.role ? { role: x.role } : {}), scope: [p.name], mode: 'ad-hoc', prompt: '', defined: false, source: 'metadata', projects: [p.name] });
    }
  }
  return withReports(team);
}

/** The first agent whose scope is `*`. @req FR:agent-team/agent.team.rollup */
export const rollupOf = (team: TeamAgent[]): TeamAgent | undefined => team.find((a) => a.scope.includes('*'));

/**
 * Every agent's manager: its `reports-to` when that slug exists, else the narrowest other defined agent whose projects strictly contain its own,
 * else the roll-up; the roll-up reports to no one. A cycle breaks at its first member in team order, which reports to the roll-up.
 * @req FR:agent-team/agent.team.reports
 */
function withReports(team: TeamAgent[]): TeamAgent[] {
  const rollup = rollupOf(team);
  const contains = (outer: TeamAgent, inner: TeamAgent) => inner.projects.length > 0 && outer.projects.length > inner.projects.length && inner.projects.every((p) => outer.projects.includes(p));
  for (const a of team) {
    if (a === rollup) { delete a.reportsTo; continue; }
    const explicit = a.reportsTo && a.reportsTo !== a.slug ? team.find((t) => t.slug === a.reportsTo) : undefined;
    // Only an agent with a definition file manages by default: a metadata line naming a broad worker (a PR sweeper) is not a manager.
    // A second `*` agent is not a manager by default either: only the roll-up manages everyone.
    const manager = explicit ?? team.filter((t) => t !== a && t !== rollup && t.defined && !t.scope.includes('*') && contains(t, a)).sort((x, y) => x.projects.length - y.projects.length)[0] ?? rollup;
    if (manager) a.reportsTo = manager.slug; else delete a.reportsTo;
  }
  // Cycles: walk up from each agent; the first member (team order) of a cycle reports to the roll-up.
  const index = new Map(team.map((a, i) => [a.slug, i]));
  for (const a of team) {
    const seen = new Set<string>();
    let cur: TeamAgent | undefined = a;
    while (cur && cur.reportsTo && !seen.has(cur.slug)) { seen.add(cur.slug); cur = team.find((t) => t.slug === cur!.reportsTo); }
    if (!cur || !cur.reportsTo || !seen.has(cur.slug)) continue;
    // cur is on the cycle: collect it
    const cycle: TeamAgent[] = []; let c: TeamAgent | undefined = cur;
    do { cycle.push(c); c = team.find((t) => t.slug === c!.reportsTo); } while (c && c !== cur);
    const first = cycle.sort((x, y) => (index.get(x.slug) ?? 0) - (index.get(y.slug) ?? 0))[0];
    if (rollup && first !== rollup) first.reportsTo = rollup.slug; else delete first.reportsTo;
  }
  return team;
}

const resolveProjects = (scope: string[], all: string[]): string[] =>
  scope.includes('*') ? [...all] : [...new Set(scope.map((s) => s.split('/')[0]).filter((p) => all.includes(p)))];

/** Whole words of a heading after its emoji; a scope matches when its words are the heading's first words (`Do` never covers `Done`). */
const words = (h: string) => h.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').split(/\s+/).filter(Boolean);
const wordPrefix = (scope: string, heading: string) => { const a = words(scope), b = words(heading); return a.length > 0 && a.length <= b.length && a.every((w, i) => w === b[i]); };
/** How specific a scope entry is for a task: 3 project/section, 2 project, 1 everything, 0 no match. */
function specificity(scope: string, project: string, section?: string): number {
  if (scope === '*') return 1;
  const [p, ...rest] = scope.split('/');
  if (p !== project) return 0;
  if (rest.length === 0) return 2;
  // A section scope matches the heading's words after its emoji (`Labels` covers `🏷️ Labels`, not `Done`).
  const want = rest.join('/').trim().toLowerCase();
  return section !== undefined && wordPrefix(want, section) ? 3 : 0;
}

/** Agents that cover a task: the roll-up first, then most specific first; the first is the active agent. @req FR:agent-team/agent.resolve */
export function agentFor(team: TeamAgent[], project: string, section?: string): TeamAgent[] {
  const rollup = rollupOf(team);
  return team
    .map((a, i) => ({ a, i, s: a === rollup ? 4 : Math.max(0, ...a.scope.map((x) => specificity(x, project, section))) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

export interface Review { at: string; verdict: 'can' | 'partial' | 'cannot'; plan: string; estimate?: string; agent: string; needs: string[] }
const VERDICT: Record<string, Review['verdict']> = { done: 'can', partial: 'partial', blocked: 'cannot' };

/** The ask key prefix of a row's review needs: `rev-<slug>-<line>-` (the slug is cut to 40 so `rev-<slug>-<line>-<stamp>-<n>` fits an 80-character key). @req FR:agent-team/review.needs */
export const reviewPrefix = (ref: TaskRef): string => `rev-${logName({ path: ref.path, line: 0 }).toLowerCase().slice(0, 40)}-${ref.line + 1}-`;

/** The newest review entry per row (0-based line) in a project's log files, one pass. @req FR:agent-team/review.read */
export async function reviewsIn(ctx: LifecycleContext, path: string): Promise<Map<number, Review>> {
  const slug = logName({ path, line: 0 });
  const prefix = `${path}:`;
  const best = new Map<number, Review>();
  for (let n = 0; n < 5; n++) {
    let content: string;
    try { content = (await ctx.storage.read(`tasks/logs/${slug}${n === 0 ? '' : `.${n + 1}`}.md`)).content; } catch (e) { if (e instanceof NotFoundError) continue; throw e; }
    for (const chunk of content.split(/^## /m).slice(1)) {
      const at = chunk.split('\n')[0].trim();
      const kv = new Map([...chunk.matchAll(/^- ([a-z]+): (.*)$/gm)].map((m) => [m[1], m[2].trim()]));
      const ref = kv.get('ref') ?? '';
      if (!ref.startsWith(prefix) || kv.get('action') !== 'review' || !/^\d{4}-\d\d-\d\dT/.test(at)) continue;
      const line = Number(ref.slice(prefix.length)) - 1;
      if (!Number.isInteger(line) || line < 0) continue;
      const cur = best.get(line);
      if (cur && cur.at >= at) continue;
      const verdict = VERDICT[kv.get('outcome') ?? ''];
      if (!verdict) continue;
      const m = /^(?:can|partial|cannot): (.*?)(?: \(([^)]*)\))?$/.exec(kv.get('summary') ?? '');
      best.set(line, { at, verdict, plan: m?.[1] ?? kv.get('summary') ?? '', ...(m?.[2] ? { estimate: m[2] } : {}), agent: (kv.get('actor') ?? '').replace(/^agent:/, ''), needs: [] });
    }
  }
  return best;
}

/** The newest review entry for a row, or null. Needs are the open ask keys the review created (`rev-<slug>-<line>-`). @req FR:agent-team/review.read */
export async function reviewOf(ctx: LifecycleContext, ref: TaskRef, openAskKeys: string[] = []): Promise<Review | null> {
  const best = (await reviewsIn(ctx, ref.path)).get(ref.line) ?? null;
  if (best) { const prefix = reviewPrefix(ref); best.needs = openAskKeys.filter((k) => k.startsWith(prefix)); }
  return best;
}
