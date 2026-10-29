/** @req FR:agent-sessions/driver.cost @req FR:agent-sessions/driver.sdk */
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createStoreIndex, priceFor, readIdentity, scanUsage } from '../../src/agents';

const NOW = new Date('2026-10-29T10:00:00Z');
const line = (o: unknown) => JSON.stringify(o);
const asst = (model: string, usage: Record<string, unknown>, text = 'ok') => line({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text }], usage } });
const USAGE = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 4000, output_tokens: 500, cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 }, iterations: [{ input_tokens: 9, output_tokens: 9 }] };

describe('scanUsage', () => {
  it('sums tokens per model and prices known models (1h cache writes at the 1h rate)', () => {
    const r = scanUsage([asst('claude-sonnet-5-5', USAGE), asst('claude-sonnet-5-5', USAGE), line({ type: 'user', message: { usage: USAGE } })].join('\n'));
    // per message: 1000*2 + 500*10 + 2000*4 (1h writes) + 4000*0.1 = 2000+5000+8000+400 = 15400 per 1e6
    expect(r).toEqual({ byModel: { 'claude-sonnet-5-5': { usd: 0.0308, tokens: 15000 } }, usd: 0.0308, priced: true, lastId: '' });
  });
  it('counts one API message once however many content-block lines it was written as, also across scan steps', () => {
    const withId = (id: string) => line({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: USAGE } });
    const r = scanUsage([withId('msg_a'), withId('msg_a'), withId('msg_a'), withId('msg_b')].join('\n'));
    expect(r.byModel['claude-sonnet-5-5'].tokens).toBe(15000);
    expect(r.lastId).toBe('msg_b');
    expect(scanUsage(withId('msg_b'), 'msg_b').byModel['claude-sonnet-5-5']).toBeUndefined();
    expect(scanUsage(withId('msg_c'), 'msg_b').byModel['claude-sonnet-5-5'].tokens).toBe(7500);
  });
  it('an unknown model adds tokens but no dollars and marks the result unpriced; a dated id prices as its base', () => {
    const r = scanUsage([asst('claude-future-9', USAGE), asst('claude-haiku-4-5-20251001', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })].join('\n'));
    expect(r.byModel['claude-future-9']).toEqual({ usd: 0, tokens: 7500 });
    expect(r.byModel['claude-haiku-4-5-20251001']).toEqual({ usd: 1, tokens: 1_000_000 });
    expect(r.priced).toBe(false);
    expect(priceFor('claude-opus-5-5')?.out).toBe(20);
  });
});

describe('readIdentity', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'stack-store-'));
  it('title from the latest custom title, else the first prompt without reminders; cwd, branch, prs, side chain', () => {
    const p = join(dir(), 's.jsonl');
    writeFileSync(p, [
      line({ type: 'user', cwd: '/Users/me/dev/stack', gitBranch: 'main', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }, { type: 'text', text: 'Fix the "parser"' }] } }),
      line({ type: 'custom-title', customTitle: 'old title' }), line({ type: 'pr-link', prUrl: 'https://github.com/o/r/pull/7' }), line({ type: 'pr-link', prUrl: 'https://github.com/o/r/pull/7' }),
      line({ type: 'custom-title', customTitle: 'stack: parser' }),
    ].join('\n') + '\n');
    expect(readIdentity(p, statSync(p).size)).toEqual({ title: 'stack: parser', cwd: '/Users/me/dev/stack', branch: 'main', sidechain: false, prs: ['https://github.com/o/r/pull/7'] });
    const q = join(dir(), 't.jsonl');
    writeFileSync(q, line({ type: 'user', isSidechain: true, cwd: '/x', message: { role: 'user', content: 'Fix the "parser"' } }) + '\n');
    expect(readIdentity(q, statSync(q).size)).toMatchObject({ title: 'Fix the "parser"', sidechain: true, branch: undefined });
  });
  it('a stepped scan equals one pass when a cost-state line falls in a later step', () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
    const d = join(home, 'projects', '-x'); mkdirSync(d, { recursive: true });
    const body = [line({ type: 'user', cwd: '/x', message: { role: 'user', content: 'go' } }), asst('claude-sonnet-5-5', USAGE), asst('claude-sonnet-5-5', USAGE), line({ type: 'cost-state', totalCostUSD: 9, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1, costUSD: 9 } } }), asst('claude-sonnet-5-5', USAGE)].join('\n') + '\n';
    writeFileSync(join(d, 'a1b2c3d4-0000-0000-0000-000000000001.jsonl'), body);
    const one = createStoreIndex({ configDir: home, now: () => NOW, background: false, entriesTtlMs: 0 }); one.list(); one.scanAll();
    const stepped = createStoreIndex({ configDir: home, now: () => NOW, background: false, entriesTtlMs: 0, stepBytes: 600 }); stepped.list(); stepped.scanAll();
    expect(stepped.list()[0].cost).toEqual(one.list()[0].cost);
    expect(one.list()[0].cost).toEqual({ usd: 9.0154, tokens: 7504, byModel: { 'claude-sonnet-5-5': { usd: 9.0154, tokens: 7504 } } });
  });
  it('scanUsage: a cost-state line resets the total to the CLI figure; usage after it is added', () => {
    const text = [asst('claude-sonnet-5-5', USAGE), line({ type: 'cost-state', totalCostUSD: 1.5, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 10, cacheCreationInputTokens: 10, costUSD: 1.5 } } }), asst('claude-sonnet-5-5', USAGE), asst('<synthetic>', USAGE)].join('\n');
    expect(scanUsage(text)).toEqual({ byModel: { 'claude-sonnet-5-5': { usd: 1.5154, tokens: 7540 } }, usd: 1.5154, priced: true, lastId: '' });
  });
});

describe('createStoreIndex', () => {
  it('lists newest first, parses only the newest limit, skips side chains, and caches by size and mtime', () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
    const put = (dir: string, id: string, lines: unknown[], minAgo: number) => { const d = join(home, 'projects', dir); mkdirSync(d, { recursive: true }); const p = join(d, `${id}.jsonl`); writeFileSync(p, lines.map(line).join('\n') + '\n'); const t = new Date(NOW.getTime() - minAgo * 60_000); utimesSync(p, t, t); return p; };
    put('-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000001', [{ type: 'user', cwd: '/Users/me/dev/stack', gitBranch: 'main', message: { role: 'user', content: 'one' } }], 1);
    put('-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000002', [{ type: 'user', cwd: '/Users/me/dev/stack', message: { role: 'user', content: 'two' } }], 30);
    put('-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000003', [{ type: 'user', isSidechain: true, cwd: '/Users/me/dev/stack', message: { role: 'user', content: 'side' } }], 2);
    mkdirSync(join(home, 'projects', '-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000001'), { recursive: true });
    const idx = createStoreIndex({ configDir: home, now: () => NOW, background: false, entriesTtlMs: 0 });
    expect(idx.entries().map((e) => e.id.slice(-1))).toEqual(['1', '3', '2']);
    const all = idx.list({ limit: 10 });
    expect(all.map((s) => [s.id.slice(-1), s.title, s.active])).toEqual([['1', 'one', true], ['2', 'two', false]]);
    expect(all[0].cost).toEqual({ usd: 0, tokens: 0, byModel: {}, approx: true });
    expect(idx.pending()).toBe(3);
    idx.scanAll();
    expect(idx.pending()).toBe(0);
    expect(idx.list({ limit: 10 })[0].cost).toEqual({ usd: 0, tokens: 0, byModel: {} });
    expect(idx.list({ limit: 1 }).map((s) => s.id.slice(-1))).toEqual(['1']);
    expect(idx.list({ sinceMs: NOW.getTime() - 10 * 60_000 }).map((s) => s.id.slice(-1))).toEqual(['1']);
    const p = put('-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000002', [{ type: 'user', cwd: '/Users/me/dev/stack', message: { role: 'user', content: 'two again' } }], 0);
    void p;
    expect(idx.list({ limit: 10 })[0]).toMatchObject({ id: 'a1b2c3d4-0000-0000-0000-000000000002', title: 'two again' });
    expect(createStoreIndex({ configDir: join(home, 'nope'), background: false, entriesTtlMs: 0 }).list()).toEqual([]);
  });
  it('scans usage in steps and only the bytes appended since; the list reports approx until caught up', () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
    const d = join(home, 'projects', '-x'); mkdirSync(d, { recursive: true });
    const p = join(d, 'a1b2c3d4-0000-0000-0000-000000000001.jsonl');
    const user = line({ type: 'user', cwd: '/x', message: { role: 'user', content: 'go' } });
    writeFileSync(p, [user, asst('claude-sonnet-5-5', USAGE), asst('claude-sonnet-5-5', USAGE)].join('\n') + '\n');
    const idx = createStoreIndex({ configDir: home, now: () => NOW, background: false, entriesTtlMs: 0, stepBytes: 700 });
    expect(idx.list()[0].cost.approx).toBe(true);
    idx.scanAll();
    expect(idx.list()[0].cost).toEqual({ usd: 0.0308, tokens: 15000, byModel: { 'claude-sonnet-5-5': { usd: 0.0308, tokens: 15000 } } });
    writeFileSync(p, readFileSync(p, 'utf8') + asst('claude-sonnet-5-5', USAGE) + '\n');
    const t = new Date(NOW.getTime() + 1000); utimesSync(p, t, t);
    expect(idx.list()[0].cost.approx).toBe(true);
    idx.scanAll();
    expect(idx.list()[0].cost.tokens).toBe(22500);
    // a rewrite (shorter file) starts over
    writeFileSync(p, [user, asst('claude-sonnet-5-5', USAGE)].join('\n') + '\n');
    const t2 = new Date(NOW.getTime() + 2000); utimesSync(p, t2, t2);
    idx.list(); idx.scanAll();
    expect(idx.list()[0].cost.tokens).toBe(7500);
  });
});
