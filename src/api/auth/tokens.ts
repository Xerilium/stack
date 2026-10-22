/**
 * API tokens: `stk_<id>.<secret>`. Only a hash of the secret is stored, in a JSON file with no secrets in it.
 * @req FR:auth-security/token.@function
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

/** @req FR:auth-security/token.input */
export const SCOPES = ['read', 'write', 'tasks:read', 'tasks:write', 'projects:read', 'projects:write', 'summaries:read'] as const;
export type Scope = (typeof SCOPES)[number];

export class StoreConflict extends Error { constructor() { super('Token file changed'); } }
export class TokenFileError extends Error {}
export class TokenInputError extends Error {
  constructor(readonly kind: 'invalid' | 'limit', message: string) { super(message); }
}

export interface TokenStore {
  read(): Promise<{ content: string; version: string } | null>;
  /** `expectedVersion` is the version read, or `null` when the file must not exist yet. */
  write(content: string, expectedVersion: string | null): Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export class MemoryTokenStore implements TokenStore {
  private content: string | null = null;
  async read() { return this.content === null ? null : { content: this.content, version: sha(this.content) }; }
  async write(content: string, expectedVersion: string | null) {
    if ((this.content === null ? null : sha(this.content)) !== expectedVersion) throw new StoreConflict();
    this.content = content;
  }
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 15_000;
const queues = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-process queue per path, then an O_EXCL lockfile (stale ones are taken over). @req FR:auth-security/token.file.lock */
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(path) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const lock = `${path}.lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const h = await fs.open(lock, 'wx', 0o600);
        await h.close();
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          const st = await fs.stat(lock);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            const again = await fs.stat(lock);
            if (again.ino === st.ino && again.mtimeMs === st.mtimeMs) await fs.rm(lock, { force: true });
            continue;
          }
        } catch { continue; /* lock vanished: try again */ }
        if (Date.now() > deadline) throw new Error('Token file lock timeout');
        await sleep(10 + Math.random() * 20);
      }
    }
    try { return await fn(); } finally { await fs.rm(lock, { force: true }); }
  });
  queues.set(path, run);
  try { return await run; } finally { if (queues.get(path) === run) queues.delete(path); }
}

/** Reference adapter: locked check-and-rename, owner-only mode. @req FR:auth-security/token.file */
export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}
  async read() {
    try {
      const content = await fs.readFile(this.path, 'utf8');
      return { content, version: sha(content) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  write(content: string, expectedVersion: string | null) {
    return withLock(this.path, () => this.writeLocked(content, expectedVersion));
  }
  private async writeLocked(content: string, expectedVersion: string | null) {
    const cur = await this.read();
    if ((cur ? cur.version : null) !== expectedVersion) throw new StoreConflict();
    const tmp = join(dirname(this.path), `.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await fs.writeFile(tmp, content, { mode: 0o600 });
      await fs.rename(tmp, this.path);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }
}

interface StoredToken { id: string; name: string; scopes: Scope[]; hash: string; createdAt: string; expiresAt: string; revokedAt: string | null }
export interface TokenView { id: string; name: string; scopes: Scope[]; createdAt: string; expiresAt: string; revokedAt: string | null; status: 'active' | 'expired' | 'revoked' }
export interface Verified { id: string; name: string; scopes: Scope[] }
export interface TokenRequest { name: string; scopes: string[]; days?: number }

export interface TokenService {
  create(req: TokenRequest): Promise<{ token: string; record: TokenView }>;
  list(): Promise<TokenView[]>;
  revoke(id: string): Promise<'revoked' | 'already' | 'not_found'>;
  verify(token: string): Promise<Verified | null>;
}

const TOKEN = /^stk_([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;
const ID = /^[0-9a-f]{16}$/;
const HASH = /^[0-9a-f]{64}$/;
const DAY = 86_400_000;
const MAX_ACTIVE = 50;
const RETRIES = 10;
const NAME_BAD = new RegExp("[\\r\\n\\u0085\\u2028\\u2029\\0]");
const DUMMY = '0'.repeat(64);

export function createTokenService(opts: { store: TokenStore; pepper?: string; now?: () => Date }): TokenService {
  const { store } = opts;
  const now = () => (opts.now ?? (() => new Date()))();
  /** @req FR:auth-security/token.hash */
  const hashSecret = (secret: string) => (opts.pepper ? createHmac('sha256', opts.pepper).update(secret).digest('hex') : sha(secret));

  async function load(): Promise<{ tokens: StoredToken[]; version: string | null }> {
    const f = await store.read();
    if (!f) return { tokens: [], version: null };
    let v: { version?: unknown; tokens?: unknown };
    try { v = JSON.parse(f.content); } catch { throw new TokenFileError('Token file is not valid JSON'); }
    if (typeof v !== 'object' || v === null || v.version !== 1 || !Array.isArray(v.tokens)) throw new TokenFileError('Token file has an unknown shape');
    return { tokens: v.tokens as StoredToken[], version: f.version };
  }
  const dump = (tokens: StoredToken[]) => JSON.stringify({ version: 1, tokens }, null, 2) + '\n';
  const isoOk = (s: unknown) => typeof s === 'string' && s.length <= 64;
  /** Shape check of a stored record; anything else is ignored by list and never verifies. @req FR:auth-security/token.verify.record */
  const valid = (t: unknown): t is StoredToken => {
    if (typeof t !== 'object' || t === null) return false;
    const r = t as Record<string, unknown>;
    return typeof r.id === 'string' && ID.test(r.id) && typeof r.name === 'string' && typeof r.hash === 'string' && HASH.test(r.hash)
      && Array.isArray(r.scopes) && r.scopes.length > 0 && r.scopes.every((s) => (SCOPES as readonly string[]).includes(s as string))
      && isoOk(r.createdAt) && isoOk(r.expiresAt) && (r.revokedAt === null || isoOk(r.revokedAt));
  };
  const status = (t: StoredToken): TokenView['status'] => {
    if (!valid(t)) return 'expired';
    if (t.revokedAt) return 'revoked';
    const exp = Date.parse(t.expiresAt);
    return Number.isNaN(exp) || exp <= now().getTime() ? 'expired' : 'active';
  };
  const view = (t: StoredToken): TokenView => ({
    id: t.id, name: t.name, scopes: [...t.scopes], createdAt: t.createdAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt, status: status(t),
  });

  /** Read-modify-write with version checks; a lost race reloads and retries. @req FR:auth-security/token.file.conflict */
  async function mutate<T>(fn: (tokens: StoredToken[]) => T | { result: T; save: false }): Promise<T> {
    for (let i = 0; ; i++) {
      const { tokens, version } = await load();
      const out = fn(tokens) as T | { result: T; save: false };
      if (typeof out === 'object' && out !== null && 'save' in out && (out as { save: unknown }).save === false) return (out as { result: T }).result;
      try {
        await store.write(dump(tokens), version);
        return out as T;
      } catch (e) {
        if (!(e instanceof StoreConflict) || i + 1 >= RETRIES) throw e;
      }
    }
  }

  /** @req FR:auth-security/token.create @req FR:auth-security/token.create.once @req FR:auth-security/token.create.limit */
  async function create(req: TokenRequest) {
    const bad = (): never => { throw new TokenInputError('invalid', 'Invalid token request'); };
    if (typeof req !== 'object' || req === null) bad();
    const { name, scopes, days = 90 } = req;
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80 || NAME_BAD.test(name)) bad();
    if (!Array.isArray(scopes) || scopes.length === 0 || new Set(scopes).size !== scopes.length || !scopes.every((s) => (SCOPES as readonly string[]).includes(s))) bad();
    if (!Number.isInteger(days) || days < 1 || days > 365) bad();
    const id = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const created = now();
    const rec: StoredToken = {
      id, name, scopes: scopes as Scope[], hash: hashSecret(secret), createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + days * DAY).toISOString(), revokedAt: null,
    };
    await mutate((tokens) => {
      if (tokens.filter((t) => status(t) === 'active').length >= MAX_ACTIVE) throw new TokenInputError('limit', 'Too many active tokens');
      tokens.push(rec);
    });
    return { token: `stk_${id}.${secret}`, record: view(rec) };
  }

  /** @req FR:auth-security/token.verify @req FR:auth-security/token.verify.expiry @req FR:auth-security/token.verify.format */
  async function verify(token: string): Promise<Verified | null> {
    const m = typeof token === 'string' ? TOKEN.exec(token) : null;
    if (!m) return null;
    let tokens: StoredToken[];
    try { tokens = (await load()).tokens; } catch (e) { if (e instanceof TokenFileError) return null; throw e; }
    const found = tokens.find((t) => t && (t as StoredToken).id === m[1]);
    const rec = valid(found) ? found : undefined;
    // Unknown ids and malformed records still run one comparison, so timing does not reveal which ids exist.
    const stored = rec ? rec.hash : DUMMY;
    const match = timingSafeEqual(Buffer.from(hashSecret(m[2]), 'hex'), Buffer.from(stored, 'hex'));
    if (!rec || !match || stored === DUMMY || status(rec) !== 'active') return null;
    return { id: rec.id, name: rec.name, scopes: [...rec.scopes] };
  }

  /** @req FR:auth-security/token.list */
  async function list() { return (await load()).tokens.filter(valid).map(view); }

  /** @req FR:auth-security/token.revoke */
  async function revoke(id: string) {
    if (typeof id !== 'string' || !ID.test(id)) return 'not_found' as const;
    return mutate<'revoked' | 'already' | 'not_found'>((tokens) => {
      const t = tokens.find((x) => x.id === id);
      if (!t) return { result: 'not_found', save: false };
      if (t.revokedAt) return { result: 'already', save: false };
      t.revokedAt = now().toISOString();
      return 'revoked';
    });
  }

  return { create, list, revoke, verify };
}
