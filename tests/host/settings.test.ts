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
    expect(s.tokenStore).toMatch(/stack-tokens\.json$/);
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
