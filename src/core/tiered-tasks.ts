/**
 * Tiered tasks: the lines each project owner tags with a tier goal (1️⃣ today, 2️⃣ this week, 3️⃣ this month) and an
 * `(agent: ...)`. The priorities report reads only these. Pure, except `readTieredTasks`, which only reads storage.
 * @req FR:priorities-tables/tasks.@function @req FR:priorities-tables/$tiered
 */
import type { Storage } from './storage';

export const AGENT_STATUSES = ['working', 'pairing', 'done', 'idle', 'blocked', 'queued', 'unknown'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export interface TieredTask {
  path: string; line: number; project: string; aliases: string[];
  tier: 1 | 2 | 3; text: string; agent: string | null; more: number; status: AgentStatus | null;
}

const TIERS: Record<string, 1 | 2 | 3> = { '1️⃣': 1, '2️⃣': 2, '3️⃣': 3 };
/** An optional bullet or open checkbox, then a tier. A checked box never matches. @req FR:priorities-tables/tasks.tier @req FR:priorities-tables/tasks.tier.skip */
const LINE = /^\s*(?:[-*]\s+(?:\[ \]\s+)?)?(1️⃣|2️⃣|3️⃣)\s*(.*)$/u;
const AGENT = /\(agent:\s*([^)]*)\)/i;
/** Glyph or word to status, first match wins. @req FR:priorities-tables/tasks.status */
const STATUS: [RegExp, AgentStatus][] = [[/🤝|\bpairing\b/iu, 'pairing'], [/🔄/u, 'working'], [/🚫|🔴/u, 'blocked'], [/⏸️?/u, 'idle'], [/🕓/u, 'queued'], [/✅/u, 'done']];
const GLYPHS = /\s*(?:🤝|🔄|🚫|🔴|⏸️?|🕓|✅)\s*/gu;
const EMOJI = /^[\p{Extended_Pictographic}\p{Regional_Indicator}️‍\s]+/u;

/**
 * The agent: the text up to the first `,`, `;` or `)`; each more name after a `+` or `,` counts as one more.
 * @req FR:priorities-tables/tasks.agent
 */
function agentOf(text: string): { agent: string | null; more: number } {
  const m = AGENT.exec(text);
  if (!m) return { agent: null, more: 0 };
  const body = m[1];
  const agent = body.split(/[,;]/)[0].trim();
  // `+2 PR agents: a, b` counts 2; else each extra comma-separated name counts 1.
  const plus = /\+\s*(\d+)/.exec(body);
  const more = plus ? Number(plus[1]) : body.split(';')[0].split(',').slice(1).filter((s) => s.trim()).length;
  return { agent: agent || null, more };
}

/**
 * Every tiered task in one task file, in file order.
 * @req FR:priorities-tables/tasks.tier @req FR:priorities-tables/tasks.tier.goal @req FR:priorities-tables/tasks.tier.skip @req FR:priorities-tables/tasks.agent
 * @req FR:priorities-tables/tasks.status @req FR:priorities-tables/tasks.text @req FR:priorities-tables/tasks.project
 */
export function tieredTasks(path: string, src: string): TieredTask[] {
  const lines = src.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).replace(EMOJI, '').trim();
  const project = title || (path.split('/').pop() ?? path).replace(/\.md$/, '');
  const al = lines.map((l) => /^- \*\*Aliases:\*\*\s*(.*)$/.exec(l)).find(Boolean);
  const aliases = al ? al[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const out: TieredTask[] = [];
  lines.forEach((l, line) => {
    if (/^\s*#/.test(l)) return;
    const m = LINE.exec(l);
    if (!m) return;
    const rest = m[2];
    const { agent, more } = agentOf(rest);
    const status = agent ? (STATUS.find(([re]) => re.test(rest))?.[1] ?? 'unknown') : null;
    const text = rest.replace(AGENT, ' ').replace(GLYPHS, ' ').replace(/\s+/g, ' ').trim();
    out.push({ path, line, project, aliases, tier: TIERS[m[1]], text, agent, more, status });
  });
  return out;
}

/**
 * Tiered tasks from every project file (`tasks/*.md`; `list()` leaves out asks, agents and other folders). Read only.
 * @req FR:priorities-tables/tasks.store
 */
export async function readTieredTasks(storage: Pick<Storage, 'list' | 'read'>): Promise<TieredTask[]> {
  const paths = await storage.list();
  const files = await Promise.all(paths.map(async (p) => { try { return await storage.read(p); } catch { return undefined; } }));
  return files.flatMap((f) => (f ? tieredTasks(f.path, f.content) : []));
}
