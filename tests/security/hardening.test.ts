import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileTokenCache } from '../../src/graph/auth';
import { childEnv } from '../../src/email/llm';
import { DEFAULT_RULES } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import type { Classification, MailProvider } from '../../src/email/types';
import { mkCtx, msg } from '../email/fixtures';

describe('claude child env (M3)', () => {
  it('drops secrets, keeps what claude needs', () => {
    const e = childEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', GH_TOKEN: 'g', STACK_REPO_TOKEN: 's', SLACK_TOKEN: 'x', HTTPS_PROXY: 'p', AZURE_CLIENT_SECRET: 'z' });
    expect(e).toMatchObject({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', HTTPS_PROXY: 'p' });
    expect(Object.keys(e)).not.toEqual(expect.arrayContaining(['GH_TOKEN', 'STACK_REPO_TOKEN', 'SLACK_TOKEN', 'AZURE_CLIENT_SECRET']));
  });
});

describe('model output shape (M4)', () => {
  it('non-string reason, options and recommend do not abort the pass', async () => {
    const { ctx } = mkCtx();
    const provider: MailProvider = { delta: async () => ({ messages: [msg()], cursor: 'c' }), createDraft: async () => ({ id: 'd', webLink: '' }) };
    const bad = { class: 'needs_decision', urgency: 1, confidence: 0.9, reason: { x: 1 }, options: [{ a: 1 }, 'A', 'B'], recommend: 42 } as unknown as Classification;
    await expect(runTriage({ ctx, provider, classifier: { classify: async () => bad }, rules: { ...DEFAULT_RULES, owner: ['me@example.test'] } })).resolves.toBeDefined();
  });
});

describe('token cache (L1, L2)', () => {
  it('a corrupt file error never quotes the file', async () => {
    const d = mkdtempSync(join(tmpdir(), 'tok-'));
    const p = join(d, 'graph-token.json');
    writeFileSync(p, 'oops0.AAAsecretrefreshtoken', { mode: 0o600 });
    await expect(new FileTokenCache(p).read()).rejects.toThrow(/not valid/);
    await new FileTokenCache(p).read().catch((e: Error) => expect(e.message).not.toContain('secret'));
  });
  it('write tightens a loose directory', async () => {
    const d = mkdtempSync(join(tmpdir(), 'tok-'));
    const dir = join(d, 'stack'); mkdirSync(dir); chmodSync(dir, 0o755);
    await new FileTokenCache(join(dir, 'graph-token.json')).write({ version: 1, tenant: 'organizations', clientId: 'c', scopes: ['Mail.Read'], refreshToken: 'r' });
    expect(statSync(dir).mode & 0o077).toBe(0);
  });
});
