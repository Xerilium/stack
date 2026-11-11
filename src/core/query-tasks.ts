/**
 * Query tasks: expand `🔎 @Source/id[:type] (params)` trigger tasks into script-owned `🌐` subtask lists.
 * A failing query never changes the existing list. Port of the legacy `Update-StackQueryTasks`.
 */
import { execFile } from 'child_process';
import { ConflictError, Storage } from './storage';

export type QueryKind = 'issues' | 'discussions';

/** @req FR:query-tasks/github.@function */
export interface QueryRequest { repo: string; kind: QueryKind; qualifiers: string }
/** PR review fields (`isDraft`, `reviewDecision`, `updatedAt`) are set only for pull requests. @req FR:query-tasks/github.pr */
export interface QueryItem { title: string; url: string; kind: string; isDraft?: boolean; reviewDecision?: string | null; updatedAt?: string }
export interface QueryClient { search(req: QueryRequest): Promise<QueryItem[]> }

/** @req FR:query-tasks/trigger.@function */
export interface QueryTrigger {
  /** 0-based line index. */
  line: number;
  indent: number;
  source: string;
  identifier: string;
  /** `null` when the suffix is not recognized. */
  type: QueryKind | null;
  params: string;
}

export interface QueryFailure { line: number; source: string; identifier: string; message: string }
export interface ExpandOptions { now: Date; timeZone?: string }
export interface ExpandResult { content: string; processed: number; skipped: number; failures: QueryFailure[] }

const TRIGGER = /🔎\s+@([A-Za-z0-9_-]+)\/(\S+?)(?::(\w+))?\s+\(([^)]*)\)/u;
const CHECKBOX = /^(\s*)-\s*\[[ x]\]/;
const GATE = /💤|⛔️?|🅿️|⏳/u;

/** Lines with their own endings kept, so joining them restores the input exactly. */
function splitLines(content: string): { lines: string[]; eols: string[] } {
  const parts = content.split(/(\r?\n)/);
  const lines: string[] = [];
  const eols: string[] = [];
  for (let i = 0; i < parts.length; i += 2) { lines.push(parts[i]); eols.push(parts[i + 1] ?? ''); }
  return { lines, eols };
}

/** @req FR:query-tasks/trigger.pattern @req FR:query-tasks/trigger.type */
export function findQueryTriggers(content: string): QueryTrigger[] {
  const out: QueryTrigger[] = [];
  splitLines(content).lines.forEach((text, line) => {
    const box = CHECKBOX.exec(text.replace(/^\uFEFF/, ''));
    const m = box && TRIGGER.exec(text);
    if (!box || !m) return;
    const suffix = m[3];
    const type: QueryKind | null = !suffix || suffix === 'issues' || suffix === 'prs' ? 'issues' : suffix === 'discussions' ? 'discussions' : null;
    out.push({ line, indent: box[1].length, source: m[1], identifier: m[2], type, params: m[4] });
  });
  return out;
}

/** @req FR:query-tasks/expand.timezone */
function assertTimeZone(timeZone = 'UTC'): void {
  new Intl.DateTimeFormat('en-US', { timeZone });
}

function stamp(now: Date, timeZone = 'UTC'): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', hour12: false, minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const hour = String(Number(p.hour) % 24);
  return `${p.month} ${p.day} @ ${hour}:${p.minute}`;
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function validate(items: unknown): QueryItem[] {
  if (!Array.isArray(items)) throw new Error('Query returned an unexpected response');
  return items.map((i) => {
    const o = i as Partial<QueryItem> | null;
    if (!o || typeof o.title !== 'string' || typeof o.url !== 'string' || o.url === '' || /\s/.test(o.url)) throw new Error('Query returned a malformed item');
    return { ...o, title: o.title, url: o.url, kind: typeof o.kind === 'string' ? o.kind : '' };
  });
}

const AGING_MS = 7 * 24 * 60 * 60 * 1000;

/** Legacy `Get-GitHubPullRequestTag`: status tag (first match wins), then the aging tag. @req FR:query-tasks/expand.tags */
function prTags(i: QueryItem, now: Date): string {
  if (i.kind !== 'PullRequest') return '';
  const tags: string[] = [];
  if (i.isDraft || i.reviewDecision === 'CHANGES_REQUESTED') tags.push('⏳');
  else if (i.reviewDecision === 'APPROVED') tags.push('⬆️');
  const updated = i.updatedAt ? Date.parse(i.updatedAt) : NaN;
  if (!i.isDraft && !Number.isNaN(updated) && now.getTime() - updated >= AGING_MS) tags.push('🔺');
  return tags.length ? ` ${tags.join(' ')}` : '';
}

/**
 * @req FR:query-tasks/expand.@function @req FR:query-tasks/expand.block @req FR:query-tasks/expand.kind @req FR:query-tasks/expand.none
 * @req FR:query-tasks/expand.query @req FR:query-tasks/expand.order @req FR:query-tasks/expand.gate @req FR:query-tasks/expand.eol
 * @req FR:query-tasks/expand.url @req FR:query-tasks/expand.title @req FR:query-tasks/fail.untouched @req FR:query-tasks/fail.independent
 * @req FR:query-tasks/fail.nodata-loss (every failure is caught per trigger and leaves its block and all other bytes as read)
 */
export async function expandQueryTasks(content: string, client: QueryClient, opts: ExpandOptions): Promise<ExpandResult> {
  assertTimeZone(opts.timeZone);
  const triggers = findQueryTriggers(content);
  const result: ExpandResult = { content, processed: 0, skipped: 0, failures: [] };
  if (triggers.length === 0) return result;
  const { lines, eols } = splitLines(content);

  // Bottom-up: a replacement only shifts lines below it.
  for (const t of [...triggers].sort((a, b) => b.line - a.line)) {
    if (GATE.test(lines[t.line])) { result.skipped++; continue; }
    try {
      if (t.source.toLowerCase() !== 'github') throw new Error(`Unregistered query source: ${t.source}`);
      if (!t.type) throw new Error(`Unrecognized query type suffix on @${t.source}/${t.identifier}`);
      const items = validate(await client.search({ repo: t.identifier, kind: t.type, qualifiers: t.params }));

      const pad = ' '.repeat(t.indent + 2);
      const mixed = new Set(items.map((i) => i.kind)).size > 1;
      const block = items.length === 0
        ? [`${pad}> None as of ${stamp(opts.now, opts.timeZone)}`]
        : items.map((i) => `${pad}- [ ] 🌐 ${mixed ? `[${i.kind}] ` : ''}${oneLine(i.title)}${prTags(i, opts.now)} — ${i.url}`);

      let end = t.line + 1;
      while (end < lines.length && lines[end].trim() !== '' && /^\s*/.exec(lines[end])![0].length > t.indent) end++;
      const tailEol = eols[end - 1];
      const eol = eols[t.line] || eols.find((e) => e) || '\n';
      eols[t.line] = eol;
      const newEols = block.map(() => eol);
      newEols[newEols.length - 1] = tailEol;
      lines.splice(t.line + 1, end - t.line - 1, ...block);
      eols.splice(t.line + 1, end - t.line - 1, ...newEols);
      result.processed++;
    } catch (e) {
      result.failures.push({ line: t.line, source: t.source, identifier: t.identifier, message: e instanceof Error ? e.message : String(e) });
    }
  }
  result.failures.reverse();
  result.content = lines.map((l, i) => l + eols[i]).join('');
  return result;
}

/** @req FR:query-tasks/refresh.@function */
export interface RefreshFailure extends Partial<QueryFailure> { path: string; message: string }
export interface RefreshResult { files: string[]; processed: number; skipped: number; failures: RefreshFailure[] }

/** @req FR:query-tasks/refresh.write @req FR:query-tasks/refresh.conflict (write with the read version; errors recorded per file) */
export async function refreshQueryTasks(storage: Storage, client: QueryClient, opts: ExpandOptions): Promise<RefreshResult> {
  assertTimeZone(opts.timeZone);
  const out: RefreshResult = { files: [], processed: 0, skipped: 0, failures: [] };
  const failures = out.failures;
  for (const path of (await storage.list()).filter((p) => p.endsWith('.md')).sort()) {
    try {
      const file = await storage.read(path);
      const r = await expandQueryTasks(file.content, client, opts);
      out.processed += r.processed;
      out.skipped += r.skipped;
      for (const f of r.failures) failures.push({ path, ...f });
      if (r.content !== file.content) {
        await storage.write(path, r.content, { expectedVersion: file.version });
        out.files.push(path);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ path, message: message || (e instanceof ConflictError ? 'Conflict' : 'Error') });
    }
  }
  return out;
}

// ------------------------------------------------------------------ GitHub (gh CLI)

export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const GH_TIMEOUT_MS = 60_000;

const defaultExec: Exec = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: GH_TIMEOUT_MS }, (err, stdout, stderr) => {
    if (err && (err as { killed?: boolean }).killed) return reject(new Error(`gh timed out after ${GH_TIMEOUT_MS / 1000}s`));
    if (err && typeof (err as NodeJS.ErrnoException).code !== 'number') return reject(err);
    resolve({ code: err ? ((err as NodeJS.ErrnoException).code as unknown as number) : 0, stdout, stderr });
  });
});

const PAGE = 100;
const MAX_ITEMS = 500;
const GRAPHQL = `query($searchQuery: String!, $searchType: SearchType!, $after: String) {
  search(query: $searchQuery, type: $searchType, first: ${PAGE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue { title url }
      ... on PullRequest { title url isDraft reviewDecision updatedAt }
      ... on Discussion { title url }
    }
  }
}`;

interface GhNode { __typename?: string; title?: unknown; url?: unknown; isDraft?: unknown; reviewDecision?: unknown; updatedAt?: unknown }
interface GhSearch { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: unknown }

/** @req FR:query-tasks/github.pr */
function toItem(n: GhNode): QueryItem {
  if (!n || typeof n.title !== 'string' || typeof n.url !== 'string') throw new Error('gh returned a malformed node');
  const item: QueryItem = { title: n.title, url: n.url, kind: String(n.__typename ?? '') };
  if (typeof n.isDraft === 'boolean') item.isDraft = n.isDraft;
  if (typeof n.reviewDecision === 'string' || n.reviewDecision === null) item.reviewDecision = n.reviewDecision;
  if (typeof n.updatedAt === 'string') item.updatedAt = n.updatedAt;
  return item;
}

/** @req FR:query-tasks/github.graphql @req FR:query-tasks/github.parse @req FR:query-tasks/github.inject */
export function createGhClient(exec: Exec = defaultExec): QueryClient {
  return {
    async search({ repo, kind, qualifiers }) {
      const base = ['api', 'graphql', '-f', `query=${GRAPHQL}`,
        '-f', `searchQuery=${`repo:${repo} ${qualifiers}`.trim()}`,
        '-f', `searchType=${kind === 'discussions' ? 'DISCUSSION' : 'ISSUE'}`];
      const items: QueryItem[] = [];
      let cursor: string | null = null;
      do {
        const args = cursor ? [...base, '-f', `after=${cursor}`] : base;
        let res;
        try { res = await exec('gh', args); } catch (e) {
          throw new Error(`gh CLI not available: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (res.code !== 0) throw new Error(`gh api graphql failed: ${(res.stderr || res.stdout).trim()}`);
        let json: { data?: { search?: GhSearch } };
        try { json = JSON.parse(res.stdout); } catch { throw new Error('gh returned invalid JSON'); }
        const search = json?.data?.search;
        const nodes = search?.nodes;
        if (!Array.isArray(nodes)) throw new Error(`Unexpected response from gh for ${repo}`);
        for (const n of nodes as GhNode[]) {
          if (n && typeof n === 'object' && Object.keys(n).length === 0) continue;
          if (items.length >= MAX_ITEMS) break;
          items.push(toItem(n));
        }
        cursor = search?.pageInfo?.hasNextPage && search.pageInfo.endCursor ? search.pageInfo.endCursor : null;
      } while (cursor && items.length < MAX_ITEMS);
      return items;
    },
  };
}
