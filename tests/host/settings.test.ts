import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSettings, SettingsError } from '../../src/host';
import { ENV } from './helpers';

const bad = (over: Record<string, string | undefined>) => () => parseSettings({ ...ENV, ...over });

describe('azure-host settings', () => {
  /** @req FR:azure-host/settings.parse */
  it('parses defaults and values', () => {
    const s = parseSettings(ENV);
    expect(s.branch).toBe('main');
    expect(s.path).toBe('');
    expect(s.owners).toEqual([{ provider: 'github', userId: '42' }]);
    expect(s.bots.webhook).toEqual({ secret: 'whsec', allow: ['ci-bot'] });
    expect(s.bots.slack?.signingSecret).toBe('slacksec');
    expect(s.tokenStore).toBeUndefined();
    expect(parseSettings({ ...ENV, STACK_TOKEN_STORE: "/data/t.json" }).tokenStore).toBe("/data/t.json");
    expect(parseSettings({ ...ENV, STACK_REPO_BRANCH: 'data', STACK_REPO_PATH: 'tasks/a' })).toMatchObject({ branch: 'data', path: 'tasks/a' });
    expect(parseSettings({ ...ENV, STACK_CONFIG: '{}' }).config).toBeDefined();
  });

  /** @req FR:azure-host/settings.deny */
  it('denies by default', () => {
    const s = parseSettings({ ...ENV, STACK_OWNERS: undefined, STACK_WEBHOOK_SECRET: undefined, STACK_SLACK_ALLOW: undefined });
    expect(s.owners).toEqual([]);
    expect(s.bots.webhook).toBeUndefined();
    expect(s.bots.slack).toEqual({ signingSecret: 'slacksec', allow: [] });
  });

  /** @req FR:azure-host/settings.deny @req FR:azure-host/settings.invalid */
  it.each([
    ['missing url', { STACK_REPO_URL: undefined }, 'STACK_REPO_URL'],
    ['http url', { STACK_REPO_URL: 'http://github.com/a/b' }, 'STACK_REPO_URL'],
    ['credentials in url', { STACK_REPO_URL: 'https://user:pw@github.com/a/b' }, 'STACK_REPO_URL'],
    ['ssh url', { STACK_REPO_URL: 'ssh://git@github.com/a/b' }, 'STACK_REPO_URL'],
    ['file url', { STACK_REPO_URL: 'file:///etc' }, 'STACK_REPO_URL'],
    ['missing token', { STACK_REPO_TOKEN: undefined }, 'STACK_REPO_TOKEN'],
    ['token whitespace', { STACK_REPO_TOKEN: 'a b' }, 'STACK_REPO_TOKEN'],
    ['option-like branch', { STACK_REPO_BRANCH: '--upload-pack=x' }, 'STACK_REPO_BRANCH'],
    ['branch with space', { STACK_REPO_BRANCH: 'a b' }, 'STACK_REPO_BRANCH'],
    ['absolute path', { STACK_REPO_PATH: '/etc' }, 'STACK_REPO_PATH'],
    ['relative token store', { STACK_TOKEN_STORE: 'rel/t.json' }, 'STACK_TOKEN_STORE'],
    ['dotdot path', { STACK_REPO_PATH: 'a/../../b' }, 'STACK_REPO_PATH'],
    ['dot-git path', { STACK_REPO_PATH: '.git/hooks' }, 'STACK_REPO_PATH'],
    ['bad config', { STACK_CONFIG: '{nope' }, 'STACK_CONFIG'],
  ])('rejects %s', (_n, over, name) => {
    let err: unknown;
    try { bad(over)(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SettingsError);
    expect((err as Error).message).toContain(name);
  });

  /** @req FR:azure-host/settings.invalid */
  it('never puts values in errors', () => {
    try { parseSettings({ ...ENV, STACK_REPO_URL: 'https://u:supersecret@github.com/a/b' }); } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
      return;
    }
    throw new Error('should throw');
  });
});

describe('azure-host settings hardening', () => {
  /** @req FR:azure-host/settings.url */
  it('normalizes the repo URL so git sees the validated host', () => {
    expect(parseSettings({ ...ENV, STACK_REPO_URL: 'https://github.com\\@evil.com/x' }).repoUrl).toBe('https://github.com/@evil.com/x');
    expect(parseSettings({ ...ENV, STACK_REPO_URL: 'https://GitHub.com:443/a/b' }).repoUrl).toBe('https://github.com/a/b');
  });

  /** @req FR:azure-host/settings.identity */
  it.each([
    ['dash name', { STACK_GIT_NAME: '-c' }, 'STACK_GIT_NAME'],
    ['newline name', { STACK_GIT_NAME: 'a\nb' }, 'STACK_GIT_NAME'],
    ['angle name', { STACK_GIT_NAME: 'a<b>' }, 'STACK_GIT_NAME'],
    ['dash email', { STACK_GIT_EMAIL: '--x@y' }, 'STACK_GIT_EMAIL'],
    ['space email', { STACK_GIT_EMAIL: 'a b@y' }, 'STACK_GIT_EMAIL'],
    ['double slash branch', { STACK_REPO_BRANCH: 'a//b' }, 'STACK_REPO_BRANCH'],
    ['dot segment branch', { STACK_REPO_BRANCH: 'a/.b' }, 'STACK_REPO_BRANCH'],
    ['trailing dot branch', { STACK_REPO_BRANCH: 'a.' }, 'STACK_REPO_BRANCH'],
    ['lock segment branch', { STACK_REPO_BRANCH: 'a.lock/b' }, 'STACK_REPO_BRANCH'],
  ])('rejects %s', (_n, over, name) => {
    expect(bad(over as Record<string, string>)).toThrow(name);
  });

  /** @req FR:azure-host/tokens.override */
  it('token file override requires a pepper', () => {
    expect(bad({ STACK_TOKEN_STORE: '/data/t.json', STACK_TOKEN_PEPPER: undefined })).toThrow('STACK_TOKEN_PEPPER');
    expect(parseSettings({ ...ENV, STACK_TOKEN_STORE: '/data/t.json' }).tokenStore).toBe('/data/t.json');
    expect(parseSettings({ ...ENV, STACK_TOKEN_PEPPER: undefined }).pepper).toBeUndefined();
  });
});

describe('azure-host deployment docs', () => {
  /** @req FR:azure-host/auth.swa */
  it('documents SWA-only reachability as a hard requirement', () => {
    const doc = readFileSync(join(__dirname, '../../docs/azure-host.md'), 'utf8');
    expect(doc).toMatch(/hard requirement[\s\S]*x-ms-client-principal[\s\S]*only through the SWA/);
  });
});
