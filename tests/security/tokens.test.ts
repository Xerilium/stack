import { mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { createTokenService, FileTokenStore, MemoryTokenStore, SCOPES, StoreConflict } from '../../src/api/auth';
import { NOW } from './helpers';

const mk = (over: Record<string, unknown> = {}) => {
  const store = new MemoryTokenStore();
  let now = NOW;
  const svc = createTokenService({ store, now: () => now, ...over });
  return { store, svc, advance: (days: number) => { now = new Date(now.getTime() + days * 86400000); } };
};
const spec = { name: 'cli', scopes: ['read'] };

// @req FR:auth-security/token.create
describe('token create', () => {
  it('returns a one-time token with 256-bit secret', async () => {
    const { svc } = mk();
    const r = await svc.create(spec);
    expect(r.token).toMatch(/^stk_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(r.token.startsWith(`stk_${r.record.id}.`)).toBe(true);
    expect(r.record.expiresAt).toBe(new Date(NOW.getTime() + 90 * 86400000).toISOString());
    expect((await svc.create(spec)).token).not.toBe(r.token);
  });
  // @req FR:auth-security/token.input
  it('validates input', async () => {
    const { svc } = mk();
    const bad = [
      { name: '', scopes: ['read'] }, { name: 'x'.repeat(81), scopes: ['read'] }, { name: 'a\nb', scopes: ['read'] },
      { name: 'ok', scopes: [] }, { name: 'ok', scopes: ['admin'] }, { name: 'ok', scopes: 'read' }, { name: 'ok', scopes: ['read', 'read'] },
      { name: 'ok', scopes: ['read'], days: 0 }, { name: 'ok', scopes: ['read'], days: 366 }, { name: 'ok', scopes: ['read'], days: 1.5 },
      { name: 5, scopes: ['read'] },
    ];
    for (const b of bad) await expect(svc.create(b as never)).rejects.toThrow('Invalid token request');
    expect(SCOPES).toEqual(['read', 'write', 'tasks:read', 'tasks:write', 'projects:read', 'projects:write', 'summaries:read']);
  });
  // @req FR:auth-security/token.create.limit
  it('caps active tokens at 50 (revoked and expired do not count)', async () => {
    const { svc } = mk();
    const first = await svc.create(spec);
    for (let i = 1; i < 50; i++) await svc.create(spec);
    await expect(svc.create(spec)).rejects.toThrow('Too many active tokens');
    await svc.revoke(first.record.id);
    await expect(svc.create(spec)).resolves.toBeDefined();
  });
});

// @req FR:auth-security/token.hash
describe('token storage', () => {
  it('stores only the hash, never the secret', async () => {
    const { svc, store } = mk();
    const { token } = await svc.create(spec);
    const secret = token.split('.')[1];
    const file = (await store.read())!.content;
    expect(file).not.toContain(secret);
    expect(file).not.toContain(token);
    expect(file).toContain(createHash('sha256').update(secret).digest('hex'));
    expect(JSON.parse(file).version).toBe(1);
  });
  it('uses HMAC with a pepper', async () => {
    const { svc, store } = mk({ pepper: 'pepper' });
    const { token } = await svc.create(spec);
    const file = (await store.read())!.content;
    expect(file).not.toContain(createHash('sha256').update(token.split('.')[1]).digest('hex'));
    expect(await svc.verify(token)).not.toBeNull();
    expect(await mk({ pepper: 'other' }).svc.verify(token)).toBeNull();
  });
});

// @req FR:auth-security/token.verify
describe('token verify', () => {
  it('accepts a good token and returns scopes without the hash', async () => {
    const { svc } = mk();
    const { token, record } = await svc.create({ name: 'a', scopes: ['tasks:read', 'write'] });
    expect(await svc.verify(token)).toEqual({ id: record.id, name: 'a', scopes: ['tasks:read', 'write'] });
  });
  it('rejects wrong secret, unknown id, and malformed tokens', async () => {
    const { svc, store } = mk();
    const { token } = await svc.create(spec);
    const readSpy = jest.spyOn(store, 'read');
    const [id] = token.split('.');
    for (const t of ['', 'x', 'stk_', `${id}.wrong`, `${id}.${'A'.repeat(43)}`, 'stk_0000000000000000.' + 'A'.repeat(43), `${token}x`, ` ${token}`, token.toUpperCase()]) {
      expect(await svc.verify(t)).toBeNull();
    }
    // @req FR:auth-security/token.verify.format
    readSpy.mockClear();
    for (const t of ['', 'x', 'stk_', `${id}.short`, 'a'.repeat(500)]) await svc.verify(t);
    expect(readSpy).not.toHaveBeenCalled();
  });
  // @req FR:auth-security/token.verify.expiry
  it('rejects expired and revoked tokens', async () => {
    const { svc, advance } = mk();
    const a = await svc.create({ ...spec, days: 1 });
    const b = await svc.create(spec);
    expect(await svc.verify(a.token)).not.toBeNull();
    advance(1);
    expect(await svc.verify(a.token)).toBeNull();
    await svc.revoke(b.record.id);
    expect(await svc.verify(b.token)).toBeNull();
  });
  it('fails closed on a corrupt file', async () => {
    const { svc, store } = mk();
    const { token } = await svc.create(spec);
    await store.write('{not json', (await store.read())!.version);
    expect(await svc.verify(token)).toBeNull();
  });
});

// @req FR:auth-security/token.list
describe('token list and revoke', () => {
  it('lists metadata and status but no hash', async () => {
    const { svc, advance } = mk();
    const a = await svc.create({ name: 'a', scopes: ['read'], days: 1 });
    const b = await svc.create({ name: 'b', scopes: ['write'] });
    await svc.revoke(b.record.id);
    advance(2);
    const list = await svc.list();
    expect(list.map((t) => [t.name, t.status])).toEqual([['a', 'expired'], ['b', 'revoked']]);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'name', 'revokedAt', 'scopes', 'status']);
    expect(JSON.stringify(list)).not.toMatch(/hash/i);
    expect(a.record).not.toHaveProperty('hash');
  });
  // @req FR:auth-security/token.revoke
  it('revokes once, repeat is a no-op, unknown is not found', async () => {
    const { svc } = mk();
    const { record } = await svc.create(spec);
    expect(await svc.revoke(record.id)).toBe('revoked');
    const t1 = (await svc.list())[0].revokedAt;
    expect(await svc.revoke(record.id)).toBe('already');
    expect((await svc.list())[0].revokedAt).toBe(t1);
    expect(await svc.revoke('0000000000000000')).toBe('not_found');
    expect(await svc.revoke('../x')).toBe('not_found');
  });
});

// @req FR:auth-security/token.file
describe('token file', () => {
  it('writes atomically with owner-only permissions and versions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stk-'));
    const path = join(dir, 'tokens.json');
    const store = new FileTokenStore(path);
    expect(await store.read()).toBeNull();
    const svc = createTokenService({ store, now: () => NOW });
    const { token } = await svc.create(spec);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).not.toContain(token.split('.')[1]);
    expect(await svc.verify(token)).not.toBeNull();
    const cur = (await store.read())!;
    await expect(store.write('{}', 'stale')).rejects.toBeInstanceOf(StoreConflict);
    await expect(store.write('{}', null)).rejects.toBeInstanceOf(StoreConflict);
    await store.write('{}', cur.version);
  });
  // @req FR:auth-security/token.file.conflict
  it('retries a lost race without dropping the other writer', async () => {
    const { svc, store } = mk();
    const orig = store.write.bind(store);
    let raced = false;
    jest.spyOn(store, 'write').mockImplementation(async (c, v) => {
      if (!raced) { raced = true; await svc.create({ name: 'other', scopes: ['read'] }); }
      return orig(c, v);
    });
    await svc.create({ name: 'mine', scopes: ['read'] });
    expect((await svc.list()).map((t) => t.name).sort()).toEqual(['mine', 'other']);
  });
  it('gives up after repeated conflicts', async () => {
    const { svc, store } = mk();
    jest.spyOn(store, 'write').mockRejectedValue(new StoreConflict());
    await expect(svc.create(spec)).rejects.toBeInstanceOf(StoreConflict);
  });
});
