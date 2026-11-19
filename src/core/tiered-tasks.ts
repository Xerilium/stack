/**
 * Tiered tasks: the lines each project owner tags with a tier goal (1️⃣ today, 2️⃣ this week, 3️⃣ this month) and an
 * `(agent: ...)`. The priorities report reads only these. Pure, except `readTaskFiles`, which only reads storage.
 * @req FR:priorities-tables/tasks.@function @req FR:priorities-tables/$tiered
 */
import type { Storage } from './storage';

export const AGENT_STATUSES = ['working', 'pairing', 'done', 'idle', 'blocked', 'queued', 'unknown'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export interface TieredTask {
  path: string; line: number; project: string; aliases: string[];
  tier: 1 | 2 | 3; text: string; agent: string | null; more: number; status: AgentStatus | null;
  /** The project repo (`owner/repo`) from `**Repository:**`, or null. */
  repo: string | null;
}
/** A project file: its path, name, aliases and repo. */
export interface ProjectFile { path: string; project: string; aliases: string[]; repo: string | null }

/** The GitHub URL of an issue or PR; GitHub sends an issue URL on to the PR. */
const refUrl = (repo: string, n: string) => `https://github.com/${repo}/issues/${n}`;
export const NO_LINK = '⚠ no link';
/**
 * Every PR or issue mention becomes a full markdown link: `#12`, `PR 12`, `PRs 12, 13`, `issue 12`. Existing links and URLs stay.
 * With no repo, each mention gets the gap marker `⚠ no link`.
 * @req FR:priorities-tables/tasks.refs @req FR:priorities-tables/tasks.refs.gap
 */
export function linkRefs(text: string, repo: string | null): string {
  // Split out markdown links and bare URLs; only plain text changes.
  return text.split(/(\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/g).map((part, i) => {
    if (i % 2) return part;
    const one = (n: string, label: string) => (repo ? `[${label}](${refUrl(repo, n)})` : `${label} ${NO_LINK}`);
    return part
      .replace(/\b(PRs?|[Ii]ssues?)(\s+)(#?\d+(?:\s*(?:,|and|\/)\s*#?\d+)*)/g, (_m, word: string, sp: string, list: string) =>
        `${word}${sp}${list.replace(/#?(\d+)/g, (x: string, n: string) => one(n, x.replace('#', '')))}`)
      .replace(/(^|[^\w[/])#(\d+)\b/g, (_m, pre: string, n: string) => `${pre}${one(n, n)}`);
  }).join('');
}

/** Name, aliases and repo of one project file. @req FR:priorities-tables/tasks.project */
export function projectFile(path: string, src: string): ProjectFile {
  const lines = src.replace(/^\uFEFF/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).replace(EMOJI, '').trim();
  const project = title || (path.split('/').pop() ?? path).replace(/\.md$/, '');
  const al = lines.map((l) => /^- \*\*Aliases:\*\*\s*(.*)$/.exec(l)).find(Boolean);
  const aliases = al ? al[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const rp = lines.map((l) => /^- \*\*Repository:\*\*.*?github\.com\/([\w.-]+\/[\w.-]+)/.exec(l)).find(Boolean);
  return { path, project, aliases, repo: rp ? rp[1].replace(/\.git$/, '') : null };
}

export const TIERS: Record<string, 1 | 2 | 3> = { '1️⃣': 1, '2️⃣': 2, '3️⃣': 3 };
/** An optional bullet or open checkbox, then a tier. A checked box never matches. @req FR:priorities-tables/tasks.tier @req FR:priorities-tables/tasks.tier.skip */
const LINE = /^\s*(?:[-*]\s+(?:\[ \]\s+)?)?(1️⃣|2️⃣|3️⃣)\s*(.*)$/u;
export const AGENT_TAG = /\(agent:\s*([^)]*)\)/i;
/** Glyph or word to status, first match wins. @req FR:priorities-tables/tasks.status */
const STATUS: [RegExp, AgentStatus][] = [[/🤝|\bpairing\b/iu, 'pairing'], [/🔄/u, 'working'], [/🚫|🔴/u, 'blocked'], [/⏸️?/u, 'idle'], [/🕓/u, 'queued'], [/✅/u, 'done']];
const GLYPHS = /\s*(?:🤝|🔄|🚫|🔴|⏸️?|🕓|✅)\s*/gu;
const EMOJI = /^[\p{Extended_Pictographic}\p{Regional_Indicator}️‍\s]+/u;

/**
 * The agent: the text up to the first `,`, `;` or `)`; each more name after a `+` or `,` counts as one more.
 * @req FR:priorities-tables/tasks.agent
 */
function agentOf(text: string): { agent: string | null; more: number } {
  const m = AGENT_TAG.exec(text);
  if (!m) return { agent: null, more: 0 };
  const body = m[1];
  const names = body.split(';')[0];
  const agent = names.split(/[,+]/)[0].trim();
  // `+2 PR agents: a, b` counts 2; else each extra name after a `,` or `+` counts 1.
  const plus = /\+\s*(\d+)/.exec(names);
  const more = plus ? Number(plus[1]) : names.split(/[,+]/).slice(1).filter((s) => s.trim()).length;
  return { agent: agent || null, more };
}

/**
 * Every tiered task in one task file, in file order.
 * @req FR:priorities-tables/tasks.tier @req FR:priorities-tables/tasks.tier.goal @req FR:priorities-tables/tasks.tier.skip @req FR:priorities-tables/tasks.agent
 * @req FR:priorities-tables/tasks.status @req FR:priorities-tables/tasks.text @req FR:priorities-tables/tasks.project
 */
export function tieredTasks(path: string, src: string): TieredTask[] {
  const lines = src.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const { project, aliases, repo } = projectFile(path, src);
  const out: TieredTask[] = [];
  lines.forEach((l, line) => {
    if (/^\s*#/.test(l)) return;
    const m = LINE.exec(l);
    if (!m) return;
    const rest = m[2];
    const { agent, more } = agentOf(rest);
    const status = agent ? (STATUS.find(([re]) => re.test(rest))?.[1] ?? 'unknown') : null;
    const text = linkRefs(rest.replace(AGENT_TAG, ' ').replace(GLYPHS, ' ').replace(/\s+/g, ' ').trim(), repo);
    out.push({ path, line, project, aliases, tier: TIERS[m[1]], text, agent, more, status, repo });
  });
  return out;
}

/**
 * The task files: tiered tasks, every project file and every agent file (`tasks/agents/`, `.claude/agents/`). Read only.
 * @req FR:priorities-tables/tasks.store @req FR:priorities-tables/agent.file @req FR:priorities-tables/rows.file
 */
export async function readTaskFiles(storage: Pick<Storage, 'list' | 'read' | 'listAgents' | 'listClaudeAgents'>): Promise<{ tasks: TieredTask[]; files: ProjectFile[]; agents: string[] }> {
  const paths = await storage.list();
  const read = await Promise.all(paths.map(async (p) => { try { return await storage.read(p); } catch { return undefined; } }));
  const ok = read.filter((f): f is NonNullable<typeof f> => !!f);
  const list = async (f?: () => Promise<string[]>) => { try { return f ? await f.call(storage) : []; } catch { return []; } };
  const agents = [...await list(storage.listAgents), ...await list(storage.listClaudeAgents)];
  return { tasks: ok.flatMap((f) => tieredTasks(f.path, f.content)), files: ok.map((f) => projectFile(f.path, f.content)), agents };
}
