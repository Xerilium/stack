/**
 * The whole team outside the content repo: `~/.claude/agents/*.md` and `<root>/<repo>/.claude/agents/*.md`, read-only and frontmatter only.
 * @req FR:agent-team/agent.team.scan
 */
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { parseClaudeAgent, type AgentDef, type ScannedAgent } from './agents';
import { ownerOf, repoOf, type RepoMap } from './repos';

export interface ScanOptions {
  home: string;
  /** Folders whose child repos are scanned; default `~/dev`. A leading `~/` is the home folder. */
  roots?: string[];
  /** Repo folders to leave out (the content repo, already read through storage). */
  skip?: string[];
  /** Folder → Stack project. */
  repos?: RepoMap;
}

const MAX_FOLDERS = 400;
const MAX_FILES = 50;
const HEAD_BYTES = 8192;
const FILE = /^(?![Rr][Ee][Aa][Dd][Mm][Ee]\.md$)[a-z0-9][a-z0-9._-]{0,39}\.md$/;
const cache = new Map<string, { mtimeMs: number; size: number; def: AgentDef | null }>();

const dirents = async (dir: string) => { try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; } };

/** The frontmatter block alone (never the body), or null when the file has none in its first 8 KB. */
async function frontmatter(path: string): Promise<string | null> {
  const h = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await h.read(buf, 0, HEAD_BYTES, 0);
    const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(buf.subarray(0, bytesRead).toString('utf8'));
    return m ? m[0] : null;
  } finally { await h.close(); }
}

async function readDef(path: string, slug: string): Promise<AgentDef | null> {
  let st;
  try { st = await fs.stat(path); } catch { return null; }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.def;
  let def: AgentDef | null = null;
  try { const fm = await frontmatter(path); def = fm ? parseClaudeAgent(slug, fm) : null; } catch { def = null; }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, def });
  return def;
}

async function agentsIn(dir: string, home: string, out: ScannedAgent[]): Promise<void> {
  const files = (await dirents(dir)).filter((e) => e.isFile() && FILE.test(e.name)).map((e) => e.name).sort().slice(0, MAX_FILES);
  for (const f of files) {
    const def = await readDef(join(dir, f), f.slice(0, -3));
    if (def) out.push({ def, home });
  }
}

/** User-level agents first, then each repo one level under each root (sorted); hidden and worktree folders are skipped. */
export async function scanAgents(o: ScanOptions): Promise<ScannedAgent[]> {
  const out: ScannedAgent[] = [];
  await agentsIn(join(o.home, '.claude/agents'), 'user', out);
  const skip = new Set((o.skip ?? []).map((p) => resolve(p)));
  const roots = (o.roots ?? [join(o.home, 'dev')]).map((r) => resolve(r.startsWith('~/') ? join(o.home, r.slice(2)) : r));
  const known = new Set((o.repos ?? []).flatMap((e) => e.names.map((n) => n.toLowerCase())));
  let seen = 0;
  for (const root of roots) {
    const kids = (await dirents(root)).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('.worktrees') && repoOf(e.name) === e.name).map((e) => e.name)
      // A folder named exactly as a known repo goes first, so its copy (not a clone like `finops-hubs-1020`) sets the home.
      .sort((x, y) => Number(!known.has(x)) - Number(!known.has(y)) || x.localeCompare(y));
    for (const name of kids) {
      if (seen++ >= MAX_FOLDERS) return out;
      if (skip.has(join(root, name))) continue;
      await agentsIn(join(root, name, '.claude/agents'), (o.repos && ownerOf(name, o.repos)) || name, out);
    }
  }
  return out;
}
