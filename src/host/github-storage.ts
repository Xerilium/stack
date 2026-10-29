/**
 * Task storage over the GitHub REST git data API: no git binary, no clone, no disk.
 * Reads come from a snapshot of the branch head; each write is one commit with a fast-forward-only ref update.
 * @req FR:live-deploy/gh.token @req FR:live-deploy/gh.snapshot @req FR:live-deploy/gh.fresh @req FR:live-deploy/gh.paths
 * @req FR:live-deploy/gh.write @req FR:live-deploy/gh.race @req FR:live-deploy/gh.serial @req FR:live-deploy/gh.limits
 */
import {
  ASK_PATH, ConflictError, NotFoundError, StorageError, TASK_PATH, assertDistinct, checkExpected, validateAuxPath, validatePath, versionOf,
  type AuxFiles, type FileWrite, type Storage, type StoredFile, type WriteOptions, type WriteResult,
} from '../core/storage';

export interface GitHubStorageOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Subfolder inside the repo ('' = root). */
  path?: string;
  fetch?: typeof fetch;
  /** Minimum ms between ref checks on reads. Default 5000. */
  freshMs?: number;
  /** Per call. Default 15000. */
  timeoutMs?: number;
  now?: () => number;
  author?: { name: string; email: string };
}

const API = 'https://api.github.com';
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_ATTEMPTS = 3;
const FILE = '100644';
const EXEC = '100755';

/** `https://github.com/<owner>/<repo>[.git]` -> owner and repo; anything else is null. @req FR:live-deploy/gh.select */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port || u.username || u.password || u.search || u.hash) return null;
  const m = /^\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(u.pathname);
  if (!m || !NAME.test(m[1]) || !REPO.test(m[2]) || m[2] === '.' || m[2] === '..') return null;
  return { owner: m[1], repo: m[2] };
}

/** Fixed text: status and operation only. */
class GitHubError extends StorageError {
  constructor(readonly op: string, readonly status: number) { super(`GitHub ${op} failed (${status})`); }
}

interface Entry { mode: string; sha: string; type: string }
interface Snap { commit: string; tree: string; files: Map<string, Entry> }

export class GitHubStorage implements Storage, AuxFiles {
  private snap: Snap | null = null;
  private etag: string | undefined;
  private checkedAt = -Infinity;
  private loading: Promise<Snap> | null = null;
  /** Set while the last ref check failed. */
  private failed: unknown = null;
  /** Bumped by every landed write, so an older in-flight read never replaces the write's snapshot. */
  private writes = 0;
  private readonly blobs = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly prefix: string;
  private readonly base: string;
  private readonly get: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: GitHubStorageOptions) {
    this.prefix = o.path ? `${o.path.replace(/\/+$/, '')}/` : '';
    this.base = `${API}/repos/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.repo)}/git`;
    this.get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.now = o.now ?? Date.now;
  }

  // ------------------------------------------------------------ http

  private async call(op: string, path: string, init: { method?: string; body?: unknown; etag?: string } = {}): Promise<{ status: number; data: unknown; etag: string | null }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'stack',
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.etag) headers['if-none-match'] = init.etag;
    let res: Response;
    try {
      res = await this.get(`${this.base}/${path}`, {
        method: init.method ?? 'GET', headers, redirect: 'manual',
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
      });
    } catch { throw new GitHubError(op, 0); }
    const drop = () => { void res.body?.cancel().catch(() => undefined); };
    if (res.status === 304) { drop(); return { status: 304, data: null, etag: res.headers.get('etag') }; }
    if (res.status === 422 && op === 'ref update') { drop(); return { status: 422, data: null, etag: null }; }
    if (res.status < 200 || res.status >= 300) { drop(); throw new GitHubError(op, res.status); }
    let data: unknown;
    try { data = await res.json(); } catch { throw new GitHubError(op, res.status); }
    return { status: res.status, data, etag: res.headers.get('etag') };
  }

  // ------------------------------------------------------------ snapshot

  private ref = () => `heads/${this.o.branch.split('/').map(encodeURIComponent).join('/')}`;

  /**
   * Loads the head snapshot; `force` skips the freshness window. Concurrent callers share one load,
   * except that a forced check never reuses a load that started before it (it may predate a push).
   */
  private fresh(force = false): Promise<Snap> {
    if (this.snap && !force && this.now() - this.checkedAt < (this.o.freshMs ?? 5000)) return Promise.resolve(this.snap);
    if (this.loading) return force ? this.loading.catch(() => undefined).then(() => this.fresh(true)) : this.loading;
    const p = this.load().finally(() => { this.loading = null; });
    this.loading = p;
    return p;
  }

  private async load(): Promise<Snap> {
    const seq = this.writes;
    let next: Snap | null;
    let etag: string | undefined;
    try {
      const r = await this.call('ref read', `ref/${this.ref()}`, { etag: this.snap ? this.etag : undefined });
      if (r.status === 304 && this.snap) next = this.snap;
      else {
        const sha = String((r.data as { object?: { sha?: string } }).object?.sha ?? '');
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError('ref read', r.status);
        next = this.snap?.commit === sha ? this.snap : await this.snapshot(sha);
      }
      etag = r.etag ?? undefined;
    } catch (e) {
      // A failed check (ref, commit, or tree read) keeps serving what we have to reads; rev() reports it; the next read retries.
      if (this.snap) { this.checkedAt = this.now(); this.failed = e; return this.snap; }
      throw e;
    }
    // A write that landed while this read was in flight is newer than what we read: keep it.
    if (seq !== this.writes && this.snap) return this.snap;
    this.snap = next;
    this.etag = etag;
    this.checkedAt = this.now();
    this.failed = null;
    return next;
  }

  private async snapshot(commit: string): Promise<Snap> {
    const c = (await this.call('commit read', `commits/${commit}`)).data as { tree?: { sha?: string } };
    const tree = String(c.tree?.sha ?? '');
    const t = (await this.call('tree read', `trees/${tree}?recursive=1`)).data as { tree?: { path: string; mode: string; type: string; sha: string }[]; truncated?: boolean };
    if (t.truncated) throw new StorageError('Task repo too large for one GitHub tree read (100,000 entries or 7 MB); use a smaller repo or STACK_REPO_PATH');
    const files = new Map<string, Entry>();
    for (const e of t.tree ?? []) if (e.type !== 'tree') files.set(e.path, { mode: e.mode, sha: e.sha, type: e.type });
    return { commit, tree, files };
  }

  private entry(snap: Snap, path: string): Entry | undefined {
    const e = snap.files.get(this.prefix + path);
    if (e && (e.type !== 'blob' || (e.mode !== FILE && e.mode !== EXEC))) throw new StorageError(`Refusing non-regular file in storage path: ${path}`);
    return e;
  }

  private async blob(sha: string): Promise<string> {
    const hit = this.blobs.get(sha);
    if (hit !== undefined) return hit;
    const b = (await this.call('blob read', `blobs/${sha}`)).data as { content?: string; encoding?: string };
    if (b.encoding !== 'base64' || typeof b.content !== 'string') throw new StorageError('GitHub blob read returned an unexpected encoding');
    const text = Buffer.from(b.content.replace(/\n/g, ''), 'base64').toString('utf8');
    this.blobs.set(sha, text);
    return text;
  }

  private async contentAt(snap: Snap, path: string): Promise<string | null> {
    const e = this.entry(snap, path);
    return e ? this.blob(e.sha) : null;
  }

  /** Head commit sha after a freshness check. @req FR:live-deploy/sync.route */
  async rev(): Promise<string> {
    const s = await this.fresh();
    // The probe must not read "synced" on a stale snapshot (revoked token, outage).
    if (this.failed) throw this.failed;
    return s.commit;
  }

  /** Forces a ref check now. */
  async sync(): Promise<void> { await this.fresh(true); }

  // ------------------------------------------------------------ Storage

  private rel(re: RegExp): Promise<string[]> {
    return this.fresh().then((s) => [...s.files.entries()]
      .filter(([p, e]) => p.startsWith(this.prefix) && e.type === 'blob' && (e.mode === FILE || e.mode === EXEC) && re.test(p.slice(this.prefix.length)))
      .map(([p]) => p.slice(this.prefix.length)).sort());
  }

  list(): Promise<string[]> { return this.rel(TASK_PATH); }
  listAsks(): Promise<string[]> { return this.rel(ASK_PATH); }

  async read(path: string): Promise<StoredFile> {
    validatePath(path);
    const content = await this.contentAt(await this.fresh(), path);
    if (content === null) throw new NotFoundError(`Not found: ${path}`);
    return { path, content, version: versionOf(content) };
  }

  async readAux(path: string): Promise<{ content: string; version: string } | null> {
    validateAuxPath(path);
    const content = await this.contentAt(await this.fresh(), path);
    return content === null ? null : { content, version: versionOf(content) };
  }

  async write(path: string, content: string, opts: WriteOptions = {}): Promise<WriteResult> {
    validatePath(path);
    await this.enqueue(() => this.commit([{ path, content, expectedVersion: opts.expectedVersion }], opts.message));
    return { version: versionOf(content) };
  }

  async writeAux(path: string, content: string, opts: { expectedVersion: string | null }): Promise<WriteResult> {
    validateAuxPath(path);
    await this.enqueue(() => this.commit([{ path, content, expectedVersion: opts.expectedVersion }]));
    return { version: versionOf(content) };
  }

  async writeMany(writes: FileWrite[], opts: { message?: string } = {}): Promise<void> {
    assertDistinct(writes);
    await this.enqueue(() => this.commit(writes, opts.message));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** One commit for all changed paths, retried on a moved branch. */
  private async commit(writes: FileWrite[], message?: string): Promise<void> {
    const made = new Map<string, string>(); // content -> blob sha, reused across attempts
    for (let attempt = 1; ; attempt++) {
      const head = await this.fresh(true);
      const changes: { w: FileWrite; e?: Entry }[] = [];
      for (const w of writes) {
        const e = this.entry(head, w.path);
        const cur = e ? await this.blob(e.sha) : null;
        checkExpected(w.path, cur === null ? null : versionOf(cur), { expectedVersion: w.expectedVersion });
        if (cur !== w.content) changes.push({ w, e });
      }
      if (changes.length === 0) return;
      const tree: { path: string; mode: string; type: 'blob'; sha: string | null }[] = [];
      for (const { w, e } of changes) {
        let sha: string | null = null;
        if (w.content !== null) {
          sha = made.get(w.content) ?? null;
          if (!sha) {
            sha = String(((await this.call('blob write', 'blobs', { method: 'POST', body: { content: Buffer.from(w.content, 'utf8').toString('base64'), encoding: 'base64' } })).data as { sha: string }).sha);
            made.set(w.content, sha);
            this.blobs.set(sha, w.content);
          }
        }
        tree.push({ path: this.prefix + w.path, mode: e?.mode ?? FILE, type: 'blob', sha });
      }
      const t = String(((await this.call('tree write', 'trees', { method: 'POST', body: { base_tree: head.tree, tree } })).data as { sha: string }).sha);
      const msg = message ?? (writes.length === 1 ? `Update ${writes[0].path}` : `Update ${writes.length} files`);
      const body: Record<string, unknown> = { message: msg, tree: t, parents: [head.commit] };
      if (this.o.author) body.author = this.o.author;
      const c = String(((await this.call('commit write', 'commits', { method: 'POST', body })).data as { sha: string }).sha);
      let landed: boolean;
      try {
        landed = (await this.call('ref update', `refs/${this.ref()}`, { method: 'PATCH', body: { sha: c, force: false } })).status !== 422;
      } catch (e) {
        // No answer (timeout, dropped connection): GitHub may still have applied it. Our commit at the head means it landed.
        if (!(e instanceof GitHubError) || e.status !== 0) throw e;
        if ((await this.fresh(true).catch(() => null))?.commit !== c) throw e;
        landed = true;
      }
      if (landed) {
        const files = new Map(head.files);
        for (const x of tree) { if (x.sha === null) files.delete(x.path); else files.set(x.path, { mode: x.mode, sha: x.sha, type: 'blob' }); }
        this.writes++;
        this.snap = { commit: c, tree: t, files };
        this.etag = undefined;
        this.checkedAt = this.now();
        this.failed = null;
        return;
      }
      if (attempt >= MAX_ATTEMPTS) throw new ConflictError(`Conflict on ${writes.map((w) => w.path).join(', ')}: branch kept moving (${attempt} attempts)`);
    }
  }
}
