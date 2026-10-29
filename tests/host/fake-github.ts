/**
 * In-memory stand-in for the GitHub git data REST endpoints GitHubStorage uses.
 * Objects are content-addressed (sha1 of their JSON), like git, so equal trees share a sha.
 */
import { createHash } from 'crypto';

type Entry = { mode: string; sha: string };
type Obj = { type: 'blob'; content: Buffer } | { type: 'tree'; files: Map<string, Entry> } | { type: 'commit'; tree: string; parents: string[]; message: string; author?: unknown };

export interface Call { method: string; path: string; headers: Record<string, string> }

export class FakeGitHub {
  readonly objects = new Map<string, Obj>();
  readonly refs = new Map<string, string>();
  readonly calls: Call[] = [];
  /** Runs once, just before the next ref update is applied (to simulate a concurrent push). */
  beforeRefUpdate?: () => void;
  /** Answer every call with this status (outage, bad token). */
  failWith?: number;
  truncated = false;

  constructor(readonly owner = 'acme', readonly repo = 'tasks', files: Record<string, string> = { 'README.md': 'x' }, branch = 'main') {
    this.refs.set(branch, this.commitFiles(files, [], 'init'));
  }

  private put(o: Obj): string {
    const key = o.type === 'blob' ? `blob:${o.content.toString('base64')}` : o.type === 'tree' ? `tree:${JSON.stringify([...o.files].sort())}` : `commit:${JSON.stringify(o)}`;
    const sha = createHash('sha1').update(key).digest('hex');
    this.objects.set(sha, o);
    return sha;
  }

  /** Test helper: a commit with exactly these files on top of `parents`. */
  commitFiles(files: Record<string, string | null>, parents: string[], message = 'change', base?: Map<string, Entry>): string {
    const map = new Map(base ?? []);
    for (const [p, c] of Object.entries(files)) {
      if (c === null) map.delete(p); else map.set(p, { mode: '100644', sha: this.put({ type: 'blob', content: Buffer.from(c, 'utf8') }) });
    }
    return this.put({ type: 'commit', tree: this.put({ type: 'tree', files: map }), parents, message });
  }

  /** Test helper: someone else pushes to the branch. */
  push(files: Record<string, string | null>, branch = 'main'): string {
    const head = this.refs.get(branch)!;
    const sha = this.commitFiles(files, [head], 'other', this.treeOf(head));
    this.refs.set(branch, sha);
    return sha;
  }

  /** Test helper: add a raw tree entry (symlink, submodule) at the head. */
  pushEntry(path: string, mode: string, branch = 'main'): void {
    const head = this.refs.get(branch)!;
    const files = new Map(this.treeOf(head));
    files.set(path, { mode, sha: this.put({ type: 'blob', content: Buffer.from('target') }) });
    this.refs.set(branch, this.put({ type: 'commit', tree: this.put({ type: 'tree', files }), parents: [head], message: 'raw' }));
  }

  treeOf(commit: string): Map<string, Entry> {
    const c = this.objects.get(commit) as Extract<Obj, { type: 'commit' }>;
    return (this.objects.get(c.tree) as Extract<Obj, { type: 'tree' }>).files;
  }

  /** Test helper: file content at the branch head, or null. */
  file(path: string, branch = 'main'): string | null {
    const e = this.treeOf(this.refs.get(branch)!).get(path);
    return e ? (this.objects.get(e.sha) as Extract<Obj, { type: 'blob' }>).content.toString('utf8') : null;
  }

  commitCount(branch = 'main'): number {
    let n = 0;
    for (let s: string | undefined = this.refs.get(branch); s; s = (this.objects.get(s) as Extract<Obj, { type: 'commit' }>).parents[0]) n++;
    return n;
  }

  headCommit(branch = 'main') { return this.objects.get(this.refs.get(branch)!) as Extract<Obj, { type: 'commit' }>; }

  private isAncestor(a: string, b: string): boolean {
    const seen = new Set<string>();
    const stack = [b];
    while (stack.length) {
      const s = stack.pop()!;
      if (s === a) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      const o = this.objects.get(s);
      if (o?.type === 'commit') stack.push(...o.parents);
    }
    return false;
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    this.calls.push({ method, path: url.pathname + url.search, headers });
    const json = (status: number, body: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...h } });
    if (url.origin !== 'https://api.github.com') return json(599, { message: 'wrong host' });
    if (this.failWith) return json(this.failWith, { message: 'nope', token: headers.authorization });
    const prefix = `/repos/${this.owner}/${this.repo}/git/`;
    if (!url.pathname.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const rest = url.pathname.slice(prefix.length);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^ref\/heads\/(.+)$/.exec(rest))) {
      const sha = this.refs.get(m[1]);
      if (!sha) return json(404, { message: 'Not Found' });
      const etag = `W/"${sha}"`;
      if (headers['if-none-match'] === etag) return new Response(null, { status: 304, headers: { etag } });
      return json(200, { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } }, { etag });
    }
    if (method === 'GET' && (m = /^commits\/([0-9a-f]+)$/.exec(rest))) {
      const o = this.objects.get(m[1]);
      return o?.type === 'commit' ? json(200, { sha: m[1], tree: { sha: o.tree }, parents: o.parents.map((sha) => ({ sha })) }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (m = /^trees\/([0-9a-f]+)$/.exec(rest))) {
      const o = this.objects.get(m[1]);
      if (o?.type !== 'tree') return json(404, { message: 'Not Found' });
      const dirs = new Set<string>();
      for (const p of o.files.keys()) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      const tree = [
        ...[...dirs].map((path) => ({ path, mode: '040000', type: 'tree', sha: 'd'.repeat(40) })),
        ...[...o.files].map(([path, e]) => ({ path, mode: e.mode, type: e.mode === '160000' ? 'commit' : 'blob', sha: e.sha })),
      ];
      return json(200, { sha: m[1], tree, truncated: this.truncated });
    }
    if (method === 'GET' && (m = /^blobs\/([0-9a-f]+)$/.exec(rest))) {
      const o = this.objects.get(m[1]);
      return o?.type === 'blob' ? json(200, { sha: m[1], encoding: 'base64', content: o.content.toString('base64').replace(/(.{60})/g, '$1\n') }) : json(404, { message: 'Not Found' });
    }
    if (method === 'POST' && rest === 'blobs') {
      if (body.encoding !== 'base64') return json(422, { message: 'want base64' });
      return json(201, { sha: this.put({ type: 'blob', content: Buffer.from(String(body.content), 'base64') }) });
    }
    if (method === 'POST' && rest === 'trees') {
      const base = this.objects.get(String(body.base_tree));
      if (base?.type !== 'tree') return json(422, { message: 'bad base' });
      const files = new Map(base.files);
      for (const e of body.tree as { path: string; mode: string; sha: string | null }[]) {
        if (e.sha === null) { if (!files.delete(e.path)) return json(422, { message: 'no such path' }); } else files.set(e.path, { mode: e.mode, sha: e.sha });
      }
      return json(201, { sha: this.put({ type: 'tree', files }) });
    }
    if (method === 'POST' && rest === 'commits') {
      return json(201, { sha: this.put({ type: 'commit', tree: String(body.tree), parents: body.parents as string[], message: String(body.message), author: body.author }) });
    }
    if (method === 'PATCH' && (m = /^refs\/heads\/(.+)$/.exec(rest))) {
      const hook = this.beforeRefUpdate; this.beforeRefUpdate = undefined; hook?.();
      const cur = this.refs.get(m[1]);
      if (!cur) return json(422, { message: 'Reference does not exist' });
      if (body.force !== false || !this.isAncestor(cur, String(body.sha))) return json(422, { message: 'Update is not a fast forward' });
      this.refs.set(m[1], String(body.sha));
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: 'Not Found' });
  };
}
