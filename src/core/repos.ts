/**
 * Which Stack project owns a repo folder: the project's name, its `Aliases`, its `Repository` link and its `Repos` list name the folders,
 * and a worktree checkout counts as its repo.
 * @req FR:agent-sessions/sessions.owner @req FR:agent-sessions/sessions.owner.repos @req FR:agent-sessions/sessions.owner.worktree
 */
import type { LifecycleContext } from './lifecycle';
import { parseProject } from './parser';

/** One project and every folder name that belongs to it (the project name first). */
export interface RepoEntry { project: string; names: string[] }
export type RepoMap = RepoEntry[];

const norm = (s: string) => s.toLowerCase().replace(/_/g, '-');

/** The repo folder a path works in: `<repo>/.claude/worktrees/<x>`, `<repo>.worktrees/<x>` and `<repo>-wt-<x>` all report `<repo>`, from any depth. @req FR:agent-sessions/sessions.owner.worktree */
export function repoOf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  const i = parts.indexOf('.claude');
  if (i > 0 && parts[i + 1] === 'worktrees') return parts[i - 1];
  const wt = parts.findIndex((p) => p.endsWith('.worktrees'));
  if (wt >= 0) return parts[wt].slice(0, -'.worktrees'.length);
  const wtd = parts.findIndex((p) => /-wt-[^/]+$/.test(p));
  return (wtd >= 0 ? parts[wtd] : (parts[parts.length - 1] ?? '')).replace(/-wt-[^/]+$/, '');
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');
/** `owner/name`, a GitHub url, or a bare folder name → the folder name. */
const folderOf = (raw: string): string => {
  const s = raw.trim().replace(/^\[([^\]]*)\]\([^)]*\)$/, '$1').replace(/^`|`$/g, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return s.slice(s.lastIndexOf('/') + 1).trim();
};

/** Every project's folder names from its metadata, in project order. @req FR:agent-sessions/sessions.owner.repos */
export async function projectRepos(ctx: Pick<LifecycleContext, 'storage'>): Promise<RepoMap> {
  const out: RepoMap = [];
  for (const path of await ctx.storage.list()) {
    const name = baseName(path);
    if (/^readme$/i.test(name)) continue;
    const p = parseProject((await ctx.storage.read(path)).content);
    const names = [name];
    const add = (v: string) => { const f = folderOf(v); if (f && !names.includes(f)) names.push(f); };
    (p.metadata['Aliases'] ?? '').split(',').forEach(add);
    if (p.metadata['Repository']) add(p.metadata['Repository']);
    (p.metadata['Repos'] ?? '').split(',').forEach(add);
    // Nested list items right under `- **Repos:**`.
    const at = p.lines.findIndex((l) => /^- \*\*Repos:\*\*/.test(l));
    if (at >= 0) for (let i = at + 1; i < p.lines.length && /^\s+- /.test(p.lines[i]); i++) add(p.lines[i].replace(/^\s+- /, ''));
    out.push({ project: name, names });
  }
  return out;
}

/** The project that owns a repo folder: equal to one of its names, or `<name>-…`; the longest name wins, then the first project. @req FR:agent-sessions/sessions.owner.repos */
export function ownerOf(folder: string, map: RepoMap): string | null {
  const f = norm(folder);
  if (!f) return null;
  let best: { project: string; len: number } | null = null;
  for (const e of map) {
    for (const n of e.names) {
      const k = norm(n);
      if (!k || !(f === k || f.startsWith(`${k}-`))) continue;
      if (!best || k.length > best.len) best = { project: e.project, len: k.length };
    }
  }
  return best?.project ?? null;
}
